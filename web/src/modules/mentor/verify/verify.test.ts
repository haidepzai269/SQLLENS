// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { loadModule, parseSync } from "pgsql-parser";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { EngineAdapter } from "@/contracts/engine";
import { parsePostgres, type PgParser } from "@/modules/sql-intake/parser/core";
import { loadGuard } from "@/engines/postgres/guard";
import { runExplain } from "@/engines/postgres/explain";
import { createSession } from "@/engines/postgres/roles";
import { runTryChange } from "@/engines/postgres/try-rollback";
import { verifyAnswer, type VerifiedPart } from "./index";
import { splitAnswer } from "./split";

// parseSql thật chạy trong Worker; ở đây dùng cùng lõi parse, đồng bộ.
vi.mock("@/modules/sql-intake/parser", () => ({
  parseSql: async (sql: string) => parsePostgres(sql, parseSync as unknown as PgParser),
}));

const fence = (s: string, lang = "sql") => "```" + lang + "\n" + s + "\n```\n";
const fake = (engine: "postgres" | "mysql" = "postgres") => {
  const explain = vi.fn(async () => ({ kind: "conclusion", label: "real", data: {}, evidence: [{ kind: "k", messageKey: "m" }] }) as never);
  const tryChange = vi.fn(async () => ({ kind: "conclusion", label: "real", data: {}, evidence: [{ kind: "k", messageKey: "m" }] }) as never);
  return { engine, explain, tryChange } satisfies Pick<EngineAdapter, "engine" | "explain" | "tryChange">;
};
const hiddenOf = (parts: VerifiedPart[]) => parts.filter((p) => p.kind === "hidden");

beforeAll(() => loadModule(), 60_000);

describe("splitAnswer (AC5)", () => {
  it("giữ thứ tự, nhận mọi nhãn SQL, bỏ qua ngôn ngữ khác", () => {
    for (const lang of ["sql", "pgsql", "postgresql", "postgres", "mysql", "", "SQL"]) {
      expect(splitAnswer(`a\n${fence("SELECT 1", lang)}b`)).toEqual([
        { kind: "text", text: "a\n" },
        { kind: "sql", sql: "SELECT 1" },
        { kind: "text", text: "b" },
      ]);
    }
    const py = fence("print(1)", "python");
    expect(splitAnswer(`x\n${py}y`)).toEqual([{ kind: "text", text: `x\n${py}y` }]);
  });
  it("khối chưa đóng đến hết câu; khối rỗng; không có khối", () => {
    expect(splitAnswer("t\n```sql\nSELECT 1\nFROM t")).toEqual([
      { kind: "text", text: "t\n" },
      { kind: "sql", sql: "SELECT 1\nFROM t" },
    ]);
    expect(splitAnswer("```sql\n```")).toEqual([{ kind: "sql", sql: "" }]);
    expect(splitAnswer("chỉ văn bản")).toEqual([{ kind: "text", text: "chỉ văn bản" }]);
    expect(splitAnswer("")).toEqual([]);
  });
  it("ba backtick trong chuỗi SQL không đóng khối", () => {
    expect(splitAnswer("```sql\nSELECT '```' AS x\n```\n")).toEqual([{ kind: "sql", sql: "SELECT '```' AS x" }]);
    expect(splitAnswer("````sql\nSELECT 1\n```\nSELECT 2\n````\n")).toEqual([{ kind: "sql", sql: "SELECT 1\n```\nSELECT 2" }]);
  });
});

describe("verifyAnswer với adapter giả", () => {
  const blocked = [
    "DO $$ BEGIN EXECUTE 'select 1'; END $$",
    "CALL p()",
    "DROP TABLE t",
    "DELETE FROM t",
    "UPDATE t SET a = 1",
    "INSERT INTO t VALUES (1)",
    "TRUNCATE t",
    "COPY t TO PROGRAM 'ls'",
    "SET role = postgres",
    "CREATE FUNCTION f() RETURNS int AS 'select 1' LANGUAGE sql",
    "CREATE ROLE r",
    "GRANT ALL ON t TO PUBLIC",
    "EXPLAIN ANALYZE DELETE FROM t",
    "SELECT 1; DROP TABLE t",
    "SELECT 1 -- x\n; DROP TABLE t",
    "SELECT 1 /* ; */; DROP TABLE t",
    "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
    "SELECT * INTO newt FROM t",
    "SELECT * FROM t FOR UPDATE",
    "SELECT nextval('s')",
    "SELECT set_config('role', 'postgres', false)",
    "SELECT pg_advisory_lock(1)",
    "SELECT pg_catalog.pg_read_file('/etc/passwd')",
    "SELECT 1 FROM generate_series(1, 3)",
    "CREATE INDEX CONCURRENTLY ON t(a)",
    "CREATE INDEX ON t(nextval('s'))",
    "ALTER TABLE t OWNER TO postgres",
    "ALTER TABLE t DROP COLUMN a",
    "ALTER TABLE t ADD COLUMN b int DEFAULT nextval('s')",
    "ALTER INDEX i RENAME TO j",
  ];
  it.each(blocked)("AC3 chặn, không gọi adapter: %s", async (sql) => {
    const a = fake();
    const r = await verifyAnswer(a, `trước\n${fence(sql)}sau`, { probe: "SELECT 1" });
    expect(a.explain).not.toHaveBeenCalled();
    expect(a.tryChange).not.toHaveBeenCalled();
    expect(r.parts.map((p) => p.kind)).toEqual(["text", "hidden", "text"]);
    expect(r.hiddenCount).toBe(1);
    expect(JSON.stringify(r)).not.toContain(sql.slice(0, 12));
  });

  it("cho SELECT, CREATE INDEX, ALTER TABLE hợp lệ; CREATE INDEX và ALTER không có probe thì hidden", async () => {
    const a = fake();
    const ans = fence("SELECT count(*) FROM t WHERE a = 1") + fence("CREATE INDEX ON t(a)") + fence("ALTER TABLE t ADD COLUMN b int");
    const r = await verifyAnswer(a, ans, { probe: "SELECT * FROM t" });
    expect(r.parts.map((p) => p.kind)).toEqual(["sql", "sql", "sql"]);
    expect(a.explain).toHaveBeenCalledTimes(1);
    expect(a.tryChange).toHaveBeenCalledTimes(2);
    const b = fake();
    const r2 = await verifyAnswer(b, ans);
    expect(r2.parts.map((p) => p.kind)).toEqual(["sql", "hidden", "hidden"]);
    expect(b.tryChange).not.toHaveBeenCalled();
  });

  it("engine mysql: mọi khối hidden, adapter không bị gọi", async () => {
    const a = fake("mysql");
    const r = await verifyAnswer(a, fence("SELECT 1") + fence("SELECT 2"), { probe: "SELECT 1" });
    expect(hiddenOf(r.parts)).toHaveLength(2);
    expect(r.parts[0]).toEqual({ kind: "hidden", reasonKey: "mentorVerify.notSimulated" });
    expect(a.explain).not.toHaveBeenCalled();
  });

  it("khối rỗng, lỗi cú pháp, không có khối", async () => {
    const a = fake();
    expect((await verifyAnswer(a, "```sql\n```\n")).hiddenCount).toBe(1);
    expect((await verifyAnswer(a, fence("SELEC FROM"))).hiddenCount).toBe(1);
    expect(await verifyAnswer(a, "không có khối")).toEqual({ parts: [{ kind: "text", text: "không có khối" }], hiddenCount: 0 });
    expect(a.explain).not.toHaveBeenCalled();
  });

  it("AC6 adapter ném lỗi hoặc không phải kết luận: hidden, không lộ thông báo lỗi", async () => {
    const a = fake();
    a.explain.mockRejectedValueOnce(new Error('column "secret_col" does not exist in SELECT secret_col'));
    a.explain.mockResolvedValueOnce({ kind: "not_simulated", reasonKey: "plan.x" } as never);
    const r = await verifyAnswer(a, fence("SELECT secret_col FROM t") + fence("SELECT 2"));
    expect(r.parts.map((p) => p.kind)).toEqual(["hidden", "hidden"]);
    expect(JSON.stringify(r)).not.toMatch(/secret_col|plan\.x/);
  });

  it("AC6 hết giờ: hidden, các khối sau không chạy", async () => {
    const a = fake();
    a.explain.mockImplementationOnce(() => new Promise(() => {}));
    const r = await verifyAnswer(a, fence("SELECT 1") + fence("SELECT 2"), { timeoutMs: 20 });
    expect(r.parts).toEqual([
      { kind: "hidden", reasonKey: "mentorVerify.timeout" },
      { kind: "hidden", reasonKey: "mentorVerify.timeout" },
    ]);
    expect(a.explain).toHaveBeenCalledTimes(1);
  });

  it("AC6 signal hủy: ném, các khối sau không chạy", async () => {
    const a = fake();
    const ac = new AbortController();
    a.explain.mockImplementationOnce(() => new Promise(() => {}));
    const p = verifyAnswer(a, fence("SELECT 1") + fence("SELECT 2"), { signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toBeDefined();
    expect(a.explain).toHaveBeenCalledTimes(1);
    await expect(verifyAnswer(fake(), fence("SELECT 1"), { signal: AbortSignal.abort() })).rejects.toBeDefined();
  });

  it("AC6 tối đa 5 khối được chạy thử", async () => {
    const a = fake();
    const r = await verifyAnswer(a, Array.from({ length: 7 }, (_, i) => fence(`SELECT ${i}`)).join(""));
    expect(a.explain).toHaveBeenCalledTimes(5);
    expect(r.parts.map((p) => p.kind)).toEqual(["sql", "sql", "sql", "sql", "sql", "hidden", "hidden"]);
    expect(r.hiddenCount).toBe(2);
  });
});

describe("verifyAnswer với PGlite thật", { timeout: 60_000 }, () => {
  let s: Awaited<ReturnType<typeof createSession>>;
  const val = async (sql: string) => (await s.run(sql))[0].rows[0][0];
  const adapter = () =>
    ({
      engine: "postgres" as const,
      explain: (sql: string) => runExplain(s.run, sql),
      tryChange: (c: string, p: string) => runTryChange(s.run, c, p),
    }) satisfies Pick<EngineAdapter, "engine" | "explain" | "tryChange">;
  const CHECKSUM = "SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM orders t";
  const IDX = "SELECT count(*)::int FROM pg_indexes WHERE tablename = 'orders'";

  beforeAll(async () => {
    await loadGuard();
    s = await createSession(await PGlite.create({ extensions: { pageinspect } }));
    await s.run("CREATE TABLE orders(id int primary key, customer_id int, note text)");
    await s.run("INSERT INTO orders SELECT g, g % 1000, 'n' || g FROM generate_series(1, 100000) g");
    await s.run("ANALYZE orders");
    await s.run("CREATE SEQUENCE s");
  }, 120_000);

  it("AC1 CREATE INDEX đúng: giữ, nhãn real, có số trang trước và sau, dữ liệu không đổi", async () => {
    const sum = await val(CHECKSUM);
    const idx = await val(IDX);
    const r = await verifyAnswer(adapter(), "Thử:\n" + fence("CREATE INDEX ON orders(customer_id)"), { probe: "SELECT * FROM orders WHERE customer_id = 42" });
    const p = r.parts[1];
    if (p.kind !== "sql") throw new Error("expected sql");
    expect(p.outcome.label).toBe("real");
    expect(p.outcome.evidence.map((e) => e.messageKey)).toEqual(["tryChange.pagesBefore", "tryChange.pagesAfter"]);
    expect(r.hiddenCount).toBe(0);
    expect(await val(IDX)).toBe(idx);
    expect(await val(CHECKSUM)).toBe(sum);
  });

  it("AC2 SELECT sai tên cột: hidden, JSON không còn SQL hay lỗi", async () => {
    const r = await verifyAnswer(adapter(), fence("SELECT no_such_col FROM orders"));
    expect(r.parts).toEqual([{ kind: "hidden", reasonKey: "mentorVerify.failed" }]);
    expect(JSON.stringify(r)).not.toMatch(/no_such_col|does not exist/);
    expect(await val("SELECT 1")).toBe(1);
  });

  it("AC4 hàm nguy hiểm: không đổi role, không khóa, không tiến sequence, không hiện", async () => {
    const seq = await val("SELECT last_value::text || is_called::text FROM s");
    const role = await val("SELECT current_user");
    for (const sql of [
      "SELECT set_config('role', 'postgres', false)",
      "SELECT pg_read_file('/etc/passwd')",
      "SELECT nextval('s')",
      "SELECT pg_advisory_lock(1)",
      "SELECT lo_import('/etc/passwd')",
    ]) {
      const r = await verifyAnswer(adapter(), fence(sql));
      expect(r.parts, sql).toEqual([{ kind: "hidden", reasonKey: "mentorVerify.notAllowed" }]);
    }
    expect(await val("SELECT current_user")).toBe(role);
    expect(await val("SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory'")).toBe(0);
    expect(await val("SELECT last_value::text || is_called::text FROM s")).toBe(seq);
  });

  it("phiên đang có transaction mở của người dùng: hidden, transaction còn nguyên", async () => {
    await s.run("BEGIN");
    await s.run("CREATE TABLE open_txn(a int)");
    const r = await verifyAnswer(adapter(), fence("SELECT 1 FROM orders") + fence("CREATE INDEX ON orders(note)"), { probe: "SELECT 1 FROM orders" });
    expect(r.hiddenCount).toBe(2);
    expect(await val("SELECT count(*)::int FROM pg_tables WHERE tablename = 'open_txn'")).toBe(1);
    await s.run("ROLLBACK");
    expect(await val("SELECT count(*)::int FROM pg_tables WHERE tablename = 'open_txn'")).toBe(0);
  });
});
