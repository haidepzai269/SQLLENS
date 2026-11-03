// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { beforeAll, describe, expect, it } from "vitest";
import type { BTreeModel } from "@/contracts/btree";
import { readBTree } from "./btree-read";
import { loadGuard } from "./guard";
import { createSession } from "./roles";

let s: Awaited<ReturnType<typeof createSession>>;
type O = { probeKey?: string; maxNodes?: number };
const rd = (name: string, o?: O) => s.adminSession((q) => readBTree(q, name, o));
const model = async (name: string, o?: O) => {
  const r = await rd(name, o);
  if (r.model.kind !== "conclusion") throw new Error(r.model.reasonKey);
  return { path: r.path, data: r.model.data as BTreeModel };
};
const val = async (sql: string) => (await s.run(sql))[0].rows[0][0];
const heap = async (sql: string) => Number(/\((\d+),/.exec(String(await val(sql)))![1]);
const ns = (reasonKey: string) => ({ kind: "not_simulated", reasonKey: `btreeRead.${reasonKey}` });

beforeAll(async () => {
  await loadGuard();
  s = await createSession(await PGlite.create({ extensions: { pageinspect } }));
  await s.run(`CREATE TABLE t(id int primary key, b bigint, tx text, u uuid, ts timestamptz, f float8);
    INSERT INTO t SELECT g, g * 10000000000, 'k' || lpad(g::text, 6, '0'), md5(g::text)::uuid, timestamptz '2024-01-01 00:00:00+00' + g * interval '1 second' + (g % 7) * interval '1 microsecond', g FROM generate_series(1, 100000) g;
    CREATE INDEX t_b ON t(b); CREATE INDEX t_tx ON t(tx); CREATE INDEX t_u ON t(u); CREATE INDEX t_ts ON t(ts); CREATE INDEX t_f ON t(f);
    CREATE INDEX t_multi ON t(tx, id); CREATE INDEX t_hash ON t USING hash(id); CREATE INDEX "Odd'; DROP TABLE t; --" ON t(b);
    CREATE TABLE e(id int primary key);`);
}, 120_000);

describe("readBTree", { timeout: 60_000 }, () => {
  it("AC1 + AC2: int 100k khớp bt_metap, khóa tăng dần, path đến heap thật", async () => {
    const { data, path } = await model("t_pkey", { probeKey: "54321", maxNodes: 1000 });
    const [m] = await s.adminSession((q) => q("SELECT root, level FROM public.bt_metap('public.t_pkey')"));
    expect([data.rootPage, data.height]).toEqual([Number(m.rows[0][0]), Number(m.rows[0][1]) + 1]);
    const size = await s.adminSession(async (q) => (await q("SELECT pg_relation_size('public.t_pkey')"))[0].rows[0][0]);
    expect(data.totalPages).toBe(Number(size) / 8192);
    expect(data.hidden).toEqual([]);
    for (const n of data.nodes.filter((x) => x.level === 0)) {
      const k = n.keys.map(Number);
      expect(k).toEqual([...k].sort((a, b) => a - b));
    }
    expect(path!.pages[0]).toBe(data.rootPage);
    expect(path!.pages).toHaveLength(data.height);
    expect(data.nodes.find((n) => n.page === path!.pages.at(-1))!.keys).toContain("54321");
    expect(path!.heapPage).toBe(await heap("SELECT ctid::text FROM t WHERE id = 54321"));
  });

  it("AC3: cây lớn hơn maxNodes chỉ đọc đường đi và anh em, phần còn lại vào hidden", async () => {
    const { data, path } = await model("t_pkey", { probeKey: "54321", maxNodes: 5 });
    expect(data.nodes.length).toBeLessThanOrEqual(path!.pages.length * 3);
    for (const p of path!.pages) expect(data.nodes.map((n) => n.page)).toContain(p);
    const hidden = data.hidden.reduce((a, h) => a + h.count, 0);
    expect(data.nodes.length + hidden).toBe(data.totalPages - 1);
  });

  it("AC3: không có probeKey thì mở rộng từ root theo ngân sách", async () => {
    const { data } = await model("t_pkey", { maxNodes: 4 });
    expect(data.nodes).toHaveLength(4);
    expect(data.nodes[0].page).toBe(data.rootPage);
  });

  it.each([
    ["t_b", "540000000000000", "540000000000000"],
    ["t_tx", "k054321", "k054321"],
    ["t_ts", "2024-01-01 15:05:21.000001+00", "2024-01-01 15:05:21.000001"],
  ])("AC4 kiểu của %s hiện đúng dạng chữ", async (name, probe, prefix) => {
    const { data, path } = await model(name, { probeKey: probe, maxNodes: 1000 });
    const leaf = data.nodes.find((n) => n.page === path!.pages.at(-1))!;
    expect(leaf.keys.some((k) => k.startsWith(prefix)), leaf.keys.slice(0, 3).join("|")).toBe(true);
    expect(path!.heapPage).toBe(await heap(name === "t_tx" ? "SELECT ctid::text FROM t WHERE tx = 'k054321'" : `SELECT ctid::text FROM t WHERE ${name === "t_b" ? "b" : "ts"} = '${probe}'`));
  });

  it("AC4 uuid: khóa đúng dạng và path đến đúng heap", async () => {
    const u = String(await val("SELECT u::text FROM t WHERE id = 777"));
    const { data, path } = await model("t_u", { probeKey: u, maxNodes: 1000 });
    expect(data.nodes.find((n) => n.page === path!.pages.at(-1))!.keys).toContain(u);
    expect(path!.heapPage).toBe(await heap("SELECT ctid::text FROM t WHERE id = 777"));
  });

  it("AC4 nhiều cột hiện đủ cột; kiểu chưa đọc được là NotSimulated", async () => {
    const { data } = await model("t_multi", { maxNodes: 1000 });
    expect(data.columns).toEqual(["tx", "id"]);
    expect(data.nodes.find((n) => n.level === 0)!.keys[0]).toMatch(/^k\d{6}, \d+$/);
    for (const n of data.nodes.filter((x) => x.level > 0)) for (const k of n.keys) expect(k).toMatch(/^(k\d{6}(, \d+)?)?$/);
    expect((await rd("t_f")).model).toEqual(ns("keyType"));
  });

  it("AC5 hash, tên không có, tên là bảng, tên lạ", async () => {
    const reason = async (n: string) => (await rd(n)).model;
    expect(await reason("t_hash")).toEqual(ns("notBtree"));
    expect(await reason("khong_co")).toEqual(ns("notFound"));
    expect(await reason("t")).toEqual(ns("notIndex"));
    expect(await reason("T_B")).toEqual(ns("notFound"));
    expect(await reason("x'; DROP TABLE t; --")).toEqual(ns("notFound"));
    expect((await reason("Odd'; DROP TABLE t; --")).kind).toBe("conclusion");
    expect(await val("SELECT count(*)::int FROM t")).toBe(100000);
  });

  it("ca biên: bảng rỗng, khóa trùng nhiều, probe sai", async () => {
    const e = await model("e_pkey");
    expect(e.data.nodes.length).toBeLessThanOrEqual(1);
    await s.run("CREATE TABLE d(k int); INSERT INTO d SELECT g % 3 FROM generate_series(1, 30000) g; CREATE INDEX d_k ON d(k)");
    const { data, path } = await model("d_k", { probeKey: "1", maxNodes: 1000 });
    expect(data.nodes.some((n) => n.level === 0 && n.keys.includes("1"))).toBe(true);
    expect(path!.heapPage).toBeDefined();
    expect((await model("t_pkey", { probeKey: "abc" })).path).toBeUndefined();
  });

  it("AC6 không đổi role, search_path, history; lớp hai vẫn đạt", async () => {
    const who = async () => [await val("SELECT current_user"), await val("SELECT current_setting('search_path')")];
    const before = await who();
    await s.run("SET search_path TO public, pg_catalog");
    const sp = await who();
    await rd("t_pkey", { probeKey: "5" });
    await rd("không có");
    expect(await who()).toEqual([before[0], sp[1]]);
    await expect(s.run("SELECT 1")).resolves.toBeTruthy();
  });

  it("hàm người dùng tạo trong public không chen vào câu quản trị", async () => {
    await s.run("CREATE FUNCTION public.format(text, text, text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN CREATE ROLE pwned; RETURN 'x'; END $$");
    await s.run("SET search_path TO public, pg_catalog");
    expect((await rd("t_pkey")).model.kind).toBe("conclusion");
    const r = await s.adminQuery("SELECT count(*)::int FROM pg_roles WHERE rolname = 'pwned'");
    expect(r[0].rows[0][0]).toBe(0);
  });

  it("trong transaction của người dùng: lỗi ở kênh quản trị không làm kẹt role, transaction vẫn dùng được", async () => {
    await s.run("SET search_path TO public");
    await s.run("BEGIN");
    await s.run("INSERT INTO e VALUES (1)");
    await expect(s.adminSession((q) => q("SELECT * FROM public.bt_metap('public.khong_co')"))).rejects.toThrow();
    expect(await val("SELECT current_user")).toBe("sqllens_user");
    expect(await val("SELECT current_setting('search_path')")).toBe("public");
    expect((await rd("t_pkey")).model.kind).toBe("conclusion");
    expect(await val("SELECT count(*)::int FROM e")).toBe(1);
    await s.run("ROLLBACK");
    expect(await val("SELECT count(*)::int FROM e")).toBe(0);
    expect(await val("SELECT current_user")).toBe("sqllens_user");
  });
});
