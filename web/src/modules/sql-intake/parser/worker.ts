/// <reference lib="webworker" />
import type { EngineId } from "@/contracts/engine";
import { failure, parseMysql, parsePostgres, type MyParser, type PgParser } from "./core";
import type { ParseOutcome } from "./types";

export type ParseRequest = { id: number; engine: EngineId; sql: string };
export type ParseResponse = { id: number; outcome: ParseOutcome };

const loaders: { postgres?: Promise<PgParser>; mysql?: Promise<MyParser> } = {};

// libpg-query tìm file WASM cạnh script đang chạy, mà trong worker đó là thư mục chunk, nên chuyển hướng
// đúng yêu cầu fetch của nó sang URL đã bundle (cùng cách guard.ts của Task021).
async function loadPostgres(): Promise<PgParser> {
  const { loadModule, parseSync } = await import("pgsql-parser");
  const wasm = new URL("../../../../node_modules/libpg-query/wasm/libpg-query.wasm", import.meta.url);
  const orig = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    String(input instanceof Request ? input.url : input).endsWith("libpg-query.wasm") ? orig(wasm, init) : orig(input, init);
  try {
    await loadModule();
  } finally {
    globalThis.fetch = orig;
  }
  return parseSync as unknown as PgParser;
}

async function loadMysql(): Promise<MyParser> {
  const mod = await import("node-sql-parser/build/mysql");
  const { Parser } = (mod as { Parser?: new () => MyParser; default?: { Parser: new () => MyParser } }).Parser
    ? (mod as unknown as { Parser: new () => MyParser })
    : (mod as unknown as { default: { Parser: new () => MyParser } }).default;
  return new Parser();
}

// Tải lỗi thì bỏ cache để lần gọi sau thử lại.
function load<K extends EngineId>(engine: K) {
  const make = engine === "postgres" ? loadPostgres : loadMysql;
  const p = (loaders[engine] ??= make() as never) as Promise<unknown>;
  p.catch(() => delete loaders[engine]);
  return p;
}

onmessage = async ({ data: { id, engine, sql } }: MessageEvent<ParseRequest>) => {
  let outcome: ParseOutcome;
  try {
    const parser = await load(engine);
    outcome = engine === "postgres" ? parsePostgres(sql, parser as PgParser) : parseMysql(sql, parser as MyParser);
  } catch (e) {
    outcome = failure(sql, `Parser failed to load: ${e instanceof Error ? e.message : String(e)}`);
  }
  postMessage({ id, outcome } satisfies ParseResponse);
};
