import type { Outcome } from "@/contracts/conclusion";
import { EngineError, type EngineAdapter, type QueryResult } from "@/contracts/engine";
import type { Plan } from "@/contracts/plan";
import { readFailure, type Failure } from "@/modules/auth/api";
import { normalizeMysql } from "@/modules/plan-runner/normalize";
import { splitMysql } from "@/modules/sql-intake/parser/core";

// Gin chuyển tiếp tới sandbox agent (Task074). Phiên nằm ở agent; adapter chỉ giữ id.
const BASE = "/api/mysql/sessions";
const SID_KEY = "sqllens.mysql.sid";
const ID_RE = /^[0-9a-f]{30}$/;

/** Lỗi của đường sandbox, không phải lỗi SQL. `code` theo hợp đồng Task074; thêm `session_expired` và `network` do client tạo. */
export class SandboxError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.code);
    this.name = "SandboxError";
  }
}
const fail = (status: number, code: string) => new SandboxError({ status, code, key: "internal" });

export type SessionStatus = "starting" | "ready" | "ended";
export interface MysqlAdapter extends EngineAdapter {
  /** Bỏ phiên cũ, bắt đầu phiên trống. Không chạy lại câu nào: dùng khi người dùng không muốn chạy lại. */
  fresh(): Promise<void>;
}
type Options = { onStatus?: (s: SessionStatus) => void; onAuthLost?: () => void };

const store = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(SID_KEY, id);
    else sessionStorage.removeItem(SID_KEY);
  } catch {
    /* sessionStorage bị chặn: bỏ qua, phiên cũ tự hết hạn sau 15 phút */
  }
};
const stored = () => {
  try {
    const v = sessionStorage.getItem(SID_KEY);
    return v && ID_RE.test(v) ? v : null;
  } catch {
    return null;
  }
};
// keepalive để yêu cầu hủy vẫn đi khi trang đang đóng. Lỗi bị bỏ qua: không còn gì để làm.
const del = (id: string) => fetch(`${BASE}/${id}`, { method: "DELETE", credentials: "same-origin", keepalive: true }).then(() => undefined, () => undefined);

const no = <T>(reason: string): Outcome<T> => ({ kind: "not_simulated", reasonKey: `mysql.notSimulated.${reason}` });
const EXPLAINABLE = /^\s*(select|insert|update|delete|replace|with)\b/i;

// Một cổng đang sống mỗi lúc, để đăng xuất hủy được phiên trước khi cookie mất.
let live: (() => Promise<void>) | null = null;
export const endMysqlSession = () => live?.() ?? Promise.resolve();

export function createMysqlAdapter(o: Options = {}): MysqlAdapter {
  let sess: Promise<string> | null = null;
  let sid: string | null = null;
  let lost = false; // phiên đã mất (hết hạn hoặc bị hủy): không tự tạo lại, vì dữ liệu trong phiên đã mất
  let disposed = false;
  let hist: string[] = [];

  const status = (s: SessionStatus) => !disposed && o.onStatus?.(s);

  async function start(): Promise<string> {
    status("starting");
    const old = stored(); // tải lại trang giữa phiên: hủy phiên cũ để không tự khóa bởi user_session_limit
    if (old) {
      await del(old);
      store(null);
    }
    let res: Response;
    // Không truyền signal: bỏ giữa chừng thì agent vẫn tạo xong và ta mất id. Chờ xong rồi hủy nếu cần.
    try {
      res = await fetch(BASE, { method: "POST", credentials: "same-origin" });
    } catch {
      throw fail(0, "network");
    }
    if (res.status !== 201) throw await failure(res);
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof body?.id !== "string" || !ID_RE.test(body.id)) throw fail(502, "sandbox_bad_response");
    sid = body.id;
    store(sid);
    if (disposed) {
      await end();
      throw new EngineError("cancelled", "disposed");
    }
    status("ready");
    return sid;
  }

  async function failure(res: Response): Promise<SandboxError> {
    const f = await readFailure(res);
    if (f.status === 401) o.onAuthLost?.();
    return new SandboxError(f);
  }

  /** Hủy phiên ở agent (nếu đang tạo thì chờ tạo xong). Sau đó không còn phiên. */
  async function end() {
    const p = sess;
    sess = null;
    const id = sid ?? (await p?.catch(() => null)) ?? null;
    sid = null;
    store(null);
    status("ended");
    if (id) await del(id);
  }

  function session(signal?: AbortSignal): Promise<string> {
    if (lost) return Promise.reject(fail(404, "session_expired"));
    const p = (sess ??= start().catch((e) => {
      sess = null;
      status("ended");
      throw e;
    }));
    if (!signal) return p;
    return Promise.race([p, new Promise<never>((_, rej) => {
      const stop = () => rej(new EngineError("cancelled", "cancelled"));
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    })]);
  }

  async function exec(sql: string, signal?: AbortSignal): Promise<QueryResult[]> {
    try {
      const id = await session(signal);
      let res: Response;
      try {
        res = await fetch(`${BASE}/${id}/query`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql }),
          signal,
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        throw fail(0, "network");
      }
      if (res.status === 404) {
        lost = true;
        sess = sid = null;
        store(null);
        status("ended");
        throw fail(404, "session_expired");
      }
      if (!res.ok) {
        const clone = res.clone();
        const f = await failure(res);
        if (f.failure.code === "sql_error") {
          // Thông báo của MySQL là của chính người dùng; hiện cho họ, không ghi log.
          const d = (await clone.json().catch(() => null)) as { detail?: { message?: unknown } } | null;
          throw new EngineError("sql", typeof d?.detail?.message === "string" ? d.detail.message : f.failure.code);
        }
        throw f;
      }
      const body = (await res.json().catch(() => null)) as { results?: QueryResult[]; truncated?: boolean } | null;
      if (!Array.isArray(body?.results)) throw fail(502, "sandbox_bad_response");
      const results = body.results;
      if (body.truncated && results.length) results[results.length - 1] = { ...results[results.length - 1], truncated: true };
      return results;
    } catch (e) {
      // Bị hủy giữa chừng: câu có thể vẫn đang chạy ở agent, nên bỏ cả phiên. Phiên mới phải do người dùng chọn (rebuild).
      if (signal?.aborted || (e instanceof EngineError && e.code === "cancelled")) {
        lost = true;
        await end();
        throw e instanceof EngineError ? e : new EngineError("cancelled", "cancelled");
      }
      throw e;
    }
  }

  const a: MysqlAdapter = {
    engine: "mysql",
    async execute(sql, options) {
      const results = await exec(sql, options?.signal);
      if (!options?.internal) hist.push(sql);
      return results;
    },
    async explain(sql, options) {
      const parts = splitMysql(sql);
      if (parts.length === 0) return no("empty");
      if (parts.length > 1) return no("multiple");
      if (!EXPLAINABLE.test(sql)) return no("unsupported");
      const r = await a.execute(`EXPLAIN FORMAT=JSON ${sql}`, { signal: options?.signal, internal: true });
      let plan: Plan;
      try {
        plan = normalizeMysql(r[0]?.rows[0]?.[0]);
      } catch {
        return no("unsupported");
      }
      // Số dòng là ước lượng của optimizer, câu chưa chạy: nhãn Ước lượng, không phải Thật.
      return { kind: "conclusion", label: "estimated", data: plan, evidence: [{ kind: "explain", messageKey: "mysql.explain.estimated" }] };
    },
    async tryChange() {
      return no("tryChange");
    },
    async readBTree() {
      return { model: no("btree") };
    },
    async cancel() {
      lost = true;
      await end();
    },
    history: () => hist,
    async rebuild() {
      const h = hist;
      await a.fresh();
      for (const s of h) await a.execute(s); // người dùng đã bấm dựng lại: chạy lại đúng các câu đã chạy thành công
    },
    async fresh() {
      await end();
      lost = false;
      hist = [];
    },
    async dispose() {
      disposed = true;
      window.removeEventListener("pagehide", onHide);
      if (live === dispose) live = null;
      await end();
    },
  };
  const dispose = () => a.dispose();
  // Đóng tab: trang còn đúng một nhịp để gửi yêu cầu hủy.
  const onHide = () => sid && void del(sid);
  window.addEventListener("pagehide", onHide);
  live = dispose;
  return a;
}
