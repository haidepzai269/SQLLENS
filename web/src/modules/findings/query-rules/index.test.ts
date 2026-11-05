// @vitest-environment node
import { loadModule, parseSync } from "pgsql-parser";
import mysqlParser from "node-sql-parser/build/mysql.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineId } from "@/contracts/engine";
import { parseMysql, parsePostgres, type MyParser, type PgParser } from "@/modules/sql-intake/parser/core";
import { checkQueries } from "./index";

const my = new (mysqlParser as unknown as { Parser: new () => MyParser }).Parser();
beforeAll(() => loadModule(), 60_000);

function run(engine: EngineId, sql: string) {
  const r = engine === "postgres" ? parsePostgres(sql, parseSync as unknown as PgParser) : parseMysql(sql, my);
  if (!r.ok) throw new Error(r.error.message);
  return checkQueries(r.statements, engine, sql);
}
const ids = (hits: { ruleId: string }[]) => hits.map((h) => h.ruleId);

const ENGINES: EngineId[] = ["postgres", "mysql"];
describe.each(ENGINES)("%s", (e) => {
  const T = "CREATE TABLE users (id int PRIMARY KEY, email varchar(100), a int, b int, c int, age int);";
  const IDX_EMAIL = "CREATE INDEX ie ON users (email);";

  it("AC1 function-on-indexed-column", () => {
    const q = "SELECT * FROM users WHERE lower(email) = 'x';";
    const hits = run(e, T + IDX_EMAIL + q);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ruleId: "function-on-indexed-column", messageKey: "findings.query.function-on-indexed-column", table: "users", column: "email", statementIndex: 2 });
    // expression index khớp: không báo
    const exprIdx = e === "postgres" ? "CREATE INDEX ie ON users (lower(email));" : "CREATE INDEX ie ON users ((lower(email)));";
    expect(run(e, T + exprIdx + q)).toEqual([]);
    // không có index trên email: không báo
    expect(run(e, T + q)).toEqual([]);
    expect(run(e, q)).toEqual([]);
  });

  it("AC2 leading-wildcard", () => {
    const base = T + IDX_EMAIL;
    expect(ids(run(e, base + "SELECT * FROM users WHERE email LIKE '%x'"))).toEqual(["leading-wildcard"]);
    expect(ids(run(e, base + "SELECT * FROM users WHERE email LIKE '%x%'"))).toEqual(["leading-wildcard"]);
    expect(run(e, base + "SELECT * FROM users WHERE email LIKE 'x%'")).toEqual([]);
    expect(run(e, base + "SELECT * FROM users WHERE email LIKE " + (e === "postgres" ? "$1" : "?"))).toEqual([]);
    expect(run(e, T + "SELECT * FROM users WHERE email LIKE '%x'")).toEqual([]);
  });

  it("AC3 composite-prefix", () => {
    const base = T + "CREATE INDEX iabc ON users (a, b, c);";
    const hits = run(e, base + "SELECT * FROM users WHERE b = 1");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ruleId: "composite-prefix", table: "users", column: "b" });
    expect(run(e, base + "SELECT * FROM users WHERE a = 1 AND b = 1")).toEqual([]);
    expect(run(e, base + "SELECT * FROM users WHERE b = 1 AND a = 1")).toEqual([]);
    // dưới OR không biết nhánh nào chạy: không báo
    expect(run(e, base + "SELECT * FROM users WHERE b = 1 OR a = 1")).toEqual([]);
    // index khác dùng được cột đầu: không báo
    expect(run(e, base + "SELECT * FROM users WHERE b = 1 AND id = 5")).toEqual([]);
  });

  it("AC4 implicit-cast", () => {
    const num = run(e, T + "SELECT * FROM users WHERE a = '5'");
    expect(num).toHaveLength(1);
    expect(num[0]).toMatchObject({ ruleId: "implicit-cast", column: "a", values: { direction: "number-vs-string", effect: "literalCast" } });
    const txt = run(e, T + "SELECT * FROM users WHERE email = 5");
    expect(txt).toHaveLength(1);
    expect(txt[0].values).toMatchObject({ direction: "string-vs-number", effect: e === "postgres" ? "error" : "columnCast" });
    expect(run(e, T + "SELECT * FROM users WHERE a = 5 AND email = 'x'")).toEqual([]);
    expect(run(e, "SELECT * FROM users WHERE a = '5'")).toEqual([]); // kiểu cột không biết
  });

  it("AC5 alias và JOIN", () => {
    const sch = T + "CREATE TABLE orders (id int PRIMARY KEY, email varchar(100), user_id int);" + IDX_EMAIL;
    // x.email thuộc users (có index), o.email thuộc orders (không index)
    const q = (col: string) => `SELECT * FROM users x JOIN orders o ON o.user_id = x.id WHERE lower(${col}) = 'a'`;
    expect(run(e, sch + q("x.email"))).toHaveLength(1);
    expect(run(e, sch + q("o.email"))).toEqual([]);
    // cột không có tiền tố, hai bảng cùng có: không chắc nên không báo
    expect(run(e, sch + q("email"))).toEqual([]);
    // cột không có tiền tố chỉ users có (index trên age): gán cho users
    const r = run(e, sch + "CREATE INDEX ia ON users (age);SELECT * FROM users x JOIN orders o ON o.user_id = x.id WHERE lower(age) = 1");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ table: "users", column: "age" });
  });

  it("AC6 vị trí", () => {
    const sql = T + IDX_EMAIL + "SELECT * FROM users WHERE lower(email) = 'x';";
    const [h] = run(e, sql);
    expect(h.statementIndex).toBe(2);
    expect(sql.slice(h.start, h.end)).toContain("lower(email)");
    if (e === "postgres") expect(sql.slice(h.start, h.end)).toBe("lower(email)");
    // có ký tự nhiều byte phía trước: vẫn đúng
    const sql2 = "-- é\n" + sql;
    const [h2] = run(e, sql2);
    if (e === "postgres") expect(sql2.slice(h2.start, h2.end)).toBe("lower(email)");
  });

  it("ca biên: UPDATE, DELETE, subquery, CTE", () => {
    const base = T + IDX_EMAIL;
    expect(ids(run(e, base + "UPDATE users SET a = 1 WHERE lower(email) = 'x'"))).toEqual(["function-on-indexed-column"]);
    expect(ids(run(e, base + "DELETE FROM users WHERE email LIKE '%x'"))).toEqual(["leading-wildcard"]);
    expect(ids(run(e, base + "SELECT * FROM orders WHERE id IN (SELECT id FROM users WHERE lower(email) = 'x')"))).toEqual(["function-on-indexed-column"]);
    expect(ids(run(e, base + "WITH c AS (SELECT * FROM users WHERE lower(email) = 'x') SELECT * FROM c"))).toEqual(["function-on-indexed-column"]);
    // cột của CTE trùng tên cột có index: không gán cho bảng thật
    expect(run(e, base + "WITH c AS (SELECT email FROM users) SELECT * FROM c WHERE lower(email) = 'x'")).toEqual([]);
  });

  it("UNION: cả hai nhánh được kiểm", () => {
    const base = T + IDX_EMAIL;
    expect(ids(run(e, base + "SELECT id FROM users WHERE lower(email) = 'x' UNION SELECT id FROM orders"))).toEqual(["function-on-indexed-column"]);
    expect(ids(run(e, base + "SELECT id FROM orders UNION ALL SELECT id FROM users WHERE lower(email) = 'x'"))).toEqual(["function-on-indexed-column"]);
  });

  it("không có rủi ro thì mảng rỗng, SQL đọc không được thì bỏ qua", () => {
    expect(run(e, T + IDX_EMAIL + "SELECT * FROM users WHERE email = 'x'")).toEqual([]);
    expect(checkQueries([{ index: 0, kind: "select", start: 0, end: 1, tables: [], ast: null }], e)).toEqual([]);
    expect(checkQueries([{ index: 0, kind: "select", start: 0, end: 1, tables: [], ast: "rác" }], e)).toEqual([]);
  });
});

describe("khác biệt engine", () => {
  it("PostgreSQL: index gin trên cột thì LIKE '%x' không báo", () => {
    const sql = "CREATE TABLE t (n text); CREATE INDEX i ON t (n); CREATE INDEX g ON t USING gin (n); SELECT * FROM t WHERE n LIKE '%x'";
    expect(run("postgres", sql)).toEqual([]);
  });
  it("MySQL: UNIQUE KEY trong CREATE TABLE và ALTER ADD INDEX là index", () => {
    expect(ids(run("mysql", "CREATE TABLE t (a int, b int, UNIQUE KEY k (a, b)); SELECT * FROM t WHERE b = 1"))).toEqual(["composite-prefix"]);
    expect(ids(run("mysql", "CREATE TABLE t (a int, b int); ALTER TABLE t ADD INDEX (a, b); SELECT * FROM t WHERE b = 1"))).toEqual(["composite-prefix"]);
  });
  it("PostgreSQL: ALTER ADD PRIMARY KEY là index", () => {
    expect(ids(run("postgres", "CREATE TABLE t (a int, b int); ALTER TABLE t ADD PRIMARY KEY (a, b); SELECT * FROM t WHERE b = 1"))).toEqual(["composite-prefix"]);
  });
});
