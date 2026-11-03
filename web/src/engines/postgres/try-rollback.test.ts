// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadGuard } from "./guard";
import { createSession } from "./roles";
import { runTryChange } from "./try-rollback";

let s: Awaited<ReturnType<typeof createSession>>;
const CHECKSUM = "SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM orders t";
const IDX = "SELECT count(*)::int FROM pg_indexes WHERE tablename = 'orders'";
const val = async (sql: string) => (await s.run(sql))[0].rows[0][0];
const pages = (x: { sharedHitBlocks: number; sharedReadBlocks: number }) => x.sharedHitBlocks + x.sharedReadBlocks;
const SELECT_42 = "SELECT * FROM orders WHERE customer_id = 42";
const CREATE = "CREATE INDEX ON orders(customer_id)";

beforeAll(async () => {
  await loadGuard();
  s = await createSession(await PGlite.create({ extensions: { pageinspect } }));
  await s.run("CREATE TABLE orders(id int primary key, customer_id int, note text)");
  await s.run("INSERT INTO orders SELECT g, g % 1000, 'n' || g FROM generate_series(1, 100000) g");
  await s.run("ANALYZE orders");
}, 120_000);

describe("runTryChange", { timeout: 30_000 }, () => {
  it("AC1 + AC2: index giảm số trang, hoàn tác sạch", async () => {
    const sum = await val(CHECKSUM);
    const idx = await val(IDX);
    const r = await runTryChange(s.run, CREATE, SELECT_42);
    if (r.kind !== "conclusion") throw new Error("expected conclusion");
    expect(r.label).toBe("real");
    expect(r.evidence).toHaveLength(2);
    expect(pages(r.data.after)).toBeLessThan(pages(r.data.before));
    expect(r.data.before.nodeTypes).toContain("Seq Scan");
    expect(r.data.after.nodeTypes.some((n) => /Index Scan|Bitmap Index Scan/.test(n))).toBe(true);
    expect(await val(IDX)).toBe(idx);
    expect(await val(CHECKSUM)).toBe(sum);
    expect(await val("SELECT current_user")).toBe("sqllens_user");
  });

  it.each([
    ["COMMIT", "transaction"],
    ["ROLLBACK", "transaction"],
    ["BEGIN", "transaction"],
    ["SAVEPOINT x", "transaction"],
    ["CREATE INDEX i1 ON orders(note); COMMIT", "transaction"],
    ["CREATE INDEX CONCURRENTLY ON orders(customer_id)", "concurrently"],
  ])("AC3 từ chối %s", async (change, why) => {
    const sum = await val(CHECKSUM);
    expect(await runTryChange(s.run, change, SELECT_42)).toEqual({ kind: "not_simulated", reasonKey: `tryChange.${why}` });
    expect(await val(IDX)).toBe(1);
    expect(await val(CHECKSUM)).toBe(sum);
  });

  it("probe nhiều câu bị từ chối (không để chèn câu sau EXPLAIN)", async () => {
    const r = await runTryChange(s.run, CREATE, "SELECT 1; DROP TABLE orders");
    expect(r).toEqual({ kind: "not_simulated", reasonKey: "tryChange.probeSingle" });
    expect(await val("SELECT count(*)::int FROM orders")).toBe(100000);
  });

  it("AC4 lỗi cú pháp và lỗi chạy: báo lỗi, không đổi dữ liệu, phiên còn dùng được", async () => {
    const sum = await val(CHECKSUM);
    await expect(runTryChange(s.run, "CREAT INDEX x", SELECT_42)).rejects.toThrow(/syntax/);
    await expect(runTryChange(s.run, "CREATE TABLE tmp_x(a int); CREATE INDEX ON nope(a)", SELECT_42)).rejects.toThrow(/nope/);
    expect(await val("SELECT count(*)::int FROM pg_tables WHERE tablename = 'tmp_x'")).toBe(0);
    expect(await val(IDX)).toBe(1);
    expect(await val(CHECKSUM)).toBe(sum);
    expect(await val("SELECT 1")).toBe(1);
  });

  it("AC5 probe ghi dữ liệu vẫn bị hoàn tác", async () => {
    const sum = await val(CHECKSUM);
    for (const probe of [
      "UPDATE orders SET note = 'x' WHERE customer_id = 42",
      "DELETE FROM orders WHERE customer_id = 7",
      "INSERT INTO orders SELECT g + 1000000, 1, 'z' FROM generate_series(1, 50) g",
    ]) {
      const r = await runTryChange(s.run, CREATE, probe);
      expect(r.kind, probe).toBe("conclusion");
      expect(await val(CHECKSUM), probe).toBe(sum);
      expect(await val(IDX)).toBe(1);
    }
  });

  it("ca biên: probe dùng $1 chưa gán báo lỗi rõ", async () => {
    await expect(runTryChange(s.run, CREATE, "SELECT * FROM orders WHERE id = $1")).rejects.toThrow(/\$1|parameter/);
    expect(await val(IDX)).toBe(1);
  });

  it("change vẫn qua checkUserSql: SET ROLE bị chặn và không đổi gì", async () => {
    await expect(runTryChange(s.run, "SET ROLE postgres", SELECT_42)).rejects.toMatchObject({ reasonKey: "guard.role" });
    expect(await val("SELECT current_user")).toBe("sqllens_user");
  });

  it("transaction mở của người dùng: từ chối, việc chưa commit còn nguyên", async () => {
    await s.run("BEGIN");
    await s.run("UPDATE orders SET note = 'mine' WHERE id = 1");
    expect(await runTryChange(s.run, CREATE, SELECT_42)).toEqual({ kind: "not_simulated", reasonKey: "tryChange.inTransaction" });
    expect(await val("SELECT note FROM orders WHERE id = 1")).toBe("mine");
    await s.run("ROLLBACK");
    expect(await val("SELECT note FROM orders WHERE id = 1")).toBe("n1");
  });

  it("mọi khóa tryChange.* có bản dịch vi và en", () => {
    for (const l of ["vi", "en"]) {
      const m = JSON.parse(readFileSync(`messages/${l}/tryChange.json`, "utf8"));
      for (const k of ["pagesBefore", "pagesAfter", "transaction", "concurrently", "probeSingle", "parserUnavailable", "inTransaction"])
        expect(m[k], `${l} ${k}`).toMatch(/\S/);
    }
  });
});
