import type { SqliteAdapter } from "./adapter";

/** Giới hạn cứng: chặn trước khi đọc byte nào, để tab không cố nạp file 500MB (Task134 AC3). */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** 16 byte đầu của mọi file SQLite: "SQLite format 3" + NUL. */
const MAGIC = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];

/** Chỉ nhìn 16 byte đầu: rẻ, và chạy được cả trong worker trước khi nạp. */
export function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MAGIC.length) return false;
  return MAGIC.every((b, i) => bytes[i] === b);
}

export type ImportErrorCode = "FILE_TOO_LARGE" | "NOT_SQLITE" | "IMPORT_FAILED";

/** Lỗi có mã để giao diện dịch đúng câu, kèm số đo thật (dung lượng) khi có. */
export class SqliteImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string = code,
    readonly bytes?: number,
  ) {
    super(message);
    this.name = "SqliteImportError";
  }
}

export type ImportResult = { tables: string[]; bytes: number };

// Bảng người dùng, bỏ qua bảng hệ thống (sqlite_sequence, sqlite_stat1, ...).
const TABLES_SQL = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";

/**
 * Nạp file `.sqlite`/`.db` của người dùng vào sandbox SQLite. File chỉ được đọc trong trình duyệt
 * (đọc trong worker), không gửi đi đâu (Task134 AC4).
 *
 * `adapter` phải là adapter SQLite thật: hàm này dùng `loadDatabase` mà Task134 bổ sung vào
 * `SqliteAdapter` (xem ban_giao_task134.md — EngineAdapter chung cố ý không có method này).
 */
export async function importSqliteFile(
  file: File,
  adapter: Pick<SqliteAdapter, "loadDatabase" | "execute">,
  options: { signal?: AbortSignal } = {},
): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new SqliteImportError("FILE_TOO_LARGE", `File ${file.size} byte, giới hạn ${MAX_IMPORT_BYTES}`, file.size);
  }
  if (file.size === 0) throw new SqliteImportError("NOT_SQLITE", "File rỗng", 0);

  // Đọc 16 byte đầu qua Blob.slice: không kéo cả file vào bộ nhớ chỉ để kiểm chữ ký.
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, MAGIC.length).arrayBuffer());
  } catch (e) {
    throw new SqliteImportError("IMPORT_FAILED", (e as Error).message);
  }
  if (!looksLikeSqlite(head)) {
    throw new SqliteImportError("NOT_SQLITE", "Không phải file SQLite", file.size);
  }

  try {
    await adapter.loadDatabase(file, { signal: options.signal });
  } catch (e) {
    // Người dùng bấm huỷ: giữ nguyên lỗi huỷ, không báo thành "file hỏng".
    if (options.signal?.aborted) throw e;
    throw new SqliteImportError("IMPORT_FAILED", (e as Error).message, file.size);
  }

  let tables: string[];
  try {
    const res = (await adapter.execute(TABLES_SQL, { internal: true }))[0];
    tables = (res?.rows ?? []).map((r) => String(r[0]));
  } catch (e) {
    throw new SqliteImportError("IMPORT_FAILED", (e as Error).message, file.size);
  }
  return { tables, bytes: file.size };
}
