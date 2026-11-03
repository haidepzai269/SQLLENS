// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { checkUserSql, GUARD_REASONS, loadGuard, statementAt } from "./guard";
import { createSession, GuardError } from "./roles";

beforeAll(async () => expect(await loadGuard()).toBe(true), 60_000);

const blocked: [string, string][] = [
  ["SET ROLE postgres", "guard.role"],
  ["set   role none", "guard.role"],
  ["SET LOCAL ROLE postgres", "guard.role"],
  ["RESET ROLE", "guard.role"],
  ["RESET ALL", "guard.resetAll"],
  ["DISCARD ALL", "guard.resetAll"],
  ["SET SESSION AUTHORIZATION postgres", "guard.role"],
  ["RESET SESSION AUTHORIZATION", "guard.role"],
  ["CREATE EXTENSION pgcrypto", "guard.extension"],
  ["LOAD 'x'", "guard.load"],
  ["COPY t TO PROGRAM 'ls'", "guard.copyProgram"],
  ["CREATE ROLE r SUPERUSER", "guard.roleDdl"],
  ["ALTER ROLE sqllens_user SUPERUSER", "guard.roleDdl"],
  ["GRANT ALL ON t TO PUBLIC", "guard.grant"],
  ["REVOKE ALL ON t FROM PUBLIC", "guard.grant"],
  ["SELECT set_config('role', 'postgres', false)", "guard.role"],
  ["SELECT pg_catalog.set_config('SESSION_AUTHORIZATION', 'postgres', false)", "guard.role"],
  ["SELECT 1 WHERE (SELECT set_config('role'::text, 'postgres', false)) IS NOT NULL", "guard.role"],
  ["SELECT set_config(lower('ROLE'), 'postgres', false)", "guard.role"],
  ["CREATE FUNCTION f() RETURNS int LANGUAGE sql SET role = 'postgres' AS 'SELECT 1'", "guard.role"],
];

describe("checkUserSql (lớp một)", () => {
  it.each(blocked)("chặn %s", (sql, reason) => {
    expect(checkUserSql(sql)).toEqual({ ok: false, reasonKey: reason, statementIndex: 1 });
  });

  it("chặn khi viết hoa, có comment, nằm giữa nhiều câu, và báo đúng số câu (từ 1)", () => {
    const sql = "SELECT 1; /* x */ -- y\nSELECT 2;\n/* c */ SeT /* c */ RoLe postgres; SELECT 3";
    expect(checkUserSql(sql)).toEqual({ ok: false, reasonKey: "guard.role", statementIndex: 3 });
  });

  it("cho qua câu thường và SET search_path, statement_timeout", () => {
    for (const sql of [
      "CREATE TABLE t(id int primary key, v text)",
      "CREATE INDEX i ON t(v)",
      "INSERT INTO t VALUES (1,'a')",
      "SELECT set_config('search_path', 'public', false)",
      "SET search_path TO public",
      "SET statement_timeout = '5s'",
      "SET LOCAL statement_timeout = 100",
      "EXPLAIN ANALYZE SELECT * FROM t",
      "BEGIN; COMMIT",
    ])
      expect(checkUserSql(sql), sql).toEqual({ ok: true });
  });

  it("câu parser không đọc được thì cho qua", () => {
    expect(checkUserSql("SELEC FROM WHERE ((")).toEqual({ ok: true });
  });

  it("mọi lý do đều có bản dịch vi và en", () => {
    for (const l of ["vi", "en"]) {
      const m = JSON.parse(readFileSync(`messages/${l}/guard.json`, "utf8"));
      for (const k of GUARD_REASONS) expect(m[k.replace("guard.", "")], `${l} ${k}`).toMatch(/\S/);
    }
  });
});

describe("statementAt (Task027 AC4)", () => {
  it("đếm từ 1, theo vị trí lỗi, kể cả ký tự nhiều byte phía trước", () => {
    expect(statementAt("SELECT 1/0")).toBe(1);
    expect(statementAt("SELECT 'é;ñ'; SELECT 1; SELECT x", 32)).toBe(3);
    expect(statementAt("SELECT 'é;ñ'; SELECT 1; SELECT x", 15)).toBe(2);
    expect(statementAt("SELECT 1; SELECT 2")).toBeUndefined(); // nhiều câu mà không có vị trí
  });
  it("lỗi cú pháp ở câu thứ hai và thứ ba", () => {
    expect(statementAt("SELECT 1; SELEC 2", 11)).toBe(2);
    expect(statementAt("SELECT 1; SELECT 2; SELEC 3", 21)).toBe(3);
    expect(statementAt("SELEC 1", 1)).toBe(1);
  });
});

describe("createSession với PGlite thật", () => {
  let db: PGlite;
  let s: Awaited<ReturnType<typeof createSession>>;
  const who = async () => (await s.run("SELECT current_user"))[0].rows[0][0];

  beforeAll(async () => {
    db = await PGlite.create({ extensions: { pageinspect } });
    s = await createSession(db);
  }, 120_000);

  it("AC4 câu thường chạy đúng dưới sqllens_user", async () => {
    expect(await who()).toBe("sqllens_user");
    await s.run("CREATE TABLE t(id int primary key, v text)");
    await s.run("INSERT INTO t SELECT g, 'x' || g FROM generate_series(1, 200) g");
    await s.run("CREATE INDEX i ON t(v)");
    const [r] = await s.run("SELECT count(*) FROM t");
    expect(Number(r.rows[0][0])).toBe(200);
    await s.run("EXPLAIN ANALYZE SELECT * FROM t WHERE id = 1");
    await s.run("BEGIN; INSERT INTO t VALUES (1000, 'y'); COMMIT");
    await s.run("SET search_path TO public");
    await s.run("SET statement_timeout = '30s'");
    await expect(s.run("SELECT 1/0")).rejects.toThrow(/division by zero/);
    expect(await who()).toBe("sqllens_user");
  });

  it("AC3 bt_metap bị từ chối cho người dùng, đọc được qua adminQuery", async () => {
    await expect(s.run("SELECT * FROM bt_metap('t_pkey')")).rejects.toThrow(/superuser/);
    const [r] = await s.adminQuery("SELECT level FROM bt_metap('t_pkey')");
    expect(Number(r.rows[0][0])).toBeGreaterThanOrEqual(0);
    expect(await who()).toBe("sqllens_user");
  });

  it("AC2 lớp một chặn set_config, role không đổi", async () => {
    await expect(s.run("SELECT set_config('role', 'postgres', false)")).rejects.toMatchObject({ reasonKey: "guard.role" });
    expect(await who()).toBe("sqllens_user");
  });

  it("AC2 DO + EXECUTE qua mặt parser nhưng lớp hai bắt được, câu kế tiếp vẫn là sqllens_user", async () => {
    await expect(s.run("DO $$ BEGIN EXECUTE 'SET ROLE postgres'; END $$;")).rejects.toSatisfy(
      (e) => e instanceof GuardError && e.reasonKey === "guard.escaped" && e.rebuild,
    );
    // Worker thật dựng lại cả phiên; ở đây chứng minh role đang bị đổi để lớp hai là ranh giới duy nhất.
    expect((await db.query<{ c: string }>("SELECT current_user AS c")).rows[0].c).toBe("postgres");
    await db.exec("SET ROLE sqllens_user");
    expect(await who()).toBe("sqllens_user");
  });

  it("lớp hai bắt trường hợp lên superuser, đổi quyền rồi quay về sqllens_user", async () => {
    await expect(
      s.run("DO $$ BEGIN EXECUTE 'SET ROLE postgres'; EXECUTE 'ALTER ROLE sqllens_user SUPERUSER'; EXECUTE 'SET ROLE sqllens_user'; END $$"),
    ).rejects.toMatchObject({ reasonKey: "guard.escaped", rebuild: true });
    await db.exec("RESET ROLE; ALTER ROLE sqllens_user NOSUPERUSER; SET ROLE sqllens_user");
    await expect(
      s.run("DO $$ BEGIN EXECUTE 'SET ROLE postgres'; EXECUTE 'CREATE ROLE evil'; EXECUTE 'SET ROLE sqllens_user'; END $$"),
    ).rejects.toMatchObject({ reasonKey: "guard.escaped" });
    await db.exec("RESET ROLE; DROP ROLE evil; SET ROLE sqllens_user");
  });

  it("lớp hai bắt cả SET SESSION AUTHORIZATION trong DO (phiên riêng vì không khôi phục được)", async () => {
    const db2 = await PGlite.create({ extensions: { pageinspect } });
    const s2 = await createSession(db2);
    await expect(
      s2.run("DO $$ BEGIN EXECUTE 'SET SESSION AUTHORIZATION sqllens_user'; END $$;"),
    ).rejects.toMatchObject({ reasonKey: "guard.escaped", rebuild: true });
  }, 60_000);

  it("transaction đã hỏng không bị coi là thoát", async () => {
    await expect(s.run("BEGIN; SELECT 1/0")).rejects.toThrow(/division by zero/);
    await expect(s.run("SELECT 1")).rejects.toThrow(/aborted/);
    await s.run("ROLLBACK");
    expect(await who()).toBe("sqllens_user");
  });

  it("Task027 AC1: infinity, -infinity và mảng giữ nguyên chữ, ngày hợp lệ vẫn là Date", async () => {
    const [r] = await s.run(
      `SELECT 'infinity'::timestamptz, '-infinity'::timestamptz, 'infinity'::date, 'infinity'::timestamp,
              ARRAY['infinity'::timestamptz, '2020-01-02'], '2020-01-02 03:04:05+00'::timestamptz`,
    );
    const row = r.rows[0];
    expect(row.slice(0, 4)).toEqual(["infinity", "-infinity", "infinity", "infinity"]);
    expect((row[4] as unknown[])[0]).toBe("infinity");
    expect((row[4] as Date[])[1]).toBeInstanceOf(Date);
    expect((row[5] as Date).toISOString()).toBe("2020-01-02T03:04:05.000Z");
  });

  it("Task027 AC3: affectedRows tính theo từng câu, không cộng dồn", async () => {
    await s.run("CREATE TABLE ar(a int)");
    const rs = await s.run("INSERT INTO ar VALUES (1),(2); UPDATE ar SET a = a + 1 WHERE a = 1; SELECT * FROM ar; DELETE FROM ar");
    expect(rs.map((r) => r.affectedRows)).toEqual([2, 1, undefined, 2]);
  });
});
