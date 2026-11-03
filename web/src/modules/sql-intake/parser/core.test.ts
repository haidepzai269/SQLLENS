// @vitest-environment node
import { loadModule, parseSync } from "pgsql-parser";
import mysql from "node-sql-parser/build/mysql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseMysql, parsePostgres, splitMysql, type MyParser, type PgParser } from "./core";

const my = new (mysql as unknown as { Parser: new () => MyParser }).Parser();
const pg = (sql: string) => parsePostgres(sql, parseSync as unknown as PgParser);
const mysqlParse = (sql: string) => parseMysql(sql, my);
beforeAll(() => loadModule(), 60_000);

const SAMPLES: [string, string, string[]][] = [
  ["CREATE TABLE a.t (id int PRIMARY KEY, x int)", "create_table", ["a.t"]],
  ["CREATE INDEX i ON t (x)", "create_index", ["t"]],
  ["SELECT * FROM t JOIN u ON t.id = u.id", "select", ["t", "u"]],
  ["INSERT INTO t VALUES (1)", "insert", ["t"]],
  ["UPDATE t SET x = 1", "update", ["t"]],
  ["DELETE FROM t", "delete", ["t"]],
  ["BEGIN", "transaction", []],
  ["ALTER TABLE t ADD COLUMN y int", "alter_table", ["t"]],
  ["DROP TABLE t", "drop", ["t"]],
  ["SET x = 1", "set", []],
  ["WITH c AS (SELECT 1 FROM v) SELECT * FROM c, (SELECT * FROM w) z", "select", ["v", "w"]],
];

describe("AC2 hai engine cùng kind và tables", () => {
  it.each(SAMPLES)("%s", (sql, kind, tables) => {
    for (const r of [pg(sql), mysqlParse(sql)]) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.statements.map((s) => [s.kind, s.tables])).toEqual([[kind, tables]]);
    }
  });
});

describe("AC3 lỗi postgres", () => {
  it("SELEC 1 ở vị trí 0", () => {
    expect(pg("SELEC 1")).toMatchObject({ ok: false, error: { position: 0, line: 1, column: 1 } });
  });
  it("lỗi giữa câu thứ hai trên dòng ba, có ký tự nhiều byte phía trước", () => {
    const sql = "SELECT 1;\nSELECT 'é';\nSELECT * FORM t";
    expect(pg(sql)).toMatchObject({ ok: false, error: { position: sql.indexOf("FORM"), line: 3, column: 10 } });
  });
});

describe("AC4 MySQL không đọc được thì ok false, không ném", () => {
  it("FORCE INDEX", () => {
    const r = mysqlParse("SELECT * FROM t FORCE INDEX (i)");
    expect(r.ok).toBe(false);
  });
  it("vị trí lỗi tuyệt đối ở câu thứ hai", () => {
    const sql = "SELECT 1;\nSELEC 1";
    expect(mysqlParse(sql)).toMatchObject({ ok: false, error: { line: 2 } });
  });
});

describe("AC5 vị trí với tiếng Việt", () => {
  const sql = "-- chú thích tiếng Việt\nSELECT 'đường dẫn'; /* ghi chú */ SELECT 'ệ' FROM bảng;";
  it.each([
    ["postgres", pg],
    ["mysql", mysqlParse],
  ])("%s", (_n, fn) => {
    const r = fn(sql);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.statements.map((s) => sql.slice(s.start, s.end))).toEqual(["SELECT 'đường dẫn'", "SELECT 'ệ' FROM bảng"]);
  });
});

describe("ca biên", () => {
  it.each([[""], ["   \n"], ["-- chỉ comment"], ["/* a */ ; ;"]])("%j không có câu nào", (sql) => {
    for (const r of [pg(sql), mysqlParse(sql)]) expect(r).toEqual({ ok: true, statements: [] });
  });
  it("tên có schema và bọc ngoặc kép", () => {
    const r = pg('SELECT * FROM public."MyT"');
    expect(r.ok && r.statements[0].tables).toEqual(["public.MyT"]);
    const m = mysqlParse("SELECT * FROM `db`.`MyT`");
    expect(m.ok && m.statements[0].tables).toEqual(["db.MyT"]);
  });
  it("splitMysql bỏ qua ; trong chuỗi, backtick, comment", () => {
    const sql = "SELECT 'a;b', `c;d` FROM t; -- x;\nSELECT 2 /* ; */";
    expect(splitMysql(sql).map(([s, e]) => sql.slice(s, e))).toEqual(["SELECT 'a;b', `c;d` FROM t", "SELECT 2 /* ; */"]);
  });
  it("không ghi SQL ra console", () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((k) => {
      const orig = console[k];
      let n = 0;
      console[k] = () => void n++;
      return () => ((console[k] = orig), n);
    });
    pg("SELEC secret");
    mysqlParse("SELEC secret");
    expect(spies.map((f) => f())).toEqual([0, 0, 0, 0, 0]);
  });
});
