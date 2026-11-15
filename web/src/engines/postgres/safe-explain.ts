/**
 * Module thực thi Safe EXPLAIN ANALYZE phía Client (PGlite).
 * Bọc trong giao dịch tự hủy BEGIN...ROLLBACK với timeout 1.5s,
 * đảm bảo 100% không làm thay đổi trạng thái dữ liệu trong sandbox.
 */

import { splitSqlStatements } from "@/components/sql-editor/statement-at-cursor";
import type { QueryResult } from "@/contracts/engine";
import { minifyPlanJson } from "@/modules/plan-runner/minifier/plan-minifier";
import type { Run } from "./try-rollback";

const EXPLAIN_PREFIX = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ";

/**
 * Các loại câu lệnh SQL cho phép thực thi EXPLAIN.
 * Chỉ hỗ trợ: SELECT, INSERT, UPDATE, DELETE, MERGE, WITH (CTE).
 */
const EXPLAINABLE_REGEX = /^(SELECT|INSERT|UPDATE|DELETE|MERGE|WITH)\b/i;

/**
 * Gatekeeper kiểm tra nhanh xem SQL có thể chạy EXPLAIN hay không.
 * Từ chối: DDL (CREATE, DROP, ALTER), TRANSACTION (BEGIN, COMMIT, ROLLBACK),
 * câu lệnh rỗng, comment hoặc script chứa nhiều hơn 1 câu lệnh.
 */
export function canExplainSql(sql: string): boolean {
  if (!sql || typeof sql !== "string") return false;

  const trimmed = sql.trim();
  if (!trimmed) return false;

  // Tách câu lệnh theo phân tích cú pháp an toàn (bỏ qua dấu ; trong string và comment)
  const statements = splitSqlStatements(trimmed);
  if (statements.length !== 1) {
    return false;
  }

  const singleStmt = statements[0].text.trim();
  if (!singleStmt) return false;

  // Bỏ qua các comment ở đầu nếu còn sót
  const cleanHead = singleStmt
    .replace(/^\/\*[\s\S]*?\*\//, "")
    .replace(/^--.*$/m, "")
    .replace(/^#.*$/m, "")
    .trim();

  return EXPLAINABLE_REGEX.test(cleanHead);
}

export interface SafeExplainResult {
  planEvidence: string | null;
  rawJson?: unknown;
  error?: string;
}

/**
 * Chạy EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) an toàn trong PGlite:
 * - Bọc trong BEGIN ... ROLLBACK để không biến đổi dữ liệu sandbox (kể cả với UPDATE/DELETE).
 * - Cơ chế Timeout 1.500ms ngắt an toàn, chống treo Web Worker.
 * - Trả về chuỗi bằng chứng nén `planEvidence` cùng `rawJson`.
 */
export async function runSafeExplainAnalyze(
  run: Run,
  sql: string,
  timeoutMs = 1500
): Promise<SafeExplainResult> {
  if (!canExplainSql(sql)) {
    return { planEvidence: null };
  }

  // Loại bỏ dấu chấm phẩy thừa ở cuối câu SQL trước khi ghép vào EXPLAIN
  const cleanSql = sql.trim().replace(/;+$/, "");

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<SafeExplainResult>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("timeout"));
    }, timeoutMs);
  });

  const execPromise = (async (): Promise<SafeExplainResult> => {
    try {
      await run("BEGIN");
      let rawJson: unknown = null;
      try {
        const explainCommand = `${EXPLAIN_PREFIX}${cleanSql}`;
        const queryResults: QueryResult[] = await run(explainCommand);

        if (
          queryResults &&
          queryResults.length > 0 &&
          queryResults[0].rows &&
          queryResults[0].rows.length > 0 &&
          queryResults[0].rows[0][0] !== undefined
        ) {
          rawJson = queryResults[0].rows[0][0];
        }
      } finally {
        // AC1: Luôn luôn hoàn tác transaction trong finally để bảo toàn 100% dữ liệu
        await run("ROLLBACK").catch(() => {});
      }

      if (!rawJson) {
        return { planEvidence: null };
      }

      const planEvidence = minifyPlanJson(rawJson);
      return { planEvidence, rawJson };
    } catch (err) {
      const msg = (err as Error)?.message || "explain_error";
      return { planEvidence: null, error: msg };
    }
  })();

  try {
    const result = await Promise.race([execPromise, timeoutPromise]);
    return result;
  } catch (err) {
    if ((err as Error)?.message === "timeout") {
      // Cố gắng gửi lệnh ROLLBACK dọn dẹp nếu có thể
      run("ROLLBACK").catch(() => {});
      return { planEvidence: null, error: "timeout" };
    }
    return { planEvidence: null, error: (err as Error)?.message || "unknown_error" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
