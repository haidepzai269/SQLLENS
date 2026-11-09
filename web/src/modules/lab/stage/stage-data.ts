import type { Outcome } from "@/contracts/conclusion";
import type { EngineAdapter, QueryResult } from "@/contracts/engine";
import type { Plan, PlanNode } from "@/contracts/plan";
import type { ParsedStatement } from "@/modules/sql-intake/parser";
import { SCHEMA_QUERY } from "@/modules/data-lab/generate/plan-data";

// Hai câu đọc catalog chạy bằng execute (role quyền thấp, không có kênh quản trị). Mọi tên catalog ghi rõ `pg_catalog.`
// để bảng hay hàm người dùng tạo trong public, kể cả sau SET search_path, không che được; câu không chứa SQL người dùng.
const NAMES = /(?<![.\w])(pg_class|pg_namespace|pg_attribute|pg_index|pg_constraint|pg_am|pg_get_indexdef|pg_get_serial_sequence|format_type|quote_ident|array_length)\b/g;
export const pgCatalog = (sql: string) => sql.replace(NAMES, "pg_catalog.$1");

export const STAGE_SCHEMA_QUERY = pgCatalog(SCHEMA_QUERY);
export const STAGE_INDEX_QUERY = pgCatalog(`
SELECT ic.relname AS index_name, tc.relname AS table_name, am.amname AS method
FROM pg_index i
JOIN pg_class ic ON ic.oid = i.indexrelid
JOIN pg_class tc ON tc.oid = i.indrelid
JOIN pg_namespace n ON n.oid = tc.relnamespace
JOIN pg_am am ON am.oid = ic.relam
WHERE n.nspname = 'public' AND tc.relkind IN ('r', 'p')
ORDER BY tc.relname, ic.relname`);

// MySQL: cùng các cột như SCHEMA_QUERY của PostgreSQL. Cờ là 0/1 (mysqlSchema đổi thành boolean). Chỉ đọc database của phiên.
export const MYSQL_SCHEMA_QUERY = `
SELECT c.TABLE_SCHEMA AS schema_name, c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name, c.COLUMN_TYPE AS data_type,
  c.IS_NULLABLE = 'YES' AS nullable, c.COLUMN_KEY = 'PRI' AS is_pk, c.COLUMN_KEY = 'UNI' AS is_unique,
  (SELECT k.REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
    AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1) AS ref_table,
  (SELECT k.REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
    AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1) AS ref_column
FROM information_schema.COLUMNS c
JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
WHERE c.TABLE_SCHEMA = DATABASE()
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`;

export const MYSQL_INDEX_QUERY = `
SELECT s.INDEX_NAME AS index_name, s.TABLE_NAME AS table_name, s.INDEX_TYPE AS method
FROM information_schema.STATISTICS s
JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.TABLE_SCHEMA AND t.TABLE_NAME = s.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
WHERE s.TABLE_SCHEMA = DATABASE()
GROUP BY s.TABLE_NAME, s.INDEX_NAME, s.INDEX_TYPE
ORDER BY s.TABLE_NAME, s.INDEX_NAME`;
const FLAGS = ["nullable", "is_pk", "is_unique"];
export function mysqlSchema(r: QueryResult): QueryResult {
  const at = FLAGS.map((n) => r.columns.indexOf(n));
  return { ...r, rows: r.rows.map((row) => row.map((v, i) => (at.includes(i) ? Number(v) === 1 : v))) };
}

export type IndexInfo = { name: string; table: string; method: string };

/** Câu SELECT cuối trong SQL đã chạy. `n` đếm từ 1 theo thứ tự câu. */
export function lastSelect(sql: string, statements: ParsedStatement[]): { n: number; sql: string } | undefined {
  const s = [...statements].reverse().find((x) => x.kind === "select");
  return s && { n: s.index + 1, sql: sql.slice(s.start, s.end) };
}

const JOINS = ["nested_loop", "hash_join", "merge_join"];
export function joinNodes(plan: Plan): PlanNode[] {
  const out: PlanNode[] = [];
  const walk = (n: PlanNode) => (JOINS.includes(n.kind) && out.push(n), n.children.forEach(walk));
  walk(plan.root);
  return out;
}

/** explain nhớ theo câu SQL cho một lần chạy: tab Plan và cột Rủi ro dùng chung, mỗi câu chỉ chạy một lần (explain chạy thật câu SELECT). */
export function memoExplain(db: EngineAdapter): (sql: string) => Promise<Outcome<Plan>> {
  const cache = new Map<string, Promise<Outcome<Plan>>>();
  return (sql) => {
    let p = cache.get(sql);
    if (!p) cache.set(sql, (p = db.explain(sql)));
    return p;
  };
}
