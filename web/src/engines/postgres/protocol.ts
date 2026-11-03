import type { Outcome } from "@/contracts/conclusion";
import type { EngineErrorData, LoadProgress, QueryResult, TryChangeResult } from "@/contracts/engine";

export type WorkerRequest = { id: number; type: "init" } | { id: number; type: "exec"; sql: string }
  | { id: number; type: "try"; change: string; probe: string };

export type WorkerResponse =
  | { id: number; type: "progress"; progress: LoadProgress }
  | { id: number; type: "done"; results?: QueryResult[]; tried?: Outcome<TryChangeResult> }
  | { id: number; type: "error"; error: EngineErrorData };
