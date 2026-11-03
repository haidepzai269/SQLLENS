// @vitest-environment node
import { loadModule, parseSync } from "pgsql-parser";
import mysql from "node-sql-parser/build/mysql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseMysql, parsePostgres, type MyParser, type PgParser } from "../parser/core";
import type { EngineId } from "@/contracts/engine";
import { classifyInput } from "./classify";
import { prepareDump } from "./dump";

const my = new (mysql as unknown as { Parser: new () => MyParser }).Parser();
const parse = (sql: string, e: EngineId) => (e === "postgres" ? parsePostgres(sql, parseSync as unknown as PgParser) : parseMysql(sql, my));
const kind = (sql: string, e: EngineId = "postgres") => classifyInput(parse(sql, e)).kind;
beforeAll(() => loadModule(), 60_000);

describe("classifyInput", () => {
  it.each(["postgres", "mysql"] as const)("AC1 AC2 AC3 %s", (e) => {
    expect(kind("CREATE TABLE t (id int); CREATE INDEX i ON t (id); ALTER TABLE t ADD COLUMN y int", e)).toBe("schema");
    expect(kind("SELECT 1 FROM t; UPDATE t SET id = 1; DELETE FROM t", e)).toBe("query");
    expect(kind("CREATE TABLE t (id int); SELECT * FROM t", e)).toBe("both");
    const r = classifyInput(parse("CREATE TABLE t (id int); INSERT INTO t VALUES (1)", e));
    expect(r).toMatchObject({ kind: "schema", otherStatements: [1] });
    expect(kind("INSERT INTO t VALUES (1)", e)).toBe("query");
    expect(kind("", e)).toBe("empty");
    expect(kind("  \n ", e)).toBe("empty");
    expect(kind("SELEC nonsense (", e)).toBe("unknown");
    expect(kind("BEGIN", e)).toBe("unknown");
  });
});

const PG_DUMP = [
  "--", "-- PostgreSQL database dump", "--", "",
  "\\connect mydb", "SET statement_timeout = 0;", "SELECT pg_catalog.set_config('search_path', '', false);",
  "CREATE TABLE public.t (id integer, name text);",
  "COPY public.t (id, name) FROM stdin;", "1\ta", "2\tb", "\\.", "",
  "INSERT INTO public.t VALUES (3, 'x \\. COPY public.t FROM stdin;');",
  "ALTER TABLE ONLY public.t ADD CONSTRAINT t_pkey PRIMARY KEY (id);", "",
].join("\r\n");

const MY_DUMP = [
  "/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;",
  "DROP TABLE IF EXISTS `t`;", "CREATE TABLE `t` (`id` int NOT NULL, PRIMARY KEY (`id`));",
  "LOCK TABLES `t` WRITE;", "/*!40000 ALTER TABLE `t` DISABLE KEYS */;",
  "INSERT INTO `t` VALUES (1),(2);", "/*!40000 ALTER TABLE `t` ENABLE KEYS */;", "UNLOCK TABLES;", "",
].join("\n");

describe("prepareDump", () => {
  it("AC4 pg_dump (CRLF, COPY có cột)", () => {
    const r = prepareDump(PG_DUMP, "postgres");
    expect(r.removed).toEqual({ copyBlocks: 1, lockStatements: 0 });
    expect(r.sql).toContain("x \\. COPY public.t FROM stdin;"); // AC6
    expect(r.sql).not.toContain("1\ta");
    expect(classifyInput(parse(r.sql, "postgres")).kind).toBe("schema");
  });
  it("AC5 mysqldump", () => {
    const r = prepareDump(MY_DUMP, "mysql");
    expect(r.removed).toEqual({ copyBlocks: 0, lockStatements: 2 });
    expect(classifyInput(parse(r.sql, "mysql")).kind).toBe("schema");
  });
  it("AC6 chuỗi nhiều dòng có dòng giống COPY và \.", () => {
    const sql = "INSERT INTO t VALUES ('a\nCOPY t FROM stdin;\nb\n\\.\nc');\n";
    expect(prepareDump(sql, "postgres")).toEqual({ sql, removed: { copyBlocks: 0, lockStatements: 0 } });
    const sql2 = "SELECT $$\nCOPY t FROM stdin;\n\\.\n$$;\n";
    expect(prepareDump(sql2, "postgres").sql).toBe(sql2);
  });
  it("COPY thiếu \. thì giữ nguyên", () => {
    const sql = "COPY t FROM stdin;\n1\n2\nCREATE TABLE u (id int);\n";
    expect(prepareDump(sql, "postgres")).toEqual({ sql, removed: { copyBlocks: 0, lockStatements: 0 } });
  });
  it("AC7 dump 5 MB dưới 1 giây", () => {
    const body = "INSERT INTO t VALUES (1, 'một dòng dữ liệu mẫu có độ dài vừa phải');\n";
    const big = PG_DUMP + body.repeat(Math.ceil((5 * 1024 * 1024) / body.length));
    const t0 = performance.now();
    const r = prepareDump(big, "postgres");
    const ms = performance.now() - t0;
    console.log(`prepareDump ${(big.length / 1048576).toFixed(1)} MB: ${ms.toFixed(0)} ms`);
    expect(r.removed.copyBlocks).toBe(1);
    expect(ms).toBeLessThan(1000);
  });
});
