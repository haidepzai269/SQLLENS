import type { Outcome } from "./conclusion";

export type EngineId = "postgres" | "mysql";
export type QueryResult = { columns: string[]; rows: unknown[][]; affectedRows?: number };
export interface EngineAdapter {
  readonly engine: EngineId;
  execute(sql: string, options?: { signal?: AbortSignal }): Promise<QueryResult[]>;
  explain(sql: string, options?: { signal?: AbortSignal }): Promise<Outcome<unknown>>;
  dispose(): Promise<void>;
}
