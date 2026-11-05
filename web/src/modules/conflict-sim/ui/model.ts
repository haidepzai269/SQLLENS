import { doubleBooking, SCENARIOS, withIsolation, type DoubleBookingGuard } from "../engine/scenarios";
import { simulate } from "../engine/simulate";
import type { Isolation, ScenarioId, SessionId, SimResult, Tick } from "../engine/types";

export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];
export const ISOLATIONS: Isolation[] = ["read_committed", "repeatable_read", "serializable"];
export const GUARDS: DoubleBookingGuard[] = ["none", "unique", "for_update"];
export const SESSIONS: SessionId[] = ["A", "B"];

export type Cfg = { id: ScenarioId; isolation: Isolation; guard: DoubleBookingGuard };
export const cfgFor = (id: ScenarioId): Cfg => ({ id, isolation: SCENARIOS[id].isolation, guard: "none" });
export const simulateCfg = (c: Cfg): SimResult =>
  simulate(c.id === "double_booking" ? doubleBooking(c.guard, c.isolation) : withIsolation(c.id, c.isolation));

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
