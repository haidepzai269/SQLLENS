/// <reference lib="webworker" />
import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import type { EngineErrorData, QueryResult } from "@/contracts/engine";
import type { SqliteWorkerRequest, SqliteWorkerResponse } from "./protocol";

type Db = InstanceType<Sqlite3Static["oo1"]["DB"]>;

/** Lỗi SQL có chỉ số câu (đếm từ 1) để giao diện chỉ đúng câu hỏng trong chuỗi nhiều câu. */
export class SqliteSqlError extends Error {
  constructor(
    message: string,
    readonly statementIndex?: number,
  ) {
    super(message);
    this.name = "SqliteSqlError";
  }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
// oo1 gắn tiền tố mã lỗi ("SQLITE_ERROR: ..."); hiện chữ thô dễ đọc hơn.
const withoutCode = (m: string) => m.replace(/^SQLITE_[A-Z0-9_]+:\s*/, "");

// BLOB không đi qua structured clone được, và hợp đồng yêu cầu chuyển base64 (Task132 AC1).
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const valueOut = (value: unknown): unknown => (value instanceof Uint8Array ? toBase64(value) : value);

/**
 * Tách câu bằng chính bộ phân tích của SQLite (pzTail), không tự viết splitter cho chuỗi/comment.
 * Chuẩn bị và chạy xen kẽ từng câu: `CREATE TABLE` phải xong trước khi prepare `INSERT` vào bảng đó.
 */
function runScript(sqlite3: Sqlite3Static, db: Db, sql: string): QueryResult[] {
  const { wasm, capi } = sqlite3;
  const dbPtr = db.pointer;
  if (dbPtr === undefined) throw new Error("DB SQLite đã đóng");
  const out: QueryResult[] = [];
  const scope = wasm.scopedAllocPush();
  try {
    const [sqlPtr, byteLength] = wasm.scopedAllocCString(sql, true);
    const [ppStmt, pzTail] = wasm.scopedAllocPtr(2);
    let offset = 0;
    while (offset < byteLength) {
      // nByte = byteLength - offset: con trỏ đã lệch offset byte, không dựa vào NUL của chuỗi con.
      const rc = capi.sqlite3_prepare_v2(dbPtr, sqlPtr + offset, byteLength - offset, ppStmt, pzTail);
      if (rc !== 0) throw new SqliteSqlError(withoutCode(capi.sqlite3_errmsg(dbPtr)), out.length + 1);
      const stmt = Number(wasm.peekPtr(ppStmt));
      if (!stmt) break; // còn lại chỉ là khoảng trắng/comment
      // sqlite3_sql trả bản sao văn bản gốc của câu, nên không phải tự quy đổi byte ↔ ký tự UTF-16.
      const text = capi.sqlite3_sql(stmt);
      capi.sqlite3_finalize(stmt);
      out.push(runOne(db, text, out.length + 1));
      const next = Number(wasm.peekPtr(pzTail)) - Number(sqlPtr);
      if (next <= offset) break; // phòng thủ: không tiến thì dừng, không treo worker
      offset = next;
    }
  } finally {
    wasm.scopedAllocPop(scope);
  }
  return out;
}

function runOne(db: Db, text: string, index: number): QueryResult {
  let stmt: ReturnType<Db["prepare"]>;
  try {
    // prepare lỗi (cú pháp, không có bảng) là lỗi của câu này, không phải của worker.
    stmt = db.prepare(text);
  } catch (e) {
    throw new SqliteSqlError(withoutCode(messageOf(e)), index);
  }
  try {
    const columns = stmt.columnCount > 0 ? stmt.getColumnNames() : [];
    const rows: unknown[][] = [];
    while (stmt.step()) rows.push((stmt.get([]) as unknown[]).map(valueOut));
    const result: QueryResult = { columns, rows };
    // sqlite3_changes() giữ nguyên số của câu DML trước đó với DDL/BEGIN/SELECT, nên chỉ đọc cho DML.
    if (columns.length === 0 && /^\s*(?:insert|replace|update|delete)\b/i.test(text)) result.affectedRows = db.changes();
    return result;
  } catch (e) {
    throw new SqliteSqlError(withoutCode(messageOf(e)), index);
  } finally {
    stmt.finalize();
  }
}

export type SqliteSession = {
  readonly vfs: string;
  readonly libVersion: string;
  run(sql: string): QueryResult[];
  close(): void;
};

/**
 * DB trong bộ nhớ. OPFS SAHPool để dành cho Task134/135 (nhập/xuất file), vì lưu bền vững
 * chỉ có nghĩa khi đã có đường đưa file của người dùng vào.
 */
export async function createSqliteSession(): Promise<SqliteSession> {
  // Nạp động: import tĩnh sẽ kéo WASM vào bundle chính dù người dùng không chọn SQLite (AC2).
  const { default: sqlite3InitModule } = await import("@sqlite.org/sqlite-wasm");
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(":memory:", "c");

  return {
    vfs: "memory",
    libVersion: sqlite3.version.libVersion,
    run(sql) {
      return runScript(sqlite3, db, sql);
    },
    close() {
      if (db.isOpen()) db.close();
    },
  };
}

const post = (m: SqliteWorkerResponse) => postMessage(m);
let session: SqliteSession | undefined;

const toError = (e: unknown, code: EngineErrorData["code"]): EngineErrorData => ({
  code,
  message: messageOf(e),
  statementIndex: e instanceof SqliteSqlError ? e.statementIndex : undefined,
});

// Node/jsdom không có WorkerGlobalScope: cùng một file dùng được trong test mà không tự gắn onmessage.
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = async ({ data: m }: MessageEvent<SqliteWorkerRequest>) => {
    try {
      if (m.type === "init") {
        post({ id: m.id, type: "progress", progress: { phase: "init" } });
        session ??= await createSqliteSession();
        post({ id: m.id, type: "done", results: [] });
        return;
      }
      if (!session) throw new Error("SQLite chưa nạp");
      post({ id: m.id, type: "done", results: session.run(m.sql) });
    } catch (e) {
      post({ id: m.id, type: "error", error: toError(e, m.type === "init" ? "load_failed" : "sql") });
    }
  };
}
