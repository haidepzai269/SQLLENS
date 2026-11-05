import type { BTreeModel, BTreePath } from "./btree";
import type { Outcome } from "./conclusion";
import type { Plan } from "./plan";

export type EngineId = "postgres" | "mysql";
/** `truncated`: engine đã cắt bớt dòng (MySQL qua sandbox: tối đa 10.000 dòng). */
export type QueryResult = { columns: string[]; rows: unknown[][]; affectedRows?: number; truncated?: boolean };
export type LoadProgress = { phase: "download" | "init"; loadedBytes?: number; totalBytes?: number };
export type EngineErrorCode = "timeout" | "cancelled" | "load_failed" | "sql" | "worker_crashed";
/** Lỗi do lớp bảo vệ. Giao diện dịch bằng `t(reasonKey, { index: statementIndex })` với `useTranslations()` gốc (khóa dạng `guard.role`). */
export type GuardInfo = { reasonKey: string; statementIndex?: number; rebuilt?: boolean };
export type EngineErrorData = { code: EngineErrorCode; message: string; position?: number; guard?: GuardInfo; statementIndex?: number };

// Error thật để chỗ cũ dùng `e.message` vẫn chạy; `code` và `position` cho chỗ cần phân loại.
export type ProbeStats = { rows: number; sharedHitBlocks: number; sharedReadBlocks: number; nodeTypes: string[] };
export type TryChangeResult = { before: ProbeStats; after: ProbeStats; plans: { before: unknown; after: unknown } };

export class EngineError extends Error implements EngineErrorData {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly position?: number,
    readonly guard?: GuardInfo,
    /** Câu SQL gây lỗi, đếm từ 1. Không có khi không xác định được. */
    readonly statementIndex?: number,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export interface EngineAdapter {
  readonly engine: EngineId;
  /** false khi lớp một (parser chặn SET ROLE...) không tải được: chỉ còn lớp hai. Không có thì coi như không áp dụng. */
  readonly guardActive?: boolean;
  /** `internal: true` cho câu của chính ứng dụng (kiểm bảng, sinh dữ liệu): chạy nhưng không vào history(), nên dựng lại không chạy lại chúng. */
  execute(sql: string, options?: { signal?: AbortSignal; internal?: boolean }): Promise<QueryResult[]>;
  explain(sql: string, options?: { signal?: AbortSignal }): Promise<Outcome<Plan>>;
  /** Đo `probe`, áp `change` trong transaction, đo lại rồi ROLLBACK. Không đổi dữ liệu, không vào history(). */
  tryChange(change: string, probe: string): Promise<Outcome<TryChangeResult>>;
  /** Đọc cây B-Tree thật của một index trong schema public. Chỉ đọc, không vào history(). `maxNodes` mặc định 200. */
  readBTree(index: string, options?: { probeKey?: string; maxNodes?: number }): Promise<{ model: Outcome<BTreeModel>; path?: BTreePath }>;
  /** Dừng câu đang chạy bằng terminate worker; sau đó phải gọi rebuild(). */
  cancel(): Promise<void>;
  /** Các câu đã chạy thành công từ lúc khởi tạo. */
  history(): readonly string[];
  /** Tạo worker mới rồi chạy lại history(). */
  rebuild(): Promise<void>;
  dispose(): Promise<void>;
}
