import type { Outcome } from "@/contracts/conclusion";
import type { Plan } from "@/contracts/plan";
import { normalizePostgres } from "@/modules/plan-runner/normalize";
import { isGuardReady } from "./guard";
import { inUserTransaction, stmtsOf, type Run } from "./try-rollback";

const PREFIX = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ";
// Chỉ các câu mà EXPLAIN ANALYZE chạy được như một truy vấn. DDL, transaction, EXPLAIN lồng nhau... không nằm trong đây.
const EXPLAINABLE = ["SelectStmt", "InsertStmt", "UpdateStmt", "DeleteStmt", "MergeStmt"];
const no = (reason: string): Outcome<Plan> => ({ kind: "not_simulated", reasonKey: `plan.notSimulated.${reason}` });

const sumPages = (n: Plan["root"]): number => (n.pagesRead ?? 0) + n.children.reduce((s, k) => s + sumPages(k), 0);

/**
 * EXPLAIN ANALYZE chạy thật câu `sql`, nên luôn nằm trong BEGIN ... ROLLBACK và đi qua `run` (lớp bảo vệ, role sqllens_user).
 * Không đụng history(): worker không ghi lại gì. Lỗi SQL ném như execute, với `position` tính theo `sql` của người dùng.
 * Giới hạn: sequence (nextval) và các tác dụng ngoài transaction không được hoàn tác bởi ROLLBACK.
 */
export async function runExplain(run: Run, sql: string): Promise<Outcome<Plan>> {
  // Không có parser thì không biết là một hay nhiều câu, và `sql` được ghép nguyên vào sau EXPLAIN: không chạy.
  if (!isGuardReady()) return no("parserUnavailable");
  // undefined = lỗi cú pháp: để database báo. PostgreSQL parse cả chuỗi trước khi chạy câu nào nên không có gì chạy.
  const stmts = stmtsOf(sql);
  if (stmts) {
    if (stmts.length === 0) return no("empty");
    if (stmts.length > 1) return no("multiple");
    if (!EXPLAINABLE.some((k) => k in stmts[0])) return no("unsupported");
  }
  if (await inUserTransaction(run)) return no("inTransaction");
  await run("BEGIN");
  let rows: unknown;
  try {
    rows = (await run(PREFIX + sql))[0].rows[0][0];
  } catch (e) {
    const err = e as { position?: string };
    // Vị trí lỗi PostgreSQL tính cả phần PREFIX; trả về theo chuỗi của người dùng.
    const p = Number(err.position) - PREFIX.length;
    if (err.position !== undefined) err.position = p > 0 ? String(p) : undefined;
    throw e;
  } finally {
    await run("ROLLBACK");
  }
  const plan = normalizePostgres(rows);
  return {
    kind: "conclusion",
    label: "real",
    data: plan,
    evidence: [{ kind: "explain_analyze", messageKey: "plan.explain.analyzed", values: { rows: plan.root.actualRows ?? 0, pages: sumPages(plan.root) } }],
  };
}
