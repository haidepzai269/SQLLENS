import type { Outcome } from "./conclusion";

export type EngineId = "postgres" | "mysql";
export type QueryResult = { columns: string[]; rows: unknown[][]; affectedRows?: number };
export type LoadProgress = { phase: "download" | "init"; loadedBytes?: number; totalBytes?: number };
export type EngineErrorCode = "timeout" | "cancelled" | "load_failed" | "sql" | "worker_crashed";
export type EngineErrorData = { code: EngineErrorCode; message: string; position?: number };

// Error thật để chỗ cũ dùng `e.message` vẫn chạy; `code` và `position` cho chỗ cần phân loại.
export class EngineError extends Error implements EngineErrorData {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly position?: number,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export interface EngineAdapter {
  readonly engine: EngineId;
  execute(sql: string, options?: { signal?: AbortSignal }): Promise<QueryResult[]>;
  explain(sql: string, options?: { signal?: AbortSignal }): Promise<Outcome<unknown>>;
  /** Dừng câu đang chạy bằng terminate worker; sau đó phải gọi rebuild(). */
  cancel(): Promise<void>;
  /** Các câu đã chạy thành công từ lúc khởi tạo. */
  history(): readonly string[];
  /** Tạo worker mới rồi chạy lại history(). */
  rebuild(): Promise<void>;
  dispose(): Promise<void>;
}
