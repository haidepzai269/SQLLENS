import { describe, expect, it } from "vitest";
import type { Plan, PlanNode } from "@/contracts/plan";
import type { ParsedStatement } from "@/modules/sql-intake/parser";
import { joinNodes, lastSelect, MYSQL_INDEX_QUERY, pgCatalog, STAGE_INDEX_QUERY, STAGE_SCHEMA_QUERY } from "./stage-data";

const n = (id: string, kind: PlanNode["kind"], children: PlanNode[] = []): PlanNode => ({ id, kind, label: id, children });
const st = (index: number, kind: ParsedStatement["kind"], start: number, end: number) => ({ index, kind, start, end, tables: [], ast: null }) as ParsedStatement;

describe("stage-data", () => {
  it("MYSQL_INDEX_QUERY truy vấn information_schema.STATISTICS cho base tables", () => {
    expect(MYSQL_INDEX_QUERY).toContain("information_schema.STATISTICS");
    expect(MYSQL_INDEX_QUERY).toContain("TABLE_SCHEMA = DATABASE()");
    expect(MYSQL_INDEX_QUERY).toContain("INDEX_NAME AS index_name");
  });

  it("mọi tên catalog đều có tiền tố pg_catalog., không gắn hai lần", () => {
    expect(pgCatalog("SELECT 1 FROM pg_class c JOIN pg_catalog.pg_index i ON true WHERE format_type(1,1) IS NULL")).toBe(
      "SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_index i ON true WHERE pg_catalog.format_type(1,1) IS NULL",
    );
    for (const q of [STAGE_SCHEMA_QUERY, STAGE_INDEX_QUERY]) expect(q).not.toMatch(/(?<![.\w])(pg_class|pg_namespace|pg_attribute|pg_index|pg_constraint|pg_am)\b/);
  });
  it("lastSelect lấy câu SELECT cuối, đếm từ 1, và undefined khi không có", () => {
    const sql = "SELECT 1; INSERT INTO t VALUES (1); SELECT 2;";
    const stmts = [st(0, "select", 0, 9), st(1, "insert", 10, 34), st(2, "select", 36, 44)];
    expect(lastSelect(sql, stmts)).toEqual({ n: 3, sql: "SELECT 2" });
    expect(lastSelect(sql, [stmts[1]])).toBeUndefined();
  });
  it("joinNodes tìm mọi nút join trong cây", () => {
    const plan: Plan = { engine: "postgres", analyzed: true, root: n("a", "nested_loop", [n("b", "seq_scan"), n("c", "hash_join", [n("d", "seq_scan")])]) };
    expect(joinNodes(plan).map((x) => x.id)).toEqual(["a", "c"]);
    expect(joinNodes({ ...plan, root: n("z", "seq_scan") })).toEqual([]);
  });
});
