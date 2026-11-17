/// <reference lib="webworker" />
import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import type { EngineErrorData, QueryResult } from "@/contracts/engine";
import { looksLikeSqlite } from "./import-file";
import type { SqliteFileSource, SqliteWorkerRequest, SqliteWorkerResponse } from "./protocol";

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
 * Bỏ qua comment (--..., /*...* /) và khoảng trắng/dấu chấm phẩy để nhận diện câu lệnh DML.
 * Hỗ trợ cả câu DML có leading comments, leading semicolons hoặc CTE (WITH ... INSERT/UPDATE/DELETE).
 */
export function isDmlStatement(text: string): boolean {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .replace(/^[\s;]+/g, "");
  return (
    /^(?:insert|replace|update|delete)\b/i.test(stripped) ||
    (/^with\b/i.test(stripped) && /\b(?:insert|replace|update|delete)\b/i.test(stripped))
  );
}

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
    if (columns.length === 0 && isDmlStatement(text)) result.affectedRows = db.changes();
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
  /** Thay toàn bộ database bằng nội dung file. File hỏng thì **giữ nguyên** database cũ và ném lỗi. */
  load(source: SqliteFileSource): Promise<void>;
  /** Toàn bộ database dưới dạng file SQLite (kể cả khi chưa có bảng: vẫn là file hợp lệ). */
  serialize(): Uint8Array;
  close(): void;
};

const bytesOf = async ({ bytes, file }: SqliteFileSource): Promise<Uint8Array> => {
  if (bytes) return bytes;
  if (!file) throw new Error("Thiếu dữ liệu file");
  // Đọc file trong worker: file 40MB không làm đứng giao diện (Task134 AC5).
  return new Uint8Array(await file.arrayBuffer());
};

/**
 * DB trong bộ nhớ. Nhập/xuất file dùng `sqlite3_deserialize`/`sqlite3_serialize` trên chính handle
 * đang chạy, nên không cần ATTACH (bị rào chắn Task133 chặn) và không cần ghi ra FS ảo.
 */
export async function createSqliteSession(): Promise<SqliteSession> {
  // Nạp động: import tĩnh sẽ kéo WASM vào bundle chính dù người dùng không chọn SQLite (AC2).
  const { default: sqlite3InitModule } = await import("@sqlite.org/sqlite-wasm");
  const sqlite3 = await sqlite3InitModule();
  const { capi, wasm } = sqlite3;
  let db = new sqlite3.oo1.DB(":memory:", "c");

  return {
    vfs: "memory",
    libVersion: sqlite3.version.libVersion,
    run(sql) {
      return runScript(sqlite3, db, sql);
    },
    async load(source) {
      const bytes = await bytesOf(source);
      if (bytes.byteLength === 0) throw new Error("File rỗng, không phải database SQLite");
      // sqlite3_deserialize trả 0 với cả file rác (đã đo), nên phải tự kiểm magic trước.
      if (!looksLikeSqlite(bytes)) throw new Error("Không phải file SQLite (thiếu chữ ký SQLite format 3)");
      if (db.pointer === undefined) throw new Error("DB SQLite đã đóng");
      // Nạp vào DB mới rồi mới thay: file hỏng giữa đường không phá database đang mở.
      const next = new sqlite3.oo1.DB(":memory:", "c");
      const nextPtr = next.pointer;
      if (nextPtr === undefined) throw new Error("Không mở được database để nạp file");
      const buffer = wasm.allocFromTypedArray(bytes);
      const rc = capi.sqlite3_deserialize(nextPtr, "main", buffer, bytes.byteLength, bytes.byteLength, capi.SQLITE_DESERIALIZE_FREEONCLOSE);
      if (rc !== 0) {
        const msg = withoutCode(capi.sqlite3_errmsg(nextPtr));
        wasm.dealloc(buffer); // thất bại thì SQLite không nhận quyền sở hữu buffer
        next.close();
        throw new Error(msg);
      }
      try {
        // File mã hóa đúng chuẩn SQLCipher vẫn có magic nhưng trang bị xáo: đọc thử mới biết.
        next.selectValue("select count(*) from sqlite_master");
      } catch (e) {
        const msg = withoutCode(messageOf(e));
        next.close();
        throw new Error(`Không đọc được nội dung database: ${msg}`);
      }
      if (db.isOpen()) db.close();
      db = next;
    },
    serialize() {
      const ptr = db.pointer;
      if (ptr === undefined) throw new Error("DB SQLite đã đóng");
      const scope = wasm.scopedAllocPush();
      try {
        const pSize = wasm.scopedAlloc(4);
        const p = capi.sqlite3_serialize(ptr, "main", pSize, 0);
        const size = Number(wasm.peekPtr(pSize));
        if (!p || !size) throw new Error("Không đọc được nội dung database");
        const out = wasm.heap8u().slice(p, p + size); // copy ra ngoài heap WASM
        capi.sqlite3_free(p);
        return out;
      } finally {
        wasm.scopedAllocPop(scope);
      }
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
      if (m.type === "load") {
        post({ id: m.id, type: "progress", progress: { phase: "init" } });
        await session.load(m.source);
        post({ id: m.id, type: "done", results: [] });
        return;
      }
      if (m.type === "export") {
        post({ id: m.id, type: "done", bytes: session.serialize() });
        return;
      }
      post({ id: m.id, type: "done", results: session.run(m.sql) });
    } catch (e) {
      const code = m.type === "exec" ? "sql" : m.type === "export" ? "sql" : "load_failed";
      post({ id: m.id, type: "error", error: toError(e, code) });
    }
  };
}
