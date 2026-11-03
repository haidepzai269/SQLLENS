// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { loadModule, parseSync } from "pgsql-parser";
import mysql from "node-sql-parser/build/mysql.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineId } from "@/contracts/engine";
import { parseMysql, parsePostgres, type MyParser, type PgParser } from "../parser/core";
import { inferSchema, quoteIdent, toCreateSql } from "./index";

const my = new (mysql as unknown as { Parser: new () => MyParser }).Parser();
beforeAll(() => loadModule(), 60_000);

function infer(sql: string, engine: EngineId) {
  const r = engine === "postgres" ? parsePostgres(sql, parseSync as unknown as PgParser) : parseMysql(sql, my);
  if (!r.ok) throw new Error(r.error.message);
  return inferSchema(r.statements, engine);
}
const ENGINES: EngineId[] = ["postgres", "mysql"];
const AC1 = "SELECT o.id, c.email FROM orders o JOIN customers c ON o.customer_id = c.id WHERE o.total > 100";
const cols = (t: { columns: { name: string }[] }) => t.columns.map((c) => c.name).sort();

describe.each(ENGINES)("%s", (engine) => {
  const run = (sql: string) => infer(sql, engine);
  it("AC1 join, alias, FK, kiểu số", () => {
    const { tables } = run(AC1);
    const o = tables.find((t) => t.name === "orders")!;
    const c = tables.find((t) => t.name === "customers")!;
    expect(cols(o)).toEqual(["customer_id", "id", "total"]);
    expect(cols(c)).toEqual(["email", "id"]);
    expect(o.foreignKeyGuesses).toEqual([{ column: "customer_id", table: "customers", refColumn: "id" }]);
    expect(o.columns.find((x) => x.name === "total")).toMatchObject({ type: "numeric", reason: "literal" });
  });
  it("AC2 SELECT *", () => {
    const r = run("SELECT * FROM t");
    expect(r.tables).toEqual([{ name: "t", columns: [], foreignKeyGuesses: [], incomplete: true }]);
    expect(r.warnings).toEqual([{ key: "star", table: "t" }]);
  });
  it("AC3 cột không alias với nhiều bảng", () => {
    const r = run("SELECT x FROM a JOIN b ON a.k = b.k");
    expect(r.tables.find((t) => t.name === "a")!.columns.map((c) => c.name)).toEqual(["k"]);
    expect(r.warnings).toContainEqual({ key: "ambiguous-column", table: undefined });
  });
  it("AC4 CTE và subquery không thành bảng, truy về bảng gốc", () => {
    const r = run("WITH c AS (SELECT id, email AS e FROM users) SELECT z.n, c.e FROM c JOIN (SELECT name AS n FROM roles) z ON 1 = 1 WHERE c.e = 'a'");
    expect(r.tables.map((t) => t.name).sort()).toEqual(["roles", "users"]);
    expect(cols(r.tables.find((t) => t.name === "users")!)).toEqual(["email", "id"]);
    expect(cols(r.tables.find((t) => t.name === "roles")!)).toEqual(["name"]);
  });
  it("AC5 INSERT và UPDATE", () => {
    const r = run("INSERT INTO t (a, b) VALUES (1, 'x'); UPDATE t SET a = 1 WHERE b = 'x'");
    expect(r.tables[0].columns).toMatchObject([{ name: "a", type: "integer" }, { name: "b", type: "text" }]);
  });
  it("ca biên: kiểu mâu thuẫn, hàm bọc cột, không có bảng", () => {
    const r = run("SELECT 1 FROM t WHERE a = 1; SELECT 1 FROM t WHERE a = 'x' AND lower(email) = 'e'");
    expect(r.tables[0].columns.find((c) => c.name === "a")!.type).toBe("text");
    expect(r.tables[0].columns.map((c) => c.name)).toContain("email");
    expect(r.warnings).toContainEqual({ key: "type-conflict", table: "t" });
    expect(run("SELECT 1").tables).toEqual([]);
  });
  it("AC7 quote tên", () => {
    const t = [{ name: 'a"b`c; DROP TABLE x; --', columns: [{ name: "Co l\"`", type: "int); DROP TABLE x; --", reason: "default" as const, primaryKeyGuess: false }], foreignKeyGuesses: [], incomplete: false }];
    const sql = toCreateSql(t, engine);
    const q = quoteIdent(engine, t[0].name);
    expect(sql).toBe(`CREATE TABLE ${q} (${quoteIdent(engine, 'Co l"`')} text);`);
    const re = parseMysqlOrPg(sql, engine);
    expect(re).toBe(1);
  });
  it("AC6 MySQL/PG parse được CREATE sinh ra", () => {
    const { tables } = run(AC1);
    expect(parseMysqlOrPg(toCreateSql(tables, engine), engine)).toBe(2);
  });
});

function parseMysqlOrPg(sql: string, engine: EngineId) {
  const r = engine === "postgres" ? parsePostgres(sql, parseSync as unknown as PgParser) : parseMysql(sql, my);
  if (!r.ok) throw new Error(r.error.message);
  return r.statements.length;
}

describe("AC6 chạy trên PGlite thật", () => {
  it.each([AC1, "INSERT INTO t (a, b) VALUES (1, 'x')", "UPDATE t SET a = 1 WHERE b = 'x'", "SELECT * FROM t", 'SELECT "Mixed Case" FROM "My Table" WHERE "Mixed Case" = 5'])("%s", async (q) => {
    const { tables } = infer(q, "postgres");
    const db = await PGlite.create();
    try {
      await db.exec(toCreateSql(tables, "postgres"));
      await db.exec(q);
    } finally {
      await db.close();
    }
  }, 60_000);
});

describe.each(ENGINES)("lỗi review %s", (engine) => {
  const run = (sql: string) => infer(sql, engine);
  it("subquery trong WHERE", () => {
    const r = run("SELECT name FROM users u WHERE u.id IN (SELECT user_id FROM orders WHERE total > 5)");
    expect(r.tables.map((t) => t.name).sort()).toEqual(["orders", "users"]);
    expect(cols(r.tables.find((t) => t.name === "orders")!)).toEqual(["total", "user_id"]);
  });
  it("JOIN USING", () => {
    const r = run("SELECT a.x FROM a JOIN b USING (k)");
    expect(r.tables.map((t) => cols(t))).toEqual([["k", "x"], ["k"]]);
  });
  it("ORDER BY của UNION không bịa cột", () => {
    const r = run("SELECT a FROM t1 UNION SELECT b FROM t2 ORDER BY a");
    expect(r.tables.map((t) => cols(t))).toEqual([["a"], ["b"]]);
  });
  it("kiểu có độ dài không hợp lệ về dạng an toàn", () => {
    const t = [{ name: "t", columns: ["int(5)", "date(3)", "varchar(10)"].map((type, i) => ({ name: `c${i}`, type, reason: "default" as const, primaryKeyGuess: false })), foreignKeyGuesses: [], incomplete: false }];
    expect(toCreateSql(t, "postgres")).toContain('"c0" text, "c1" text, "c2" varchar(10)');
  });
});
