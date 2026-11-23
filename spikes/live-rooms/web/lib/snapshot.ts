/**
 * SQLLens URL Share Snapshot Specification (V1)
 *
 * Định nghĩa cấu trúc SnapshotV1 nhúng vào URL fragment (#d=...),
 * các hằng số giới hạn kích thước và lớp lỗi chuẩn hóa.
 * Tuân thủ Core Rule 7: 100% dữ liệu không rời khỏi máy khách.
 */

export interface SnapshotV1 {
  v: 1;
  project: {
    name: string;
    engine: "postgres" | "mysql" | "sqlite";
  };
  tabs: {
    name: string;
    sql: string;
  }[];
}

/** Trần kích thước cứng của URL fragment: 32 KB (32.768 bytes) */
export const SNAPSHOT_HARD_LIMIT_BYTES = 32 * 1024;

/** Ngưỡng cảnh báo độ dài link URL: 8 KB (8.192 bytes) */
export const SNAPSHOT_WARN_LIMIT_BYTES = 8 * 1024;

/**
 * Trần số tab của một snapshot: 100, trùng quota tab cloud (`store.MaxCloudTabs`).
 * Link 32 KB vẫn nhét được ~1.400 tab rỗng, nên nếu không chặn thì bấm Fork sẽ ghi cả nghìn
 * tab vào IndexedDB của người nhận (SP999, phát hiện mức thấp của cổng bảo mật Task155).
 */
export const MAX_SNAPSHOT_TABS = 100;

export type SnapshotErrorCode =
  | "SNAPSHOT_TOO_LARGE"
  | "SNAPSHOT_TOO_MANY_TABS"
  | "SNAPSHOT_CORRUPT"
  | "SNAPSHOT_VERSION_UNSUPPORTED";

export class SnapshotError extends Error {
  readonly code: SnapshotErrorCode;
  readonly details?: unknown;

  constructor(code: SnapshotErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "SnapshotError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, SnapshotError.prototype);
  }
}

/**
 * Snapshot có quá `MAX_SNAPSHOT_TABS` tab hay không. Tách khỏi `validateSnapshotStructure`
 * để bên gọi báo đúng mã lỗi thay vì gộp vào "dữ liệu hỏng".
 */
export function snapshotTabLimitExceeded(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const tabs = (obj as Record<string, unknown>).tabs;
  return Array.isArray(tabs) && tabs.length > MAX_SNAPSHOT_TABS;
}

/**
 * Kiểm tra xem chuỗi URL fragment đã mã hóa có chạm hoặc vượt ngưỡng cảnh báo (>= 8KB) hay không.
 * Từ 8KB trở lên cần cảnh báo người dùng khi dán vào các ứng dụng chat (Telegram, Slack, Discord...).
 */
export function isSnapshotWarnSize(encoded: string): boolean {
  return typeof encoded === "string" && encoded.length >= SNAPSHOT_WARN_LIMIT_BYTES;
}

/**
 * Kiểm tra tính hợp lệ về cấu trúc của đối tượng SnapshotV1.
 */
export function validateSnapshotStructure(obj: unknown): obj is SnapshotV1 {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  if (candidate.v !== 1) {
    return false;
  }

  if (typeof candidate.project !== "object" || candidate.project === null) {
    return false;
  }

  const project = candidate.project as Record<string, unknown>;
  if (typeof project.name !== "string") {
    return false;
  }

  if (
    project.engine !== "postgres" &&
    project.engine !== "mysql" &&
    project.engine !== "sqlite"
  ) {
    return false;
  }

  if (!Array.isArray(candidate.tabs) || candidate.tabs.length > MAX_SNAPSHOT_TABS) {
    return false;
  }

  for (const tab of candidate.tabs) {
    if (typeof tab !== "object" || tab === null) {
      return false;
    }
    const tabObj = tab as Record<string, unknown>;
    if (typeof tabObj.name !== "string" || typeof tabObj.sql !== "string") {
      return false;
    }
  }

  return true;
}
