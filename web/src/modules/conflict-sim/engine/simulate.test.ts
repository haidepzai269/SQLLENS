import { describe, expect, it } from "vitest";
import { SCENARIOS, doubleBooking, withIsolation } from "./scenarios";
import { simulate } from "./simulate";
import type { Isolation, Scenario, ScenarioId } from "./types";

function run(sc: Scenario) {
  const r = simulate(sc);
  if (r.kind !== "conclusion") throw new Error(`not simulated: ${r.reasonKey}`);
  return r;
}
const outcome = (sc: Scenario) => run(sc).data.outcome;
const at = (id: ScenarioId, i: Isolation) => outcome(withIsolation(id, i));

describe("conflict-sim engine", () => {
  it("AC1 lost_update", () => {
    expect(at("lost_update", "read_committed")).toBe("broken");
    const r = run(withIsolation("lost_update", "repeatable_read"));
    expect(r.data.outcome).toBe("serialization_failure");
    expect(r.data.ticks.some((t) => t.status === "error" && t.sqlstate === "40001")).toBe(true);
  });

  it("AC2 deadlock: both wait, first waiter is the victim", () => {
    const r = run(SCENARIOS.deadlock_reverse_order);
    expect(r.data.outcome).toBe("deadlock");
    const waiting = r.data.ticks.filter((t) => t.status === "waiting").map((t) => t.session);
    expect(waiting).toEqual(["A", "B"]);
    const dead = r.data.ticks.find((t) => t.sqlstate === "40P01")!;
    expect(dead.session).toBe("A");
    expect(r.data.ticks.at(-1)!.committed.accounts).toEqual([{ id: 1, balance: 110 }, { id: 2, balance: 90 }]);
  });

  it("AC3 write_skew", () => {
    expect(at("write_skew", "read_committed")).toBe("broken");
    expect(at("write_skew", "repeatable_read")).toBe("broken");
    expect(at("write_skew", "serializable")).toBe("serialization_failure");
  });

  it("AC4 double_booking", () => {
    expect(outcome(SCENARIOS.double_booking)).toBe("broken");
    expect(outcome(doubleBooking("unique"))).toBe("not_broken");
    expect(outcome(doubleBooking("for_update"))).toBe("not_broken");
    expect(run(doubleBooking("unique")).data.ticks.some((t) => t.sqlstate === "23505")).toBe(true);
    // snapshot taken before the wait: the lock alone does not help at repeatable read
    expect(outcome(doubleBooking("for_update", "repeatable_read"))).toBe("broken");
    expect(outcome(doubleBooking("none", "serializable"))).toBe("serialization_failure");
  });

  it("AC5 non_repeatable_read", () => {
    expect(at("non_repeatable_read", "read_committed")).toBe("broken");
    expect(at("non_repeatable_read", "repeatable_read")).toBe("not_broken");
    expect(at("non_repeatable_read", "serializable")).toBe("not_broken");
  });

  it("AC6 every tick carries its full state; AC7 label", () => {
    const r = run(SCENARIOS.lost_update);
    expect(r.label).toBe("simulated");
    const w = r.data.ticks.find((t) => t.status === "waiting")!;
    expect(w.waiting).toEqual([{ session: "B", resource: "row:accounts:1", holder: "A" }]);
    expect(w.heldLocks).toEqual([{ session: "A", resource: "row:accounts:1" }]);
    expect(w.committed.accounts).toEqual([{ id: 1, balance: 100 }]);
    expect(w.snapshot.accounts).toEqual([{ id: 1, balance: 100 }]);
    const res = r.data.ticks.find((t) => t.status === "resumed")!;
    expect(res.session).toBe("B");
    expect(res.snapshot.accounts).toEqual([{ id: 1, balance: 120 }]);
    expect(r.data.ticks.map((t) => t.index)).toEqual(r.data.ticks.map((_, i) => i));
  });

  it("is deterministic", () => {
    expect(JSON.stringify(simulate(SCENARIOS.write_skew))).toBe(JSON.stringify(simulate(SCENARIOS.write_skew)));
  });

  it("edge cases return NotSimulated", () => {
    const base = SCENARIOS.lost_update;
    const ns = (sc: Scenario) => expect(simulate(sc)).toMatchObject({ kind: "not_simulated" });
    ns({ ...base, steps: [] });
    ns({ ...base, steps: [{ session: "C" as "A", sql: "BEGIN" }] });
    ns({ ...base, steps: [{ session: "A", sql: "DELETE FROM accounts WHERE id = 1" }] });
    ns({ ...withIsolation("lost_update", "serializable"), steps: [{ session: "A", sql: "BEGIN" }] }); // plain BEGIN is read committed
    ns({ ...base, steps: [{ session: "A", sql: "SELECT balance FROM accounts WHERE id = 1" }] }); // no transaction
    ns({ ...base, brokenCheck: { sql: base.brokenCheck.sql, brokenWhen: "maybe" } });
    ns({ ...base, steps: base.steps.slice(0, 6) }); // B left waiting: stuck
  });
});

describe("out-of-model input is never guessed", () => {
  const base = SCENARIOS.lost_update;
  const ns = (sc: Scenario) => expect(simulate(sc)).toMatchObject({ kind: "not_simulated" });
  const only = (sql: string) => ({ ...base, steps: [base.steps[0], { session: "A" as const, sql }] });
  it("unknown column, table and NOT NULL", () => {
    ns(only("UPDATE accounts SET balance = 1 WHERE idd = 1"));
    ns(only("SELECT balance FROM accounts WHERE idd IS NULL"));
    ns({ ...base, brokenCheck: { sql: "SELECT count(*) FROM nope", brokenWhen: "= 0" } });
    ns({ ...base, brokenCheck: { sql: "SELECT count(*) FROM accounts WHERE x = 1", brokenWhen: "= 0" } });
    ns(only("INSERT INTO accounts (balance) VALUES (5)"));
  });
});

it("table-level PRIMARY KEY implies NOT NULL", () => {
  const sc = { ...SCENARIOS.lost_update, setup: ["CREATE TABLE accounts (id int, balance int, PRIMARY KEY (id))", "INSERT INTO accounts (id, balance) VALUES (1, 100)"] };
  expect(simulate(sc).kind).toBe("conclusion");
  expect(simulate({ ...sc, steps: [sc.steps[0], { session: "A", sql: "INSERT INTO accounts (balance) VALUES (5)" }] }).kind).toBe("not_simulated");
});
