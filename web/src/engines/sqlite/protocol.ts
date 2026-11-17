import type { EngineErrorData, LoadProgress, QueryResult } from "@/contracts/engine";

// Chỉ có ba việc: nạp, chạy SQL, và báo tiến trình nạp. Plan/B-Tree của SQLite không mô phỏng được
// (xem adapter.explain/readBTree) nên không có message riêng cho chúng.
export type SqliteWorkerRequest = { id: number; type: "init" } | { id: number; type: "exec"; sql: string };

export type SqliteWorkerResponse =
  | { id: number; type: "progress"; progress: LoadProgress }
  | { id: number; type: "done"; results?: QueryResult[] }
  | { id: number; type: "error"; error: EngineErrorData };
