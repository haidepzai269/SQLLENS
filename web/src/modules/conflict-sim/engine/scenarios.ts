import type { Isolation, Scenario, ScenarioId, Step } from "./types";

const LEVEL: Record<Isolation, string> = {
  read_committed: "READ COMMITTED",
  repeatable_read: "REPEATABLE READ",
  serializable: "SERIALIZABLE",
};
const begin = (i: Isolation, session: "A" | "B"): Step => ({ session, sql: `BEGIN ISOLATION LEVEL ${LEVEL[i]}` });
const A = (sql: string): Step => ({ session: "A", sql });
const B = (sql: string): Step => ({ session: "B", sql });

const accounts = (rows: string): string[] => [
  "CREATE TABLE accounts (id int PRIMARY KEY, balance int)",
  `INSERT INTO accounts (id, balance) VALUES ${rows}`,
];
const bal = (id: number) => `SELECT balance FROM accounts WHERE id = ${id}`;

export type DoubleBookingGuard = "none" | "unique" | "for_update";

// The same session runs the same SQL in real Postgres (Task051 compares them).
export function lostUpdate(i: Isolation = "read_committed"): Scenario {
  return {
    id: "lost_update", isolation: i, setup: accounts("(1, 100)"),
    steps: [begin(i, "A"), begin(i, "B"), A(bal(1)), B(bal(1)),
      A("UPDATE accounts SET balance = 110 WHERE id = 1"), B("UPDATE accounts SET balance = 120 WHERE id = 1"),
      A("COMMIT"), B("COMMIT")],
    brokenCheck: { sql: bal(1), brokenWhen: "<> 130" },
  };
}

// Victim is not fixed in real Postgres, so both sessions COMMIT at the end (COMMIT of an aborted transaction rolls back).
export function deadlockReverseOrder(i: Isolation = "read_committed"): Scenario {
  return {
    id: "deadlock_reverse_order", isolation: i, setup: accounts("(1, 100), (2, 100)"),
    steps: [begin(i, "A"), begin(i, "B"),
      A("UPDATE accounts SET balance = balance - 10 WHERE id = 1"), B("UPDATE accounts SET balance = balance - 10 WHERE id = 2"),
      A("UPDATE accounts SET balance = balance + 10 WHERE id = 2"), B("UPDATE accounts SET balance = balance + 10 WHERE id = 1"),
      A("COMMIT"), B("COMMIT")],
    brokenCheck: { sql: bal(1), brokenWhen: "<> 100" },
  };
}

export function writeSkew(i: Isolation = "repeatable_read"): Scenario {
  const count = "SELECT count(*) FROM doctors WHERE on_call = true";
  return {
    id: "write_skew", isolation: i,
    setup: ["CREATE TABLE doctors (id int PRIMARY KEY, on_call boolean)", "INSERT INTO doctors (id, on_call) VALUES (1, true), (2, true)"],
    steps: [begin(i, "A"), begin(i, "B"), A(count), B(count),
      A("UPDATE doctors SET on_call = false WHERE id = 1"), B("UPDATE doctors SET on_call = false WHERE id = 2"),
      A("COMMIT"), B("COMMIT")],
    brokenCheck: { sql: count, brokenWhen: "= 0" },
  };
}

export function doubleBooking(guard: DoubleBookingGuard = "none", i: Isolation = "read_committed"): Scenario {
  const book = (who: string) => `INSERT INTO bookings (slot, who) SELECT 1, '${who}' WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE slot = 1)`;
  const lock = "SELECT 1 FROM rooms WHERE id = 1 FOR UPDATE";
  const count = "SELECT count(*) FROM bookings WHERE slot = 1";
  return {
    id: "double_booking", isolation: i,
    setup: [
      "CREATE TABLE bookings (slot int, who text)", "CREATE TABLE rooms (id int PRIMARY KEY)", "INSERT INTO rooms (id) VALUES (1)",
      ...(guard === "unique" ? ["CREATE UNIQUE INDEX bookings_slot ON bookings (slot)"] : []),
    ],
    steps: guard === "for_update"
      ? [begin(i, "A"), begin(i, "B"), A(lock), B(lock), A(book("A")), A("COMMIT"), B(book("B")), B("COMMIT")]
      : [begin(i, "A"), begin(i, "B"), A(book("A")), B(book("B")), A("COMMIT"), B("COMMIT")],
    brokenCheck: { sql: count, brokenWhen: "> 1" },
  };
}

export function nonRepeatableRead(i: Isolation = "read_committed"): Scenario {
  return {
    id: "non_repeatable_read", isolation: i, setup: accounts("(1, 100)"),
    steps: [begin(i, "A"), begin(i, "B"), A(bal(1)), B("UPDATE accounts SET balance = 200 WHERE id = 1"), B("COMMIT"), A(bal(1)), A("COMMIT")],
    brokenCheck: { sql: bal(1), brokenWhen: "differs_within_tx" },
  };
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  lost_update: lostUpdate(),
  deadlock_reverse_order: deadlockReverseOrder(),
  write_skew: writeSkew(),
  double_booking: doubleBooking(),
  non_repeatable_read: nonRepeatableRead(),
};

// Same script at another isolation level.
export function withIsolation(id: ScenarioId, i: Isolation): Scenario {
  return { lost_update: lostUpdate, deadlock_reverse_order: deadlockReverseOrder, write_skew: writeSkew,
    double_booking: (l: Isolation) => doubleBooking("none", l), non_repeatable_read: nonRepeatableRead }[id](i);
}
