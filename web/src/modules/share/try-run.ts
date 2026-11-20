/**
 * Chạy thử một tab của snapshot chia sẻ ngay trong trình duyệt của người xem.
 *
 * Toàn bộ việc chạy nằm ở máy khách: PGlite (PostgreSQL) hoặc SQLite WASM trong Web Worker,
 * không gọi API, không gửi SQL lên server (Core Rule 7). MySQL cần sandbox trên máy chủ nên
 * hàm này **từ chối** thay vì tự mở phiên: trang share không được tạo container sau lưng
 * người xem và không được gọi mạng.
 *
 * Mỗi lần chạy dùng một phiên mới rồi dựng lại từ đầu:
 * - bấm Chạy 5 lần cho cùng một kết quả, không dính lỗi "bảng đã tồn tại" của lần trước;
 * - câu treo bị ngắt (timeout 1.500 ms) không để lại phiên hỏng cho lần sau;
 * - không có trạng thái nào của người xem bị giữ lại ngoài trang (AC6).
 */

import { EngineError, type EngineAdapter, type LoadProgress } from "@/contracts/engine";
import { assertSqliteSafe, SQLITE_GUARD_MESSAGE_KEY } from "@/engines/sqlite/guard";
import type { SnapshotV1 } from "./snapshot";

/** Hạn của một câu SQL, bằng các engine khác (Task132 AC4). Tải WASM có hạn riêng 30 giây. */
export const SNAPSHOT_RUN_TIMEOUT_MS = 1_500;

/**
 * Trần số dòng giữ lại sau khi chạy. Kết quả 100k dòng vẫn đếm đủ `totalRows`, nhưng chỉ
 * giữ 2.000 dòng đầu để không nhồi 100k dòng qua structured clone và vào DOM.
 */
export const MAX_SNAPSHOT_RESULT_ROWS = 2_000;

export type SnapshotRunEngine = SnapshotV1["project"]["engine"];
/** Engine chạy được tại máy khách. */
export type LocalEngine = Exclude<SnapshotRunEngine, "mysql">;

export type SnapshotRunOutcome =
  | {
      kind: "result";
      /**
       * Nhãn kết luận theo Core Rule 1. Database vừa chạy ra đúng những dòng này, nên đây là
       * `"real"` — tên dùng chung của toàn dự án (`EvidenceLabel` trong `contracts/conclusion.ts`,
       * hiển thị là "Thật" qua `ConclusionBadge`).
       */
      label: "real";
      /** Số câu đã chạy xong (kể cả câu tạo bảng ở các tab trước). */
      statements: number;
      /** Tên cột của câu cuối. Rỗng với DDL/DML không trả dòng. */
      fields: string[];
      rows: unknown[][];
      /** Số dòng câu cuối trả về, kể cả phần không giữ lại. */
      totalRows: number;
      /** true khi `rows` đã bị cắt bớt theo `MAX_SNAPSHOT_RESULT_ROWS`. */
      truncated: boolean;
      affectedRows?: number;
    }
  /** Tab không có nội dung (và không có tab nào trước nó để dựng schema). */
  | { kind: "empty" }
  /** MySQL: chạy thật cần sandbox trên máy chủ, trang share không tự mở. */
  | { kind: "needs_sandbox"; engine: "mysql" };

export type SnapshotRunErrorCode = "timeout" | "cancelled" | "sql" | "load_failed" | "worker_crashed" | "guard";

export class SnapshotRunError extends Error {
  constructor(
    readonly code: SnapshotRunErrorCode,
    message: string,
    /** Vị trí 1-based do engine báo, để tô đúng chỗ sai. */
    readonly position?: number,
    /** Khóa dịch của lớp bảo vệ (dạng `guard.role`, `guard.sqlite.attach`). */
    readonly guardReasonKey?: string,
    /** Câu gây lỗi, đếm từ 1. */
    readonly statementIndex?: number,
  ) {
    super(message);
    this.name = "SnapshotRunError";
    Object.setPrototypeOf(this, SnapshotRunError.prototype);
  }
}

export type CreateLocalAdapter = (
  engine: LocalEngine,
  options: { timeoutMs: number; onProgress?: (p: LoadProgress) => void },
) => Promise<EngineAdapter>;

export type SnapshotRunOptions = {
  /** Hủy câu đang chạy (nút Hủy): worker bị dừng, không promise nào treo. */
  signal?: AbortSignal;
  /**
   * SQL của các tab đứng trước tab đang chạy, chạy trước trên cùng phiên.
   * Nhờ vậy tab thứ hai của một snapshot (câu truy vấn) vẫn có bảng của tab thứ nhất.
   */
  setupSql?: string;
  timeoutMs?: number;
  /** Tiến trình tải WASM, để giao diện báo "đang tải PostgreSQL…". */
  onProgress?: (p: LoadProgress) => void;
  /** Dành cho test: thay engine thật bằng adapter giả. */
  createAdapter?: CreateLocalAdapter;
};

/**
 * Adapter thật, nạp động: người xem snapshot MySQL không phải tải WASM của PostgreSQL.
 * `timeoutMs` áp cho câu SQL; tải và khởi tạo WASM có hạn riêng bên trong adapter.
 */
async function createLocalAdapter(
  engine: LocalEngine,
  { timeoutMs, onProgress }: { timeoutMs: number; onProgress?: (p: LoadProgress) => void },
): Promise<EngineAdapter> {
  if (engine === "sqlite") {
    const { createSqliteAdapter } = await import("@/engines/sqlite/adapter");
    return createSqliteAdapter({ timeoutMs, onProgress });
  }
  const { createPostgresAdapter } = await import("@/engines/postgres/adapter");
  return createPostgresAdapter({ timeoutMs, onProgress });
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function toRunError(e: unknown): SnapshotRunError {
  if (e instanceof SnapshotRunError) return e;
  if (e instanceof EngineError) {
    if (e.guard) {
      return new SnapshotRunError(
        "guard",
        e.message,
        e.position,
        e.guard.reasonKey,
        e.guard.statementIndex ?? e.statementIndex,
      );
    }
    return new SnapshotRunError(e.code, e.message, e.position, undefined, e.statementIndex);
  }
  return new SnapshotRunError("sql", messageOf(e));
}

/**
 * Chạy `tab.sql` (sau `setupSql` nếu có) trong một phiên mới của engine tại máy khách.
 *
 * Ném `SnapshotRunError` khi SQL lỗi, câu treo quá `timeoutMs`, hay người xem bấm Hủy.
 * MySQL trả `{ kind: "needs_sandbox" }` và **không** dựng adapter nào.
 */
export async function runSnapshotTab(
  tab: { name: string; sql: string },
  engine: SnapshotRunEngine,
  options: SnapshotRunOptions = {},
): Promise<SnapshotRunOutcome> {
  // MySQL: sandbox nằm trên máy chủ. Trang share không tự mở container và không gọi mạng (AC3).
  if (engine === "mysql") return { kind: "needs_sandbox", engine: "mysql" };

  const setup = options.setupSql?.trim() ? options.setupSql : "";
  const sql = tab.sql;
  // Tab đang mở rỗng thì không có gì để chạy, kể cả khi tab trước có schema: người xem bấm Chạy
  // cho chính tab này. Trả `empty` thay vì dựng cả một phiên để không làm gì.
  if (sql.trim() === "") return { kind: "empty" };

  const aborted = () => options.signal?.aborted === true;
  if (aborted()) throw new SnapshotRunError("cancelled", "Đã hủy câu đang chạy");

  // Rào chắn SQLite chạy trước khi nạp WASM: ATTACH/DETACH/VACUUM INTO/load_extension bị chặn
  // thì không câu nào được chạy (Core Rule 8, Task133). Không sửa câu, chỉ trả lời được hay không.
  if (engine === "sqlite") {
    const guard = assertSqliteSafe([setup, sql].filter((part) => part !== "").join(";\n"));
    if (!guard.ok) {
      throw new SnapshotRunError("guard", "SQLite guard", undefined, SQLITE_GUARD_MESSAGE_KEY[guard.reason]);
    }
  }

  const timeoutMs = options.timeoutMs ?? SNAPSHOT_RUN_TIMEOUT_MS;
  const create = options.createAdapter ?? createLocalAdapter;
  let db: EngineAdapter | undefined;
  // Người xem bấm Hủy trong lúc WASM còn đang tải: adapter chưa có để `cancel()`, nên ghi cờ
  // rồi dừng ngay sau khi tạo xong, thay vì chạy tiếp một câu người dùng đã bỏ.
  let cancelledEarly = false;
  const onAbort = () => {
    cancelledEarly = true;
    void db?.cancel();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    db = await create(engine, { timeoutMs, onProgress: options.onProgress });
    if (cancelledEarly || aborted()) {
      await db.cancel().catch(() => {});
      throw new SnapshotRunError("cancelled", "Đã hủy câu đang chạy");
    }

    let statements = 0;
    if (setup !== "") statements += (await db.execute(setup, { signal: options.signal })).length;
    const results = await db.execute(sql, { signal: options.signal });
    statements += results.length;

    const last = results[results.length - 1] ?? { columns: [], rows: [] as unknown[][] };
    const totalRows = last.rows.length;
    const rows = totalRows > MAX_SNAPSHOT_RESULT_ROWS ? last.rows.slice(0, MAX_SNAPSHOT_RESULT_ROWS) : last.rows;
    return {
      kind: "result",
      label: "real",
      statements,
      fields: last.columns,
      rows,
      totalRows,
      truncated: totalRows > rows.length,
      affectedRows: last.affectedRows,
    };
  } catch (e) {
    throw toRunError(e);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    // Phiên chỉ sống trong một lần chạy: dừng worker để không giữ RAM của người xem.
    await db?.dispose().catch(() => {});
  }
}
