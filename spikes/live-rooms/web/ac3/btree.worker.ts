/**
 * Worker của spike: dựng dữ liệu thật trong PGlite rồi trả về hai thứ mà AC1 và AC3
 * cần, tất cả đều là dữ liệu thật do PostgreSQL sinh ra:
 *
 *  - `plan`: JSON của `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS)` cho PROBE_SQL.
 *  - `result`: 100 dòng × 5 cột thật của PROBE_SQL.
 *  - `btree`: `BTreeModel` thật của index 100k dòng, do `readBTree` (bản sao nguyên văn
 *    của `web/src/engines/postgres/btree-read.ts`) đọc qua `pageinspect`.
 *
 * Khác biệt duy nhất so với app thật: không có `guard.ts` (cần `pgsql-parser`) và không
 * có `verify()` kiểm role — hai thứ đó không đổi số byte. `readBTree` và `decodeKey` là
 * bản sao byte-for-byte; hash ghi trong ket_qua_do.md.
 */

import { PGlite } from "@electric-sql/pglite";
import { readBTreeAdmin } from "../ac3/btree-read";
import type { QueryResult } from "../contracts/engine";
import type { BTreeModel } from "../contracts/btree";
import { PROBE_SQL } from "../lib/fixture";

const WASM_DIR = "/pglite/";

type Msg = { type: "run"; rows: number; probeKey: string };

type Reply =
  | { type: "progress"; phase: string }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string };

const post = (m: Reply) => (self as unknown as Worker).postMessage(m);
const enc = new TextEncoder();

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`tải ${url} lỗi ${r.status}`);
  return r.arrayBuffer();
}

const toResults = (rs: { fields: { name: string }[]; rows: unknown[] }[]): QueryResult[] =>
  rs.map((r) => ({ columns: r.fields.map((f) => f.name), rows: r.rows as unknown[][] }));

/** Bản rút gọn của `createSession` trong `web/src/engines/postgres/roles.ts`: chỉ phần `adminSession` mà `readBTree` cần. */
function makeAdminSession(db: PGlite) {
  return async function adminSession<T>(
    fn: (q: (sql: string, params?: unknown[]) => Promise<QueryResult[]>) => Promise<T>,
  ): Promise<T> {
    await db.exec("RESET ROLE");
    try {
      const sp = (await db.query<{ s: string }>("SELECT pg_catalog.current_setting('search_path') AS s")).rows[0].s;
      await db.exec("SET search_path = pg_catalog, pg_temp");
      try {
        const out = await fn(async (sql, params) =>
          params
            ? toResults([await db.query(sql, params, { rowMode: "array" })])
            : toResults(await db.exec(sql, { rowMode: "array" })),
        );
        return out;
      } finally {
        await db.query("SELECT pg_catalog.set_config('search_path', $1, false)", [sp]);
      }
    } finally {
      await db.exec("SET ROLE sqllens_user");
    }
  };
}

async function boot() {
  post({ type: "progress", phase: "tải WASM" });
  const [wasm, initdb, data, pageinspect] = await Promise.all([
    fetchBytes(`${WASM_DIR}pglite.wasm`),
    fetchBytes(`${WASM_DIR}initdb.wasm`),
    fetchBytes(`${WASM_DIR}pglite.data`),
    fetchBytes(`${WASM_DIR}pageinspect.tar.gz`),
  ]);
  post({ type: "progress", phase: "PGlite.create" });
  // Cùng hình dạng với `web/src/engines/postgres/worker.ts`: pageinspect đưa qua blob URL
  // để lỗi tải báo ra thay vì treo.
  const bundlePath = new URL(URL.createObjectURL(new Blob([pageinspect])));
  const db = await PGlite.create({
    pgliteWasmModule: await WebAssembly.compile(wasm),
    initdbWasmModule: await WebAssembly.compile(initdb),
    fsBundle: new Blob([data]),
    extensions: { pageinspect: { name: "pageinspect", setup: async () => ({ bundlePath }) } },
  });
  URL.revokeObjectURL(bundlePath.href);
  await db.exec(`
    CREATE ROLE sqllens_user NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT NOLOGIN;
    ALTER SCHEMA public OWNER TO sqllens_user;
    CREATE EXTENSION pageinspect;
    SET ROLE sqllens_user;`);
  return db;
}

let dbPromise: Promise<PGlite> | undefined;
const getDb = () => (dbPromise ??= boot());

async function seed(db: PGlite, rows: number) {
  post({ type: "progress", phase: `nạp ${rows} dòng` });
  await db.exec(`
    DROP TABLE IF EXISTS orders;
    CREATE TABLE orders (
      id          bigint PRIMARY KEY,
      customer_id bigint NOT NULL,
      status      text NOT NULL,
      total       numeric(12,2) NOT NULL,
      created_at  timestamptz NOT NULL
    );`);
  await db.exec(`
    INSERT INTO orders
    SELECT g, (g % 2000) + 1, (ARRAY['new','paid','shipped','done'])[g % 4 + 1],
           (g % 100000) / 100.0, now() - (g || ' seconds')::interval
    FROM generate_series(1, ${rows}) g;`);
  post({ type: "progress", phase: "tạo index" });
  await db.exec("CREATE INDEX orders_customer_id_idx ON orders(customer_id);");
  await db.exec("ANALYZE orders;");
}

/** gzip tất định giống `compressGzip` trong codec SP022 (MTIME = 0, OS = 255). */
async function gzip(s: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([s]).stream().pipeThrough(cs);
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  bytes[4] = bytes[5] = bytes[6] = bytes[7] = 0;
  bytes[9] = 255;
  return bytes;
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    const db = await getDb();
    await seed(db, msg.rows);

    // ---- AC1: plan thật + kết quả thật của PROBE_SQL ----
    post({ type: "progress", phase: "EXPLAIN" });
    const explain = await db.query<unknown[]>(
      `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) ${PROBE_SQL}`,
      [],
      { rowMode: "array" },
    );
    const planJson = (explain.rows[0] as unknown[])[0];

    post({ type: "progress", phase: "chạy PROBE_SQL" });
    const res = await db.query<unknown[]>(PROBE_SQL, [], { rowMode: "array" });
    const result = {
      columns: res.fields.map((f) => f.name),
      // PGlite trả numeric/bigint dạng chuỗi và timestamptz dạng Date; đưa về đúng thứ
      // mà JSON của app thật mang đi (chuỗi) để số byte không bị đội lên vì Date object.
      rows: res.rows.map((r) => (r as unknown[]).map((v) => (v instanceof Date ? v.toISOString() : v))),
    };

    // ---- AC3: B-Tree thật của hai index 100k dòng ----
    const adminSession = makeAdminSession(db);
    post({ type: "progress", phase: "readBTree" });

    const indexes = ["orders_customer_id_idx", "orders_pkey"];
    const btrees: Record<string, unknown> = {};
    for (const index of indexes) {
      const t0 = performance.now();
      const read = await readBTreeAdmin(adminSession, index, { probeKey: msg.probeKey, maxNodes: 200 });
      const readMs = performance.now() - t0;
      if (read.model.kind !== "conclusion") {
        btrees[index] = { error: read.model.reasonKey };
        continue;
      }
      const model: BTreeModel = read.model.data;
      const [size] = await Promise.all([
        db.query<{ b: string }>(`SELECT pg_relation_size('${index}')::bigint::text AS b`),
      ]);
      const json = JSON.stringify(model);
      const withPath = JSON.stringify({ model, path: read.path });
      const [gzModel, gzPath] = await Promise.all([gzip(json), gzip(withPath)]);
      btrees[index] = {
        readMs,
        height: model.height,
        rootPage: model.rootPage,
        totalPages: model.totalPages,
        indexBytes: Number(size.rows[0].b),
        nodesRead: model.nodes.length,
        hidden: model.hidden,
        keysInModel: model.nodes.reduce((n, x) => n + x.keys.length, 0),
        totalKeysInModel: model.nodes.reduce((n, x) => n + x.totalKeys, 0),
        jsonBytes: enc.encode(json).length,
        jsonPathBytes: enc.encode(withPath).length,
        gzipBytes: gzModel.length,
        gzipPathBytes: gzPath.length,
        hasPath: !!read.path,
        pathPages: read.path?.pages.length ?? 0,
        // Model thật, để trang đo mã hóa nó qua đúng đường codec SP022 và đếm byte phải gửi.
        model,
        path: read.path,
      };
    }

    post({
      type: "result",
      data: {
        rows: msg.rows,
        plan: planJson,
        result,
        resultRowCount: result.rows.length,
        btrees,
      },
    });
  } catch (err) {
    const e = err as Error;
    post({ type: "error", message: `${e?.message}\n${e?.stack ?? ""}` });
  }
};
