// @vitest-environment node
// Golden test: run every scenario on real Postgres with two connections and compare with simulate().
// Needs T051_DATABASE_URL (localhost only: the test creates and drops a schema). Otherwise skipped.
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { SCENARIOS, doubleBooking, withIsolation } from "../engine/scenarios";
import { simulate } from "../engine/simulate";
import type { Scenario, TimelineOutcome } from "../engine/types";

const URL_ENV = process.env.T051_DATABASE_URL;
const SCHEMA = "t051_golden";
const STEP_TIMEOUT_MS = 5000;
const POLL_MS = 10;

if (URL_ENV) {
  const u = new URL(URL_ENV);
  // pg lets "?host=" override the host, so any query string is refused too.
  if (u.search || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname)) {
    throw new Error("T051_DATABASE_URL must point to localhost without a query string: this test creates and drops tables");
  }
} else {
  console.warn("T051_DATABASE_URL not set: conflict-sim golden test skipped");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Settled = { done: boolean; err?: { code?: string; message: string }; rows?: unknown[][] };
type Real = { waiting: string[]; errors: string[]; outcome: TimelineOutcome; tables: Record<string, unknown[]>; reads: Record<string, string[]> };

async function connect(): Promise<Client> {
  const c = new Client({ connectionString: URL_ENV });
  c.on("error", () => {}); // terminated on purpose in cleanup
  await c.connect();
  await c.query(`SET search_path = ${SCHEMA}`);
  await c.query("SET deadlock_timeout = '500ms'"); // victim is picked after this; both sessions are seen waiting first
  return c;
}

// Same rule as the engine: "<op> <int>" on the first value of the check.
function isBroken(rule: string, value: unknown): boolean {
  const [op, n] = rule.split(" ");
  const v = Number(value), k = Number(n);
  return { "=": v === k, "<>": v !== k, ">": v > k, "<": v < k, ">=": v >= k, "<=": v <= k }[op] ?? (() => { throw new Error(`bad rule ${rule}`); })();
}

async function runReal(sc: Scenario): Promise<Real> {
  const admin = new Client({ connectionString: URL_ENV });
  await admin.connect();
  const clients: Client[] = [];
  const pids: number[] = [];
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.query(`SET search_path = ${SCHEMA}`);
    for (const s of sc.setup) await admin.query(s);
    const conn = { A: await connect(), B: await connect() };
    clients.push(conn.A, conn.B);
    const pid = { A: (await conn.A.query("SELECT pg_backend_pid() AS p")).rows[0].p, B: (await conn.B.query("SELECT pg_backend_pid() AS p")).rows[0].p };
    pids.push(pid.A, pid.B);
    const pending: Record<"A" | "B", Settled | null> = { A: null, B: null };
    const waiting: string[] = [], errors: string[] = [];
    const reads: Record<string, string[]> = { A: [], B: [] };

    const waitDone = async (s: "A" | "B", what: string) => {
      const start = Date.now();
      while (!pending[s]!.done) {
        if (Date.now() - start > STEP_TIMEOUT_MS) throw new Error(`session ${s} still blocked after ${STEP_TIMEOUT_MS}ms (${what})`);
        await sleep(POLL_MS);
      }
      pending[s] = null;
    };

    for (const step of sc.steps) {
      const s = step.session;
      if (pending[s]) await waitDone(s, `before: ${step.sql}`);
      const st: Settled = { done: false };
      pending[s] = st;
      conn[s].query({ text: step.sql, rowMode: "array" }).then(
        (r) => { st.rows = r.rows; if (/^\s*select/i.test(step.sql)) reads[s].push(JSON.stringify(r.rows)); st.done = true; },
        (e) => { st.err = e; errors.push(e.code ?? `NOCODE:${e.message}`); st.done = true; },
      );
      const start = Date.now();
      for (;;) {
        if (st.done) { pending[s] = null; break; }
        if (Date.now() - start > STEP_TIMEOUT_MS) throw new Error(`step blocked past ${STEP_TIMEOUT_MS}ms and no lock wait seen: ${s} ${step.sql}`);
        const b = await admin.query("SELECT cardinality(pg_blocking_pids($1)) > 0 AS b", [pid[s]]);
        if (b.rows[0].b) { waiting.push(`${s}|${step.sql}`); break; }
        await sleep(POLL_MS);
      }
    }
    for (const s of ["A", "B"] as const) if (pending[s]) await waitDone(s, "end of script");

    // Final committed state, read by the admin connection after both sessions finished.
    const tables: Record<string, unknown[]> = {};
    const names = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY 1", [SCHEMA]);
    for (const { tablename } of names.rows) tables[tablename] = (await admin.query(`SELECT * FROM ${tablename}`)).rows;
    const check = (await admin.query({ text: sc.brokenCheck.sql, rowMode: "array" })).rows[0][0];

    let outcome: TimelineOutcome;
    if (errors.includes("40P01")) outcome = "deadlock";
    else if (errors.includes("40001")) outcome = "serialization_failure";
    else if (sc.brokenCheck.brokenWhen === "differs_within_tx") outcome = new Set(reads.A).size > 1 ? "broken" : "not_broken";
    else outcome = isBroken(sc.brokenCheck.brokenWhen, check) ? "broken" : "not_broken";
    return { waiting, errors, outcome, tables, reads };
  } finally {
    // Deadlock victims and stuck sessions: end() on a dead query would hang, so terminate first.
    await admin.query("SELECT pg_terminate_backend(p) FROM unnest($1::int[]) p", [pids]).catch(() => {});
    for (const c of clients) await c.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

const sortRows = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).sort();

const CASES: [string, Scenario][] = [
  ["lost_update read_committed", SCENARIOS.lost_update],
  ["lost_update repeatable_read", withIsolation("lost_update", "repeatable_read")],
  ["deadlock_reverse_order", SCENARIOS.deadlock_reverse_order],
  ["write_skew read_committed", withIsolation("write_skew", "read_committed")],
  ["write_skew repeatable_read", SCENARIOS.write_skew],
  ["write_skew serializable", withIsolation("write_skew", "serializable")],
  ["double_booking none read_committed", SCENARIOS.double_booking],
  ["double_booking unique read_committed", doubleBooking("unique")],
  ["double_booking for_update read_committed", doubleBooking("for_update")],
  ["double_booking for_update repeatable_read", doubleBooking("for_update", "repeatable_read")],
  ["double_booking none serializable", withIsolation("double_booking", "serializable")],
  ["non_repeatable_read read_committed", SCENARIOS.non_repeatable_read],
  ["non_repeatable_read repeatable_read", withIsolation("non_repeatable_read", "repeatable_read")],
];

describe.skipIf(!URL_ENV)("conflict-sim golden: simulate vs real Postgres", () => {
  afterAll(async () => {
    const c = new Client({ connectionString: URL_ENV });
    await c.connect();
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await c.end();
  });

  it.each(CASES)("%s", async (_name, sc) => {
    const sim = simulate(sc);
    if (sim.kind !== "conclusion") throw new Error(`not simulated: ${sim.reasonKey}`);
    const real = await runReal(sc);
    const ticks = sim.data.ticks;
    const simWaiting = ticks.filter((t) => t.status === "waiting").map((t) => `${t.session}|${t.sql}`);
    const simErrors = ticks.filter((t) => t.status === "error").map((t) => t.sqlstate!);

    expect(real.outcome, "outcome").toBe(sim.data.outcome);
    expect(real.waiting, "lock wait order").toEqual(simWaiting);
    if (sim.data.outcome === "deadlock") {
      // Postgres does not fix the victim: only the presence of a deadlock is compared.
      expect(real.errors.filter((e) => e === "40P01")).toHaveLength(1);
    } else {
      expect([...real.errors].sort(), "SQLSTATE of failed statements").toEqual([...simErrors].sort());
      const committed = ticks.at(-1)!.committed;
      for (const [table, rows] of Object.entries(committed)) {
        expect(sortRows(real.tables[table] ?? []), `final rows of ${table}`).toEqual(sortRows(rows));
      }
    }
  }, 60_000);
});
