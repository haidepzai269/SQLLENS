import type { BTreeRead } from "./btree-read";
import type { Outcome } from "@/contracts/conclusion";
import type { EngineErrorData, LoadProgress, QueryResult, TryChangeResult } from "@/contracts/engine";

export type WorkerRequest = { id: number; type: "init" } | { id: number; type: "exec"; sql: string }
  | { id: number; type: "try"; change: string; probe: string }
  | { id: number; type: "btree"; index: string; probeKey?: string; maxNodes?: number };

export type WorkerResponse =
  | { id: number; type: "progress"; progress: LoadProgress }
  | { id: number; type: "done"; guardActive?: boolean; results?: QueryResult[]; tried?: Outcome<TryChangeResult>; btree?: BTreeRead }
  | { id: number; type: "error"; error: EngineErrorData };
