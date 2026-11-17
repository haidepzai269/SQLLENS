import type { SqliteAdapter } from "./adapter";

/** Kiểu MIME đã đăng ký cho file SQLite. */
export const SQLITE_MIME = "application/vnd.sqlite3";
const FALLBACK = "sqllens";
const EXT = ".sqlite";

/** Blob kèm tên đã chuẩn hoá, để chỗ tải về không phải đoán lại tên file. */
export type SqliteExportBlob = Blob & { name: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** `<tên dự án>-<YYYYMMDD-HHmm>.sqlite`, bỏ ký tự không hợp lệ cho tên file trên Windows/macOS. */
export function sqliteExportName(projectName: string, at: Date = new Date()): string {
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  const base = projectName
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 60)
    .trim();
  return `${base || FALLBACK}-${stamp}${EXT}`;
}

/** Bổ sung `.sqlite` nếu người gọi quên, và bỏ phần đường dẫn nếu có. */
export function ensureSqliteName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const clean = base.trim() || `${FALLBACK}${EXT}`;
  return clean.toLowerCase().endsWith(EXT) ? clean : `${clean}${EXT}`;
}

/**
 * Đọc toàn bộ database đang mở thành file SQLite (bản sao nhị phân, không phải bản đã VACUUM lại).
 * Không có request mạng nào: byte đi từ WASM ra Blob trong máy (Task135 AC4).
 */
export async function exportSqliteFile(
  adapter: Pick<SqliteAdapter, "exportDatabase">,
  filename: string,
): Promise<SqliteExportBlob> {
  const bytes = await adapter.exportDatabase();
  // `bytes` là Uint8Array của chính mình, không chia sẻ với WASM nữa (đã copy khi serialize).
  const blob = new Blob([bytes as BlobPart], { type: SQLITE_MIME });
  return Object.assign(blob, { name: ensureSqliteName(filename) });
}
