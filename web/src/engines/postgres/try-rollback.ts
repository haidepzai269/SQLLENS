import { parseSync } from "pgsql-parser";
import type { Outcome } from "@/contracts/conclusion";
import type { ProbeStats, QueryResult, TryChangeResult } from "@/contracts/engine";
import { isGuardReady } from "./guard";

type Run = (sql: string) => Promise<QueryResult[]>;
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null;

const no = (reason: string): Outcome<TryChangeResult> => ({ kind: "not_simulated", reasonKey: `tryChange.${reason}` });

/** Số câu của `sql`, hoặc các loại câu; undefined nếu parser không đọc được (lỗi cú pháp: để database báo). */
function stmtsOf(sql: string): Obj[] | undefined {
  try {
    const s = (parseSync(sql) as { stmts?: { stmt?: Obj }[] }).stmts;
    return s?.map((x) => x.stmt ?? {});
  } catch {
    return undefined;
  }
}

function stats(raw: unknown): { stats: ProbeStats; plan: unknown } {
  const plan = (typeof raw === "string" ? JSON.parse(raw) : raw) as Obj[];
  const top = plan[0].Plan as Obj;
  const nodeTypes: string[] = [];
  const walk = (n: Obj) => {
    nodeTypes.push(String(n["Node Type"]));
    (n.Plans as Obj[] | undefined)?.forEach(walk);
  };
  walk(top);
  // Buffers của nút gốc đã gồm cả nút con.
  return {
    stats: {
      rows: Number(top["Actual Rows"] ?? 0),
      sharedHitBlocks: Number(top["Shared Hit Blocks"] ?? 0),
      sharedReadBlocks: Number(top["Shared Read Blocks"] ?? 0),
      nodeTypes: [...new Set(nodeTypes)],
    },
    plan,
  };
}

/** Lớp bảo vệ riêng của tryChange. Trả NotSimulated trước khi chạy bất cứ thứ gì. */
function reject(change: string, probe: string): Outcome<TryChangeResult> | undefined {
  // Parser chưa tải thì không kiểm được COMMIT/BEGIN lẫn câu thứ hai trong probe, nên không chạy (khác checkUserSql, ở đây fail-closed).
  if (!isGuardReady()) return no("parserUnavailable");
  const cs = stmtsOf(change);
  for (const s of cs ?? []) {
    if ("TransactionStmt" in s) return no("transaction");
    const ix = s.IndexStmt;
    if (isObj(ix) && ix.concurrent) return no("concurrently");
  }
  const ps = stmtsOf(probe);
  if (ps && ps.length !== 1) return no("probeSingle");
  return undefined;
}

/** Đo probe trước, BEGIN, chạy change, đo lại, ROLLBACK. Mỗi lần đo nằm trong transaction để probe ghi dữ liệu cũng bị hoàn tác. */
export async function runTryChange(run: Run, change: string, probe: string): Promise<Outcome<TryChangeResult>> {
  const rejected = reject(change, probe);
  if (rejected) return rejected;
  const measure = async () => {
    const [r] = await run(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${probe}`);
    return stats(r.rows[0][0]);
  };
  const inTxn = async <T,>(fn: () => Promise<T>) => {
    await run("BEGIN");
    try {
      return await fn();
    } finally {
      await run("ROLLBACK");
    }
  };
  const before = await inTxn(measure);
  const after = await inTxn(async () => {
    await run(change);
    return measure();
  });
  const pages = (s: ProbeStats) => s.sharedHitBlocks + s.sharedReadBlocks;
  return {
    kind: "conclusion",
    label: "real",
    data: { before: before.stats, after: after.stats, plans: { before: before.plan, after: after.plan } },
    evidence: [
      { kind: "pages_before", messageKey: "tryChange.pagesBefore", values: { pages: pages(before.stats) } },
      { kind: "pages_after", messageKey: "tryChange.pagesAfter", values: { pages: pages(after.stats) } },
    ],
  };
}
