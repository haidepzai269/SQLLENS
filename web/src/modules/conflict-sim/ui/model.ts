import { doubleBooking, SCENARIOS, withIsolation, type DoubleBookingGuard } from "../engine/scenarios";
import { simulate } from "../engine/simulate";
import type { Isolation, ScenarioId, SessionId, SimResult, Tick } from "../engine/types";

export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];
export const ISOLATIONS: Isolation[] = ["read_committed", "repeatable_read", "serializable"];
export const GUARDS: DoubleBookingGuard[] = ["none", "unique", "for_update"];
export const SESSIONS: SessionId[] = ["A", "B"];

export type BrokenOp = "=" | "<>" | ">" | "<" | ">=" | "<=";
export const BROKEN_OPS: BrokenOp[] = ["=", "<>", ">", "<", ">=", "<="];

export type CustomCheck = {
  enabled: boolean;
  sql: string;
  op: BrokenOp;
  target: number;
  differsWithinTx?: boolean;
};

export type Cfg = {
  id: ScenarioId;
  isolation: Isolation;
  guard: DoubleBookingGuard;
  customCheck?: CustomCheck | null;
};

export function defaultCheckFor(id: ScenarioId): CustomCheck {
  switch (id) {
    case "lost_update":
      return { enabled: true, sql: "SELECT balance FROM accounts WHERE id = 1", op: "<>", target: 130 };
    case "deadlock_reverse_order":
      return { enabled: true, sql: "SELECT balance FROM accounts WHERE id = 1", op: "<>", target: 100 };
    case "write_skew":
      return { enabled: true, sql: "SELECT count(*) FROM doctors WHERE on_call = true", op: "=", target: 0 };
    case "double_booking":
      return { enabled: true, sql: "SELECT count(*) FROM bookings WHERE slot = 1", op: ">", target: 1 };
    case "non_repeatable_read":
      return { enabled: true, sql: "SELECT balance FROM accounts WHERE id = 1", op: "<>", target: 100, differsWithinTx: true };
  }
}

export const cfgFor = (id: ScenarioId): Cfg => ({
  id,
  isolation: SCENARIOS[id].isolation,
  guard: "none",
  customCheck: defaultCheckFor(id),
});

export const simulateCfg = (c: Cfg): SimResult => {
  const base = c.id === "double_booking" ? doubleBooking(c.guard, c.isolation) : withIsolation(c.id, c.isolation);
  let brokenCheck = base.brokenCheck ?? null;
  if (c.customCheck !== undefined) {
    if (!c.customCheck || !c.customCheck.enabled) {
      brokenCheck = null;
    } else if (c.customCheck.differsWithinTx) {
      brokenCheck = { sql: c.customCheck.sql, brokenWhen: "differs_within_tx" };
    } else {
      brokenCheck = { sql: c.customCheck.sql, brokenWhen: `${c.customCheck.op} ${c.customCheck.target}` };
    }
  }
  return simulate({ ...base, brokenCheck });
};

// `p` ticks have happened; p = 0 is before the first one.
export const current = (ticks: Tick[], p: number): Tick | null => ticks[p - 1] ?? null;
export const lastOf = (ticks: Tick[], p: number, s: SessionId): Tick | undefined => ticks.slice(0, p).findLast((t) => t.session === s);

export type SessionState = "idle" | "running" | "waiting" | "aborted" | "committed" | "rolledBack";
export function sessionState(ticks: Tick[], p: number, s: SessionId): SessionState {
  const now = current(ticks, p);
  if (!now) return "idle";
  if (now.waiting.some((w) => w.session === s)) return "waiting";
  if (now.txState[s] === "aborted") return "aborted";
  if (now.txState[s] === "active") return "running";
  const key = lastOf(ticks, p, s)?.messageKey ?? "";
  return key.endsWith(".commit") ? "committed" : key.includes(".rollback") ? "rolledBack" : "idle";
}

// Edges of the wait graph at tick p. A cycle exists when every edge's holder also waits.
export function waitEdges(ticks: Tick[], p: number) {
  const w = current(ticks, p)?.waiting ?? [];
  return { edges: w, cycle: w.length > 1 && w.every((e) => w.some((o) => o.session === e.holder)) };
}
