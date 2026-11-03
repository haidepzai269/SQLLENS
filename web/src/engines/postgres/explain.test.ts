// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { beforeAll, describe, expect, it } from "vitest";
import type { Plan, PlanNode } from "@/contracts/plan";
import { runExplain } from "./explain";
import { loadGuard } from "./guard";
import { createSession } from "./roles";

let s: Awaited<ReturnType<typeof createSession>>;
const val = async (sql: string) => (await s.run(sql))[0].rows[0][0];
const CHECKSUM = "SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM t";
const inTxn = () => s.run("SAVEPOINT chk").then(() => true, () => false);

async function plan(sql: string): Promise<Plan> {
  const r = await runExplain(s.run, sql);
  if (r.kind !== "conclusion") throw new Error(`expected conclusion, got ${r.reasonKey}`);
  expect(r.label).toBe("real");
  return r.data;
}
const flat = (n: PlanNode): PlanNode[] => [n, ...n.children.flatMap(flat)];
const reason = async (sql: string) => {
  const r = await runExplain(s.run, sql);
  return r.kind === "not_simulated" ? r.reasonKey : r.kind;
};

beforeAll(async () => {
  await loadGuard();
  s = await createSession(await PGlite.create({ extensions: { pageinspect } }));
  await s.run(`CREATE TABLE t(id int primary key, v int, pad text);
    INSERT INTO t SELECT g, g % 100, 'x' || g FROM generate_series(1, 10000) g;
    CREATE TABLE u(id int, v int, pad text);
    INSERT INTO u SELECT g, g % 100, 'x' || g FROM generate_series(1, 10000) g;
    CREATE INDEX u_id ON u(id);
    CREATE TABLE a(id int, k int); INSERT INTO a SELECT g, g FROM generate_series(1, 200) g;
    CREATE TABLE b(id int, k int); INSERT INTO b SELECT g, g % 200 FROM generate_series(1, 2000) g;
    ANALYZE;`);
}, 120_000);

describe("runExplain", { timeout: 30_000 }, () => {
  it("AC1: có index rồi bỏ index", async () => {
    const p = await plan("SELECT * FROM u WHERE id = 1");
    expect(p.analyzed).toBe(true);
    expect(["index_scan", "index_only_scan"]).toContain(p.root.kind);
    expect(p.root).toMatchObject({ table: "u", index: "u_id", actualRows: 1 });
    expect(p.root.pagesRead).toBeGreaterThan(0);
    await s.run("DROP INDEX u_id");
    const q = await plan("SELECT * FROM u WHERE id = 1");
    const scan = flat(q.root).find((n) => n.kind === "seq_scan")!;
    expect(scan.table).toBe("u");
    expect(scan.pagesRead!).toBeGreaterThan(p.root.pagesRead! * 5);
    await s.run("CREATE INDEX u_id ON u(id)");
  });

  it.each([
    ["nested_loop", ["enable_hashjoin", "enable_mergejoin"]],
    ["hash_join", ["enable_nestloop", "enable_mergejoin"]],
    ["merge_join", ["enable_nestloop", "enable_hashjoin"]],
  ])("AC2: ép %s, cây con giống JSON gốc", async (kind, off) => {
    await s.run(off.map((g) => `SET ${g} = off`).join(";"));
    try {
      const sql = "SELECT * FROM a JOIN b ON a.k = b.k";
      const p = await plan(sql);
      expect(p.root.kind).toBe(kind);
      const raw = (await s.run(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`))[0].rows[0][0] as { Plan: Record<string, unknown> }[];
      const shape = (n: Record<string, unknown>): unknown => [n["Node Type"], ((n.Plans as Record<string, unknown>[]) ?? []).map(shape)];
      const mine = (n: PlanNode): unknown => [n.label, n.children.map(mine)];
      expect(mine(p.root)).toEqual(shape(raw[0].Plan));
    } finally {
      await s.run("RESET enable_nestloop; RESET enable_hashjoin; RESET enable_mergejoin");
    }
  });

  it("loops lớn hơn 1: actualRows là tổng qua mọi vòng", async () => {
    await s.run("SET enable_hashjoin = off; SET enable_mergejoin = off; SET enable_material = off");
    try {
      const p = await plan("SELECT * FROM a JOIN u ON u.id = a.id");
      const inner = flat(p.root).find((n) => n.table === "u")!;
      expect(inner.loops).toBe(200);
      expect(inner.actualRows).toBe(200); // 1 dòng x 200 vòng, không phải 1
    } finally {
      await s.run("RESET enable_hashjoin; RESET enable_mergejoin; RESET enable_material");
    }
  });

  it("CTE và subplan: id duy nhất, nút lạ giữ label", async () => {
    const p = await plan("WITH c AS MATERIALIZED (SELECT id FROM a WHERE k < 5) SELECT * FROM b WHERE b.id IN (SELECT id FROM c) AND b.k = (SELECT max(k) FROM a)");
    const all = flat(p.root);
    expect(all.map((n) => n.label)).toContain("CTE Scan");
    expect(new Set(all.map((n) => n.id)).size).toBe(all.length);
  });

  it("AC3: UPDATE, DELETE, INSERT không đổi dữ liệu, không để lại transaction", async () => {
    const before = await val(CHECKSUM);
    const p = await plan("UPDATE t SET v = v + 1 WHERE id < 500");
    expect(p.root).toMatchObject({ label: "ModifyTable", kind: "other" });
    await plan("DELETE FROM t");
    await plan("INSERT INTO t SELECT g + 100000, 0, '' FROM generate_series(1, 10) g");
    expect(await val(CHECKSUM)).toBe(before);
    expect(await val("SELECT count(*)::int FROM t")).toBe(10000);
    expect(await inTxn()).toBe(false);
  });

  it("AC5: không có trường thời gian hay chi phí", async () => {
    const p = await plan("SELECT * FROM b JOIN a ON a.k = b.k");
    expect(JSON.stringify(p)).not.toMatch(/time|duration|cost/i);
  });

  it("AC6: lỗi cú pháp ném như execute, vị trí theo SQL người dùng", async () => {
    await expect(runExplain(s.run, "SELEC 1")).rejects.toMatchObject({ position: "1" });
    expect(await inTxn()).toBe(false);
    expect(await val("SELECT 1")).toBe(1);
  });

  it("AC6: transaction đang mở hoặc đã hỏng thì NotSimulated, không phá transaction", async () => {
    await s.run("BEGIN");
    await s.run("CREATE TABLE tmp_keep(x int)");
    expect(await reason("SELECT 1")).toBe("plan.notSimulated.inTransaction");
    expect(await val("SELECT count(*)::int FROM tmp_keep")).toBe(0); // việc chưa commit còn nguyên
    await s.run("ROLLBACK");
    await s.run("BEGIN");
    await expect(s.run("SELECT 1/0")).rejects.toThrow();
    expect(await reason("SELECT 1")).toBe("plan.notSimulated.inTransaction");
    await s.run("ROLLBACK");
    expect(await val("SELECT current_user")).toBe("sqllens_user");
  });

  it("câu không EXPLAIN được hoặc nhiều câu thì NotSimulated, không chạy gì", async () => {
    expect(await reason("CREATE TABLE zz(x int)")).toBe("plan.notSimulated.unsupported");
    expect(await reason("SELECT 1; DROP TABLE t")).toBe("plan.notSimulated.multiple");
    expect(await reason("   ")).toBe("plan.notSimulated.empty");
    expect(await reason("COMMIT")).toBe("plan.notSimulated.unsupported");
    expect(await reason("SET ROLE postgres")).toBe("plan.notSimulated.unsupported");
    expect(await val("SELECT count(*)::int FROM t")).toBe(10000);
    expect(await val("SELECT to_regclass('zz') IS NULL")).toBe(true);
  });

  it("đi qua lớp bảo vệ: set_config role bị chặn, vẫn là sqllens_user, không để transaction mở", async () => {
    await expect(runExplain(s.run, "SELECT set_config('role', 'postgres', false)")).rejects.toMatchObject({ reasonKey: "guard.role" });
    expect(await val("SELECT current_user")).toBe("sqllens_user");
    expect(await inTxn()).toBe(false);
  });
});
