// Worker của harness đo SQLite WASM (Task131). Không phải code sản phẩm.
// Mở DB trên OPFS nếu có (cần COOP/COEP), không thì rơi về DB trong bộ nhớ.

import sqlite3InitModule from "./vendor/index.mjs";

const DB_FILE = "/sqllens-spike.sqlite3";
const BASE_COLUMNS = ["name", "city", "note", "n"];

let sqlite3 = null;
let db = null;
let vfs = "none";
let totalRows = 0;

const columnsFor = (extra) => {
  const cols = [...BASE_COLUMNS];
  for (let i = 1; i <= extra; i++) cols.push(`c${i}`);
  return cols;
};

const ddlFor = (extra) => {
  const cols = columnsFor(extra);
  const parts = ["id INTEGER PRIMARY KEY", ...cols.map((c) => (c === "n" ? "n INTEGER" : `${c} TEXT`))];
  return parts.join(", ");
};

const valueFor = (column, row) => {
  if (column === "n") return row;
  if (column === "city") return row % 2 === 0 ? "Ha Noi" : "Ho Chi Minh";
  // Chuỗi ~24 byte để mỗi dòng có khối lượng dữ liệu thật, không phải dòng rỗng.
  return `${column}-${row.toString(36).padStart(6, "0")}`;
};

async function init(payload = {}) {
  const t0 = performance.now();
  sqlite3 = await sqlite3InitModule();
  const initMs = performance.now() - t0;

  // OPFS: dùng SAH pool VFS (API được khuyến nghị, không cần worker proxy riêng).
  // VFS `opfs` cổ điển cần file sqlite3-opfs-async-proxy.js được phục vụ đúng chỗ;
  // nếu nó đã được cài thì dùng luôn, không thì mới tới DB trong bộ nhớ.
  const opfsAvailable = "opfs" in sqlite3 || typeof sqlite3.installOpfsSAHPoolVfs === "function";
  let usedPool = false;

  if (payload.opfs !== false && opfsAvailable) {
    if ("opfs" in sqlite3) {
      db = new sqlite3.oo1.OpfsDb(DB_FILE);
      vfs = "opfs";
    } else {
      try {
        const util = await sqlite3.installOpfsSAHPoolVfs({ name: "sqllens-spike-pool", directory: "/sqllens-spike" });
        db = new util.OpfsSAHPoolDb(DB_FILE);
        vfs = "opfs-sahpool";
        usedPool = true;
      } catch {
        db = new sqlite3.oo1.DB(":memory:", "c");
        vfs = "memory";
      }
    }
  } else {
    db = new sqlite3.oo1.DB(":memory:", "c");
    vfs = "memory";
  }

  return {
    initMs,
    opfsAvailable,
    opfsPool: usedPool,
    vfs,
    libVersion: sqlite3.version.libVersion,
    dbFilename: db.filename,
    crossOriginIsolated: self.crossOriginIsolated,
  };
}

function reset(payload = {}) {
  if (!db) throw new Error("DB chưa nạp");
  const extra = Number(payload.extraColumns ?? 0);
  db.exec("DROP TABLE IF EXISTS metrics");
  db.exec(`CREATE TABLE metrics (${ddlFor(extra)})`);
  totalRows = 0;
  return { totalRows, extraColumns: extra };
}

function insert(payload = {}) {
  if (!db) throw new Error("DB chưa nạp");
  const rows = Number(payload.rows);
  if (!Number.isFinite(rows) || rows <= 0) throw new Error("rows không hợp lệ");
  const extra = Number(payload.extraColumns ?? 0);
  const columns = columnsFor(extra);
  const placeholders = columns.map(() => "?").join(",");
  const t0 = performance.now();

  const stmt = db.prepare(`INSERT INTO metrics (${columns.join(",")}) VALUES (${placeholders})`);
  try {
    db.transaction(() => {
      for (let i = 0; i < rows; i++) {
        const row = totalRows + i + 1;
        stmt.bind(columns.map((c) => valueFor(c, row)));
        stmt.step();
        stmt.reset();
        stmt.clearBindings();
      }
    });
  } finally {
    stmt.finalize();
  }

  totalRows += rows;
  return { ms: performance.now() - t0, totalRows };
}

function count() {
  if (!db) throw new Error("DB chưa nạp");
  const t0 = performance.now();
  const value = db.selectValue("SELECT count(*) FROM metrics");
  return { rows: Number(value), ms: performance.now() - t0 };
}

function exportDb() {
  if (!db) throw new Error("DB chưa nạp");
  const bytes = sqlite3.capi.sqlite3_js_db_export(db);
  return { bytes: bytes.byteLength };
}

// Bộ nhớ tuyến tính của WASM — nơi SQLite thật sự giữ dữ liệu khi VFS là bộ nhớ.
// measureUserAgentSpecificMemory() ở trang KHÔNG thấy heap của worker, nên phải đọc ở đây.
function memory() {
  let heap = null;
  // Tuỳ bản build, helper WASM nằm ở sqlite3.wasm hoặc sqlite3.capi.wasm.
  for (const helper of [sqlite3?.wasm, sqlite3?.capi?.wasm]) {
    try {
      const view = helper?.heap8u?.();
      if (view) {
        heap = view;
        break;
      }
    } catch {
      // thử helper tiếp theo
    }
  }
  return {
    wasmMemoryMB: heap ? Number((heap.buffer.byteLength / 1048576).toFixed(2)) : null,
    vfs,
    rows: totalRows,
    dbFilename: db?.filename ?? null,
  };
}

function resources() {
  return performance.getEntriesByType("resource").map((e) => ({
    name: e.name.split("/").pop(),
    durationMs: Math.round(e.duration),
    transferSize: e.transferSize,
    encodedBodySize: e.encodedBodySize,
    decodedBodySize: e.decodedBodySize,
  }));
}

function close() {
  if (db) db.close();
  db = null;
  vfs = "none";
  return { ok: true };
}

self.onmessage = async (event) => {
  const { id, op, payload } = event.data ?? {};
  try {
    let result;
    switch (op) {
      case "init":
        result = await init(payload);
        break;
      case "reset":
        result = reset(payload);
        break;
      case "insert":
        result = insert(payload);
        break;
      case "count":
        result = count();
        break;
      case "export":
        result = exportDb();
        break;
      case "memory":
        result = memory();
        break;
      case "resources":
        result = resources();
        break;
      case "close":
        result = close();
        break;
      default:
        throw new Error(`Không biết lệnh ${op}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};
