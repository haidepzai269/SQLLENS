import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PlanNode } from "@/contracts/plan";
import { normalizeMysql, normalizePostgres } from ".";

const sample = (n: string): unknown => JSON.parse(readFileSync(`src/modules/plan-runner/normalize/samples/mysql-${n}.json`, "utf8"));
const flat = (n: PlanNode): PlanNode[] => [n, ...n.children.flatMap(flat)];

describe("normalizeMysql (mẫu thật từ mysql:8.4.13)", () => {
  it("full scan", () => {
    const p = normalizeMysql(sample("full-scan"));
    expect(p).toMatchObject({ engine: "mysql", analyzed: false });
    expect(p.root).toMatchObject({ kind: "seq_scan", label: "ALL", table: "users", estimatedRows: 200, children: [] });
    expect(p.root.condition).toContain("email");
    expect(p.root.actualRows).toBeUndefined();
    expect(p.root.pagesRead).toBeUndefined();
  });

  it("index lookup", () => {
    const p = normalizeMysql(sample("index-lookup"));
    expect(p.root).toMatchObject({ kind: "index_scan", index: "PRIMARY", table: "users", estimatedRows: 1 });
  });

  it("join: nested loop hai bảng", () => {
    const p = normalizeMysql(sample("join"));
    expect(p.root.kind).toBe("nested_loop");
    expect(p.root.children.map((c) => [c.table, c.kind, c.index])).toEqual([
      ["u", "index_scan", "city"],
      ["o", "index_scan", "user_id"],
    ]);
  });

  it("hash join lấy từ using_join_buffer", () => {
    const p = normalizeMysql(sample("hash-join"));
    expect(p.root).toMatchObject({ kind: "hash_join", label: "hash join" });
    expect(p.root.children.map((c) => c.kind)).toEqual(["seq_scan", "seq_scan"]);
  });

  it("sort: chỉ có nút sort khi using_filesort", () => {
    const p = normalizeMysql(sample("sort"));
    expect(p.root).toMatchObject({ kind: "sort", label: "ordering_operation" });
    expect(p.root.children[0]).toMatchObject({ kind: "index_scan", label: "range", table: "orders" });
    const noSort = { query_block: { ordering_operation: { using_filesort: false, table: { table_name: "t", access_type: "index", key: "k", using_index: true } } } };
    expect(normalizeMysql(noSort).root).toMatchObject({ kind: "index_only_scan", table: "t" });
  });

  it("group, subquery bảng tạm, union", () => {
    expect(normalizeMysql(sample("group")).root).toMatchObject({ kind: "aggregate", children: [{ kind: "index_only_scan" }] });
    const sub = normalizeMysql(sample("subquery")).root;
    expect(sub.kind).toBe("nested_loop");
    expect(sub.children[1].children[0]).toMatchObject({ kind: "seq_scan", table: "orders" });
    const un = normalizeMysql(sample("union")).root;
    expect(un).toMatchObject({ kind: "other", label: "union_result" });
    expect(un.children).toHaveLength(2);
  });

  it("id duy nhất, không trường thời gian hay chi phí, nhận chuỗi JSON, input sai thì TypeError", () => {
    for (const n of ["join", "subquery", "union"]) {
      const ids = flat(normalizeMysql(sample(n)).root).map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(JSON.stringify(normalizeMysql(sample("join")))).not.toMatch(/cost|time/i);
    expect(normalizeMysql(JSON.stringify(sample("full-scan"))).root.kind).toBe("seq_scan");
    expect(() => normalizeMysql({})).toThrow(TypeError);
  });

  it("khối lạ hoặc rỗng thì kind other, không ném", () => {
    expect(normalizeMysql({ query_block: { message: "No tables used" } }).root).toMatchObject({ kind: "other", label: "No tables used" });
    expect(normalizeMysql({ query_block: { select_id: 1 } }).root).toMatchObject({ kind: "other", label: "query_block" });
    expect(normalizeMysql({ query_block: { table: { table_name: "t" } } }).root).toMatchObject({ kind: "other", label: "unknown" });
  });
});

describe("normalizePostgres", () => {
  const scan = (extra: object) => ({ "Node Type": "Seq Scan", "Relation Name": "t", "Plan Rows": 10, "Actual Rows": 5, "Actual Loops": 1, ...extra });

  it("pagesRead là của chính nút (trừ con), actualRows là tổng qua loops", () => {
    const raw = [
      {
        Plan: {
          "Node Type": "Nested Loop", "Plan Rows": 3, "Actual Rows": 4, "Actual Loops": 1, "Shared Hit Blocks": 30, "Shared Read Blocks": 2,
          "Actual Total Time": 1.5,
          Plans: [scan({ "Shared Hit Blocks": 10 }), scan({ "Node Type": "Index Scan", "Index Name": "i", "Actual Rows": 1, "Actual Loops": 8, "Shared Hit Blocks": 20, "Shared Read Blocks": 1 })],
        },
        "Execution Time": 3,
      },
    ];
    const p = normalizePostgres(raw);
    expect(p.analyzed).toBe(true);
    expect(p.root).toMatchObject({ kind: "nested_loop", pagesRead: 1, actualRows: 4 });
    expect(p.root.children[1]).toMatchObject({ kind: "index_scan", index: "i", loops: 8, actualRows: 8, pagesRead: 21 });
    expect(JSON.stringify(p)).not.toMatch(/time/i);
  });

  it("không ANALYZE thì analyzed false; thiếu buffers thì pagesRead undefined; nút lạ giữ label", () => {
    const p = normalizePostgres({ Plan: { "Node Type": "Foreign Scan", "Plan Rows": 1 } });
    expect(p).toMatchObject({ analyzed: false, root: { kind: "other", label: "Foreign Scan", pagesRead: undefined, actualRows: undefined } });
    expect(normalizePostgres(JSON.stringify([{ Plan: { "Node Type": "Hash Join" } }])).root.kind).toBe("hash_join");
  });

  it("plan rất sâu (1000 tầng) và input sai", () => {
    let n: Record<string, unknown> = { "Node Type": "Result" };
    for (let i = 0; i < 1000; i++) n = { "Node Type": "Limit", Plans: [n] };
    let d = 0;
    for (let c = normalizePostgres({ Plan: n }).root; c.children[0]; c = c.children[0]) d++;
    expect(d).toBe(1000);
    expect(() => normalizePostgres([])).toThrow(TypeError);
    expect(() => normalizePostgres(null)).toThrow(TypeError);
  });
});
