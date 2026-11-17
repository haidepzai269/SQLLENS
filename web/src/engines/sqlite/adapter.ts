import type { BTreeModel } from "@/contracts/btree";
import type { Outcome } from "@/contracts/conclusion";
import { EngineError, type EngineAdapter, type LoadProgress, type TryChangeResult } from "@/contracts/engine";
import type { Plan } from "@/contracts/plan";
import type { SqliteFileSource, SqliteWorkerRequest, SqliteWorkerResponse } from "./protocol";

type Options = {
  onProgress?: (p: LoadProgress) => void;
  /** Chỉ áp cho câu SQL; nạp WASM có hạn riêng. Mặc định 1.500 ms (Task132 AC4). */
  timeoutMs?: number;
  /** Dành cho test: vitest không có Web Worker thật. */
  workerFactory?: () => Worker;
};

export const DEFAULT_TIMEOUT_MS = 1_500;
const LOAD_TIMEOUT_MS = 30_000;
/** Đọc/nạp/xuất cả một file 40MB lâu hơn hạn của một câu SQL, nên có hạn riêng. */
const FILE_TIMEOUT_MS = 30_000;

type Done = Extract<SqliteWorkerResponse, { type: "done" }>;
type Pending = { resolve: (r: Done) => void; reject: (e: EngineError) => void };
type Req = { type: "init" } | { type: "exec"; sql: string } | { type: "load"; source: SqliteFileSource } | { type: "export" };

/**
 * Cùng hợp đồng EngineAdapter, cộng hai đường của Task134/135.
 *
 * Chúng cố ý không nằm trong `EngineAdapter`: Postgres và MySQL không có câu trả lời cho "nạp file
 * database của mày đâu", nên đưa vào hợp đồng chung sẽ bắt chúng phải nói dối. Đây là sai lệch có
 * chủ đích so với "Không sửa adapter" của task132, đã được Admin chốt (xem ban_giao_task134.md).
 */
export type SqliteAdapter = Omit<EngineAdapter, "engine"> & {
  readonly engine: "sqlite";
  /** Yêu cầu Task132: tạo DB mới trong bộ nhớ, quên history. Cùng nghĩa với `fresh()`. */
  reset(): Promise<void>;
  /**
   * Thay toàn bộ database bằng một file `.sqlite`. File chỉ được đọc trong worker; file hỏng thì
   * database cũ còn nguyên. History được xoá vì các câu cũ thuộc database cũ.
   */
  loadDatabase(source: File | Uint8Array, options?: { signal?: AbortSignal }): Promise<void>;
  /** Toàn bộ database dưới dạng file SQLite, kể cả khi chưa có bảng. Chỉ đọc. */
  exportDatabase(): Promise<Uint8Array>;
};

// SQLite không có EXPLAIN ANALYZE/plan với số dòng thật và không có pageinspect: trả đúng nhãn
// "chưa mô phỏng được" thay vì bịa dữ liệu (Core Rule 1 và 4).
const unsupported = <T>(reason: string): Outcome<T> => ({ kind: "not_simulated", reasonKey: `sqlite.notSimulated.${reason}` });

export async function createSqliteAdapter({ onProgress, timeoutMs = DEFAULT_TIMEOUT_MS, workerFactory }: Options = {}): Promise<SqliteAdapter> {
  let worker: Worker | undefined;
  let nextId = 1;
  let needsRebuild = false;
  let disposed = false;
  let chain: Promise<unknown> = Promise.resolve();
  let activeExec: number | undefined;
  // **Byte** của file đã nạp (không phải File), để worker chết (timeout/huỷ) thì dựng lại vẫn còn
  // database của người dùng. Giữ File là giữ con trỏ tới đĩa: người dùng xoá/đổi file rồi bấm
  // Dựng lại là mất database (review 17/11). Giá phải trả: tối đa MAX_IMPORT_BYTES trong RAM.
  let loadedSource: Uint8Array | undefined;
  const pending = new Map<number, Pending>();
  const ran: string[] = [];

  // Dừng worker và hủy mọi promise đang chờ: không promise nào được treo (UI không đóng băng).
  function kill(err: EngineError) {
    worker?.terminate();
    worker = undefined;
    needsRebuild = true;
    const all = [...pending.values()];
    pending.clear();
    all.forEach((p) => p.reject(err));
  }

  function spawn() {
    const w = workerFactory ? workerFactory() : new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = ({ data: m }: MessageEvent<SqliteWorkerResponse>) => {
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === "progress") return onProgress?.(m.progress);
      pending.delete(m.id);
      if (m.type === "done") p.resolve(m);
      else p.reject(new EngineError(m.error.code, m.error.message, m.error.position, m.error.guard, m.error.statementIndex));
    };
    const crashed = (msg: string) => w === worker && kill(new EngineError("worker_crashed", msg));
    w.onerror = (e) => crashed(e.message || "worker error");
    w.onmessageerror = () => crashed("worker message error");
    worker = w;
  }

  function call(req: Req, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    const id = nextId++;
    return new Promise<Done>((resolve, reject) => {
      if (!worker) return reject(new EngineError("worker_crashed", "Engine stopped, call rebuild()"));
      // Nạp WASM lần đầu có thể lâu (Slow 3G ~14 giây), nên không dùng timeout của câu SQL cho init.
      const ms = options.timeoutMs ?? (req.type === "init" ? LOAD_TIMEOUT_MS : timeoutMs);
      const timer = setTimeout(() => kill(new EngineError("timeout", `No response after ${ms} ms`)), ms);
      const onAbort = () => kill(new EngineError("cancelled", "Cancelled"));
      options.signal?.addEventListener("abort", onAbort, { once: true });
      pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
          reject(e);
        },
      });
      if (req.type === "exec") activeExec = id;
      worker.postMessage({ ...req, id } satisfies SqliteWorkerRequest);
    }).finally(() => {
      if (activeExec === id) activeExec = undefined;
    });
  }

  async function startOnce() {
    spawn();
    try {
      await call({ type: "init" });
      needsRebuild = false;
    } catch (e) {
      worker?.terminate();
      worker = undefined;
      needsRebuild = true;
      throw e instanceof EngineError && e.code === "load_failed" ? e : new EngineError("load_failed", (e as Error).message);
    }
  }

  // Hàng đợi: execute và rebuild chạy tuần tự đúng thứ tự gọi.
  const enqueue = <T,>(fn: () => Promise<T>) => {
    const r = chain.then(fn);
    chain = r.catch(() => {});
    return r;
  };

  // Dựng worker mới rồi chạy lại history. DB SQLite nằm trong worker nên mất theo worker.
  // Gọi trong hàng đợi.
  async function rebuildNow() {
    if (disposed) throw new EngineError("worker_crashed", "Engine disposed");
    worker?.terminate();
    worker = undefined;
    await startOnce();
    try {
      // Database nhập từ file không dựng lại được bằng history: phải nạp lại chính file đó trước.
      if (loadedSource) await call({ type: "load", source: { bytes: loadedSource } }, { timeoutMs: FILE_TIMEOUT_MS });
      for (const sql of ran) await call({ type: "exec", sql });
    } catch (err) {
      needsRebuild = true;
      throw err;
    }
  }

  // Dựng worker mới và làm sạch history (không chạy lại câu cũ). Gọi trong hàng đợi.
  async function freshNow() {
    if (disposed) throw new EngineError("worker_crashed", "Engine disposed");
    worker?.terminate();
    worker = undefined;
    loadedSource = undefined;
    ran.length = 0;
    await startOnce();
  }

  await startOnce();

  return {
    engine: "sqlite",
    // SQLite không có lớp parser chặn SET ROLE như Postgres; rào chắn SQL thuộc Task133.
    guardActive: false,
    execute: async (sql, options) => {
      const aborted = () => options?.signal?.aborted && new EngineError("cancelled", "Cancelled");
      let e = aborted();
      if (e) throw e;
      return enqueue(async () => {
        if (disposed) throw new EngineError("worker_crashed", "Engine disposed");
        if (needsRebuild) throw new EngineError("worker_crashed", "Engine stopped, call rebuild() first");
        e = aborted();
        if (e) throw e;
        const p = call({ type: "exec", sql });
        const id = activeExec;
        const onAbort = () => activeExec === id && kill(new EngineError("cancelled", "Cancelled"));
        options?.signal?.addEventListener("abort", onAbort, { once: true });
        try {
          const r = await p;
          if (!options?.internal) ran.push(sql);
          return r.results ?? [];
        } finally {
          options?.signal?.removeEventListener("abort", onAbort);
        }
      });
    },
    explain: async () => unsupported<Plan>("plan"),
    tryChange: async () => unsupported<TryChangeResult>("tryChange"),
    readBTree: async () => ({ model: unsupported<BTreeModel>("btree") }),
    async cancel() {
      if (activeExec !== undefined) kill(new EngineError("cancelled", "Cancelled"));
    },
    history: () => ran,
    rebuild: () => enqueue(rebuildNow),
    fresh: () => enqueue(freshNow),
    // Tên `reset` theo yêu cầu Task132; cùng nghĩa với fresh(): DB mới trong bộ nhớ, history rỗng.
    reset: () => enqueue(freshNow),
    loadDatabase: (source, options) =>
      enqueue(async () => {
        if (disposed) throw new EngineError("worker_crashed", "Engine disposed");
        try {
          // Đọc byte một lần rồi giữ lại: file trên đĩa có thể bị xoá/đổi trước lần Dựng lại sau.
          // `file.arrayBuffer()` là bất đồng bộ nên không chặn giao diện (Task134 AC5).
          const bytes = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
          // Sandbox đang dừng (worker đã chết) không phải lý do để khoá nút nhập: nhập file là một
          // cách thoát khỏi trạng thái hỏng, nên dựng lại trước rồi nạp (review 17/11).
          if (needsRebuild) await rebuildNow();
          await call({ type: "load", source: { bytes } }, { signal: options?.signal, timeoutMs: FILE_TIMEOUT_MS });
          loadedSource = bytes;
          ran.length = 0; // database đã bị thay: các câu cũ không còn dựng lại được
        } catch (e) {
          throw e instanceof EngineError
            ? e
            : new EngineError("load_failed", e instanceof Error ? e.message : String(e));
        }
      }),
    exportDatabase: () =>
      enqueue(async () => {
        if (disposed) throw new EngineError("worker_crashed", "Engine disposed");
        if (needsRebuild) throw new EngineError("worker_crashed", "Engine stopped, call rebuild() first");
        const r = await call({ type: "export" }, { timeoutMs: FILE_TIMEOUT_MS });
        if (!r.bytes) throw new EngineError("sql", "Không đọc được nội dung database");
        return r.bytes;
      }),
    async dispose() {
      disposed = true;
      kill(new EngineError("cancelled", "Engine disposed"));
    },
  };
}
