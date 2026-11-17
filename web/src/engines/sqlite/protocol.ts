import type { EngineErrorData, LoadProgress, QueryResult } from "@/contracts/engine";

// Bốn việc: nạp WASM, chạy SQL, nạp file database của người dùng, đọc toàn bộ database ra byte.
// Plan/B-Tree của SQLite không mô phỏng được (xem adapter.explain/readBTree) nên không có message riêng.
export type SqliteFileSource = { bytes?: Uint8Array; file?: File };

export type SqliteWorkerRequest =
  | { id: number; type: "init" }
  | { id: number; type: "exec"; sql: string }
  | { id: number; type: "load"; source: SqliteFileSource }
  | { id: number; type: "export" };

export type SqliteWorkerResponse =
  | { id: number; type: "progress"; progress: LoadProgress }
  | { id: number; type: "done"; results?: QueryResult[]; bytes?: Uint8Array }
  | { id: number; type: "error"; error: EngineErrorData };
