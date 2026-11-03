import type { EngineErrorData, LoadProgress, QueryResult } from "@/contracts/engine";

export type WorkerRequest = { id: number; type: "init" } | { id: number; type: "exec"; sql: string };

export type WorkerResponse =
  | { id: number; type: "progress"; progress: LoadProgress }
  | { id: number; type: "done"; results?: QueryResult[] }
  | { id: number; type: "error"; error: EngineErrorData };
