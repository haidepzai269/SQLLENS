// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadGuard } from "@/engines/postgres/guard";
import { createSession } from "@/engines/postgres/roles";
import { runTryChange } from "@/engines/postgres/try-rollback";
import type { PlanNode } from "@/contracts/plan";
import { compareFix } from "./compare-fix";

let s: Awaited<ReturnType<typeof createSession>>;
const adapter = { tryChange: (c: string, p: string) => runTryChange(s.run, c, p) };
const val = async (sql: string) => (await s.run(sql))[0].rows[0][0];
const CHECKSUM = "SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM orders t";
const PROBE = "SELECT * FROM orders WHERE customer_id = 42";
const kinds = (n: PlanNode): string[] => [n.kind, ...n.children.flatMap(kinds)];

beforeAll(async () => {
  await loadGuard();
  s = await createSession(await PGlite.create({ extensions: { pageinspect } }));
  await s.run("CREATE TABLE orders(id int primary key, customer_id int, note text)");
  await s.run("INSERT INTO orders SELECT g, g % 1000, 'n' || g FROM generate_series(1, 10000) g");
  await s.run("ANALYZE orders");
}, 120_000);

describe("compareFix", { timeout: 30_000 }, () => {
  it("AC1 + AC2 + AC5: index giảm trang, dữ liệu không đổi, không có thời gian", async () => {
    const sum = await val(CHECKSUM);
    const r = await compareFix(adapter, { change: "CREATE INDEX ON orders(customer_id)", probe: PROBE });
    if (r.kind !== "conclusion") throw new Error("expected conclusion");
    expect(r.label).toBe("real");
    expect(r.data.pagesChange).toBe("fewer");
    expect(r.data.rowsChanged).toBe(false);
    expect(kinds(r.data.after.plan.root).some((k) => k === "index_scan" || k === "bitmap_scan")).toBe(true);
    expect(await val(CHECKSUM)).toBe(sum);
    expect(await val("SELECT count(*)::int FROM pg_indexes WHERE tablename = 'orders'")).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/time|"ms"|millis/i);
    for (const lang of ["vi", "en"]) {
      const m = JSON.parse(readFileSync(`messages/${lang}/whatIfCompare.json`, "utf8")) as Record<string, string>;
      for (const v of Object.values(m)) expect(v.toLowerCase()).not.toMatch(/ổn|tốt hơn|tối ưu|(good|ok|fine|better|optimal)/);
    }
  });

  it("AC3: change vô can là same; DELETE làm rowsChanged", async () => {
    const same = await compareFix(adapter, { change: "CREATE TABLE other(x int)", probe: PROBE });
    if (same.kind !== "conclusion") throw new Error("expected conclusion");
    expect(same.data.pagesChange).toBe("same");
    const del = await compareFix(adapter, { change: "DELETE FROM orders WHERE customer_id = 42", probe: PROBE });
    if (del.kind !== "conclusion") throw new Error("expected conclusion");
    expect(del.data.rowsChanged).toBe(true);
    expect(await val("SELECT count(*)::int FROM orders WHERE customer_id = 42")).toBe(10);
  });

  it("AC4: COMMIT hoặc probe nhiều câu: not_simulated", async () => {
    expect(await compareFix(adapter, { change: "CREATE INDEX ON orders(note); COMMIT", probe: PROBE })).toEqual({ kind: "not_simulated", reasonKey: "tryChange.transaction" });
    expect(await compareFix(adapter, { change: "SELECT 1", probe: "SELECT 1; SELECT 2" })).toEqual({ kind: "not_simulated", reasonKey: "tryChange.probeSingle" });
  });

  it("ca biên: plan hỏng thành not_simulated; trang bằng 0 là same; probe ghi dữ liệu được hoàn tác", async () => {
    const stats = { rows: 0, sharedHitBlocks: 0, sharedReadBlocks: 0, nodeTypes: [] };
    const bad = { tryChange: async () => ({ kind: "conclusion" as const, label: "real" as const, evidence: [{ kind: "k", messageKey: "k" }] as never, data: { before: stats, after: stats, plans: { before: "{}", after: "{}" } } }) };
    expect(await compareFix(bad, { change: "x", probe: "y" })).toEqual({ kind: "not_simulated", reasonKey: "whatIfCompare.planUnreadable" });
    const zero = { Plan: { "Node Type": "Result", "Actual Rows": 0 } };
    const ok = { tryChange: async () => ({ ...(await bad.tryChange()), data: { before: stats, after: stats, plans: { before: [zero], after: [zero] } } }) };
    const z = await compareFix(ok, { change: "x", probe: "y" });
    expect(z.kind === "conclusion" && z.data.pagesChange).toBe("same");
    const sum = await val(CHECKSUM);
    const w = await compareFix(adapter, { change: "CREATE INDEX ON orders(note)", probe: "UPDATE orders SET note = 'z'" });
    expect(w.kind).toBe("conclusion");
    expect(await val(CHECKSUM)).toBe(sum);
  });

  it("MySQL: chuẩn hóa đúng plan MySQL, rowsChanged là false khi rows_examined giảm", async () => {
    const beforeStats = { rows: 2000, sharedHitBlocks: 0, sharedReadBlocks: 202, nodeTypes: ["ALL"] };
    const afterStats = { rows: 1, sharedHitBlocks: 0, sharedReadBlocks: 1, nodeTypes: ["ref"] };
    const mysqlBefore = { query_block: { select_id: 1, cost_info: { query_cost: "201.50" }, table: { table_name: "users", access_type: "ALL", rows_examined_per_scan: 2000 } } };
    const mysqlAfter = { query_block: { select_id: 1, cost_info: { query_cost: "1.00" }, table: { table_name: "users", access_type: "ref", key: "idx_email", rows_examined_per_scan: 1 } } };

    const mysqlAdapter = {
      engine: "mysql" as const,
      tryChange: async () => ({
        kind: "conclusion" as const,
        label: "real" as const,
        evidence: [{ kind: "pages", messageKey: "tryChange.pagesBefore" }] as never,
        data: {
          before: beforeStats,
          after: afterStats,
          plans: { before: mysqlBefore, after: mysqlAfter },
        },
      }),
    };

    const res = await compareFix(mysqlAdapter, { change: "CREATE INDEX idx_email ON users(email)", probe: "SELECT * FROM users WHERE email = 'u5'" });
    expect(res.kind).toBe("conclusion");
    if (res.kind === "conclusion") {
      expect(res.label).toBe("real");
      expect(res.data.pagesChange).toBe("fewer");
      expect(res.data.rowsChanged).toBe(false);
      expect(res.data.before.plan.root.kind).toBe("seq_scan");
      expect(res.data.after.plan.root.kind).toBe("index_scan");
    }
  });
});
