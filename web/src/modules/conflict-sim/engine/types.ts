import type { Outcome } from "@/contracts/conclusion";

export type SessionId = "A" | "B";
export type Isolation = "read_committed" | "repeatable_read" | "serializable";
export type ScenarioId =
  | "lost_update"
  | "deadlock_reverse_order"
  | "write_skew"
  | "double_booking"
  | "non_repeatable_read";

export type Step = { session: SessionId; sql: string };

export type BrokenCheck = {
  sql: string;
  brokenWhen: string;
};

// brokenWhen: "<op> <int>" (op: = <> > < >= <=) tested against the first value of
// brokenCheck.sql on the final committed state, or "differs_within_tx": the same
// SELECT, run twice inside one transaction, returned different results.
export type Scenario = {
  id: string;
  isolation: Isolation;
  setup: string[];
  steps: Step[];
  brokenCheck?: BrokenCheck | null;
};

export type Val = number | string | boolean | null;
export type Row = Record<string, Val>;
export type Tables = Record<string, Row[]>;

export type TickStatus = "ran" | "waiting" | "resumed" | "error";
export type TxState = "idle" | "active" | "aborted";
export type LockInfo = { session: SessionId; resource: string };
export type WaitInfo = { session: SessionId; resource: string; holder: SessionId };

// Every tick carries the whole picture at that moment, so rewinding is a lookup.
export type Tick = {
  index: number;
  session: SessionId;
  sql: string;
  status: TickStatus;
  heldLocks: LockInfo[];
  waiting: WaitInfo[];
  snapshot: Tables; // what `session` sees after this tick
  committed: Tables;
  txState: Record<SessionId, TxState>;
  result?: Val[][]; // rows returned by a SELECT
  sqlstate?: string;
  messageKey: string;
  values?: Record<string, string | number>;
};

export type TimelineOutcome =
  | "broken"
  | "not_broken"
  | "deadlock"
  | "serialization_failure"
  | "no_criteria";
export type Timeline = { ticks: Tick[]; outcome: TimelineOutcome };
export type SimResult = Outcome<Timeline>;
