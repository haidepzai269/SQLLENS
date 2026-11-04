import type { Conclusion, Outcome } from "@/contracts/conclusion";
import type { EngineAdapter, TryChangeResult } from "@/contracts/engine";
import type { Plan } from "@/contracts/plan";
import { parseSql } from "@/modules/sql-intake/parser";
import { allowed } from "./allow";
import { splitAnswer } from "./split";

export type VerifiedPart =
  | { kind: "text"; text: string }
  | { kind: "sql"; sql: string; outcome: Conclusion<Plan | TryChangeResult> }
  // Không chứa SQL gốc hay thông báo lỗi: chỉ khóa dịch trong namespace `mentorVerify`.
  | { kind: "hidden"; reasonKey: string };
export type VerifiedAnswer = { parts: VerifiedPart[]; hiddenCount: number };
type Adapter = Pick<EngineAdapter, "engine" | "explain" | "tryChange">;

export const MAX_RUN = 5;
const TIMEOUT_MS = 15_000;
const hidden = (reason: string): VerifiedPart => ({ kind: "hidden", reasonKey: `mentorVerify.${reason}` });

// Hết giờ hoặc bị hủy thì bỏ kết quả. Câu đã gửi vào engine vẫn có thể chạy tiếp (adapter con không có cancel).
function guarded<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    const onAbort = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    });
  });
}

async function check(adapter: Adapter, sql: string, probe: string | undefined, signal: AbortSignal | undefined, ms: number, called: { n: number }): Promise<VerifiedPart> {
  if (!sql) return hidden("empty");
  const parsed = await parseSql(sql, "postgres");
  if (!parsed.ok) return hidden("parseError");
  if (parsed.statements.length !== 1) return hidden(parsed.statements.length ? "multiple" : "empty");
  const stmt = parsed.statements[0];
  if (!allowed(stmt)) return hidden("notAllowed");
  const isSelect = stmt.kind === "select";
  if (!isSelect && !probe) return hidden("needsProbe");
  signal?.throwIfAborted();
  called.n++;
  try {
    const outcome = await guarded<Outcome<Plan | TryChangeResult>>(isSelect ? adapter.explain(sql, { signal }) : adapter.tryChange(sql, probe!), ms, signal);
    return outcome.kind === "conclusion" ? { kind: "sql", sql, outcome } : hidden("notSimulated");
  } catch (e) {
    if (signal?.aborted) throw e;
    return hidden(e instanceof Error && e.message === "timeout" ? "timeout" : "failed");
  }
}

/** Chạy thử từng khối SQL trong câu trả lời của AI, chỉ giữ khối đã chạy được. Chỉ ném lỗi khi `signal` bị hủy. */
export async function verifyAnswer(
  adapter: Adapter,
  answer: string,
  options: { probe?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<VerifiedAnswer> {
  const { probe, signal, timeoutMs = TIMEOUT_MS } = options;
  const parts: VerifiedPart[] = [];
  let ran = 0;
  let stuck = false;
  for (const piece of splitAnswer(answer)) {
    if (piece.kind === "text") {
      parts.push(piece);
      continue;
    }
    signal?.throwIfAborted();
    if (adapter.engine !== "postgres") parts.push(hidden("notSimulated"));
    else if (ran >= MAX_RUN) parts.push(hidden("limit"));
    else if (stuck) parts.push(hidden("timeout"));
    else {
      const called = { n: 0 };
      const r = await check(adapter, piece.sql, probe, signal, timeoutMs, called);
      // Chỉ khối thật sự gọi engine mới tính vào giới hạn.
      ran += called.n;
      // Câu hết giờ có thể còn đang chạy trong engine: không xếp thêm câu sau nó.
      if (r.kind === "hidden" && r.reasonKey.endsWith(".timeout")) stuck = true;
      parts.push(r);
    }
  }
  return { parts, hiddenCount: parts.filter((p) => p.kind === "hidden").length };
}
