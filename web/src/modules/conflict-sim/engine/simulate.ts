import type { Conclusion, NotSimulated } from "@/contracts/conclusion";
import { type Cond, type Stmt, matches, normalize, parseSql } from "./parse";
import type {
  Isolation, LockInfo, Row, Scenario, SessionId, SimResult, Tables, Tick, TickStatus, TimelineOutcome, TxState, Val, WaitInfo,
} from "./types";

/*
 * Two-session lock and snapshot model of PostgreSQL, enough for the five scenarios (no general SQL engine).
 * Scripted clients: a step of a blocked session is queued until it resumes; other sessions keep going.
 *
 * Contract on deadlocks: PostgreSQL checks for a cycle only after deadlock_timeout (1 s), in the backend
 * that has waited longest, assuming the second session starts waiting within that second.
 * The model therefore aborts the session that started waiting FIRST (40P01).
 * A real server may pick the other one; only "a deadlock happened" is comparable with real Postgres.
 * Serialization failures under SERIALIZABLE are modelled for two-transaction cycles only (mutual rw-conflict,
 * the second committer fails); anything else is out of model.
 */
type VRow = { rid: number; ver: number; vals: Row };
type Tx = {
  id: number; session: SessionId; level: Isolation; status: "active" | "aborted" | "committed";
  snap: Map<string, VRow[]> | null; snapSeq: number; commitSeq: number;
  upd: Map<number, { table: string; vals: Row }>; ins: { table: string; row: VRow }[];
  locks: Set<string>; reads: { table: string; where: Cond[] }[]; writes: { table: string; row: Row }[];
};
type Pending = { sql: string; stmt: Stmt; resource: string; holder: SessionId; since: number };
type Res =
  | { t: "ok"; key: string; values?: Record<string, string | number>; result?: Val[][] }
  | { t: "blocked"; resource: string; holder: SessionId }
  | { t: "error"; sqlstate: string; key: string; values?: Record<string, string | number> };

class NotSim extends Error {}
const notSim = (why: string) => new NotSim(`conflictSim.notSimulated.${why}`);
const IDS: SessionId[] = ["A", "B"];
const ok = (key: string, values?: Record<string, string | number>, result?: Val[][]): Res => ({ t: "ok", key: `conflictSim.tick.${key}`, values, result });
const err = (sqlstate: string, key: string): Res => ({ t: "error", sqlstate, key: `conflictSim.error.${key}` });

export function simulate(sc: Scenario): SimResult {
  try {
    return run(sc);
  } catch (e) {
    if (e instanceof NotSim) return { kind: "not_simulated", reasonKey: e.message } satisfies NotSimulated;
    throw e;
  }
}

function run(sc: Scenario): SimResult {
  if (!sc.steps.length) throw notSim("emptyScenario");
  const steps = sc.steps.map((s) => {
    if (!IDS.includes(s.session)) throw notSim("unknownSession");
    const stmt = parseSql(s.sql);
    if (!stmt) throw notSim("unsupportedSql");
    return { session: s.session, sql: s.sql, stmt };
  });
  const setup = sc.setup.map((q) => parseSql(q) ?? (() => { throw notSim("unsupportedSql"); })());
  const check = parseSql(sc.brokenCheck.sql);
  const differs = sc.brokenCheck.brokenWhen === "differs_within_tx";
  const when = /^(=|<>|>=|<=|>|<) ?(-?\d+)$/.exec(sc.brokenCheck.brokenWhen.trim());
  if (check?.k !== "select" || (!differs && !when)) throw notSim("unsupportedSql");

  const meta = new Map<string, { cols: string[]; unique: string[][]; notNull: string[] }>();
  const committed = new Map<string, VRow[]>();
  const lockTable = new Map<string, SessionId>();
  const txs: Tx[] = [];
  const cur: Record<SessionId, Tx | null> = { A: null, B: null };
  const pend: Record<SessionId, Pending | null> = { A: null, B: null };
  const queue: Record<SessionId, typeof steps> = { A: [], B: [] };
  const ticks: Tick[] = [];
  const selLog: { tx: number; sql: string; result: string }[] = [];
  let seq = 0, ridSeq = 0;

  const table = (t: string) => meta.get(t) ?? (() => { throw notSim("unknownTable"); })();
  const knownCols = (t: string, where: Cond[]) => { const m = table(t); if (where.some((c) => !m.cols.includes(c.col))) throw notSim("unknownColumn"); };
  const clone = <T,>(x: T): T => structuredClone(x);
  const holderOf = (res: string, me: SessionId) => { const h = lockTable.get(res); return h && h !== me ? h : null; };

  // Rows a transaction sees: committed (RC: latest) or its snapshot, plus its own writes.
  function view(tx: Tx | null, t: string): VRow[] {
    const base = (!tx || tx.level === "read_committed" ? committed.get(t) : tx.snap?.get(t)) ?? [];
    if (!tx) return base;
    return base.map((r) => (tx.upd.has(r.rid) ? { ...r, vals: tx.upd.get(r.rid)!.vals } : r)).concat(tx.ins.filter((i) => i.table === t).map((i) => i.row));
  }
  const plain = (rows: VRow[]) => rows.map((r) => ({ ...r.vals }));
  const tablesOf = (tx: Tx | null): Tables => Object.fromEntries([...meta.keys()].map((t) => [t, plain(view(tx, t))]));

  function emit(session: SessionId, sql: string, status: TickStatus, messageKey: string, x: Partial<Tick> = {}) {
    const tx = cur[session];
    ticks.push({
      index: ticks.length, session, sql, status,
      heldLocks: [...lockTable].map(([resource, s]): LockInfo => ({ session: s, resource })),
      waiting: IDS.flatMap((s): WaitInfo[] => (pend[s] ? [{ session: s, resource: pend[s]!.resource, holder: pend[s]!.holder }] : [])),
      snapshot: tablesOf(tx), committed: tablesOf(null),
      txState: Object.fromEntries(IDS.map((s) => [s, (cur[s] ? (cur[s]!.status === "aborted" ? "aborted" : "active") : "idle") as TxState])) as Record<SessionId, TxState>,
      messageKey, ...x,
    });
  }

  function abort(tx: Tx) {
    for (const r of tx.locks) lockTable.delete(r);
    tx.locks.clear(); tx.upd.clear(); tx.ins = []; tx.status = "aborted";
  }

  // Waits on a lock held by another session, or fails when a repeatable-read snapshot is stale.
  function lockRows(tx: Tx, t: string, rows: VRow[]): Res | null {
    const mine = new Set(tx.ins.map((i) => i.row.rid));
    const todo = rows.filter((r) => !mine.has(r.rid));
    for (const r of todo) {
      const res = `row:${t}:${r.rid}`;
      const h = holderOf(res, tx.session);
      if (h) return { t: "blocked", resource: res, holder: h };
      const latest = committed.get(t)!.find((c) => c.rid === r.rid)!;
      if (tx.level !== "read_committed" && !tx.upd.has(r.rid) && latest.ver !== r.ver) return err("40001", "serializeConcurrent");
    }
    for (const r of todo) { const res = `row:${t}:${r.rid}`; tx.locks.add(res); lockTable.set(res, tx.session); }
    return null;
  }

  const conflicts = (reads: Tx["reads"], writes: Tx["writes"]) =>
    reads.some((r) => writes.some((w) => w.table === r.table && matches(w.row, r.where)));

  function exec(s: SessionId, stmt: Stmt, skipGuard = false): Res {
    let tx = cur[s];
    if (stmt.k === "begin") {
      if (tx) throw notSim("nestedBegin");
      const level = stmt.level ?? "read_committed";
      if (level !== sc.isolation) throw notSim("isolationMismatch");
      tx = { id: txs.length, session: s, level, status: "active", snap: null, snapSeq: 0, commitSeq: 0, upd: new Map(), ins: [], locks: new Set(), reads: [], writes: [] };
      txs.push(tx); cur[s] = tx;
      return ok("begin", { isolation: level });
    }
    if (!tx) throw notSim("noTransaction");
    if (stmt.k === "create" || stmt.k === "index") throw notSim("ddlInTransaction");
    if (tx.status === "aborted") {
      if (stmt.k === "commit" || stmt.k === "rollback") { cur[s] = null; return ok("rollbackOfAborted"); }
      return err("25P02", "abortedTransaction");
    }
    if (stmt.k === "rollback") { abort(tx); cur[s] = null; return ok("rollback"); }
    const fail = (r: Res) => { if (r.t === "error") abort(tx!); return r; };

    if (stmt.k === "commit") {
      if (tx.level === "serializable") {
        for (const u of txs) {
          if (u === tx || u.status === "aborted" || u.level !== "serializable" || !u.snap) continue;
          const overlap = u.status !== "committed" || u.commitSeq > tx.snapSeq;
          if (overlap && u.status === "committed" && conflicts(tx.reads, u.writes) && conflicts(u.reads, tx.writes))
            return fail(err("40001", "serializeDependencies"));
        }
      }
      for (const [rid, w] of tx.upd) { const row = committed.get(w.table)!.find((c) => c.rid === rid)!; row.vals = w.vals; row.ver++; }
      for (const i of tx.ins) committed.get(i.table)!.push({ ...i.row });
      for (const r of tx.locks) lockTable.delete(r);
      tx.locks.clear(); tx.status = "committed"; tx.commitSeq = ++seq; cur[s] = null;
      return ok("commit");
    }

    if (tx.level !== "read_committed" && !tx.snap) { tx.snap = clone(committed); tx.snapSeq = seq; }
    const ser = tx.level === "serializable";
    const m = table(stmt.table);
    if (stmt.k !== "insert") knownCols(stmt.table, stmt.where);

    if (stmt.k === "select") {
      const rows = view(tx, stmt.table).filter((r) => matches(r.vals, stmt.where));
      if (stmt.forUpdate) { const b = lockRows(tx, stmt.table, rows); if (b) return fail(b); }
      if (ser) tx.reads.push({ table: stmt.table, where: stmt.where });
      if (Array.isArray(stmt.proj) && stmt.proj.some((c) => !m.cols.includes(c))) throw notSim("unknownColumn");
      const result: Val[][] = stmt.proj === "count" ? [[rows.length]] : stmt.proj === "one" ? rows.map(() => [1])
        : rows.map((r) => (stmt.proj === "*" ? m.cols : stmt.proj as string[]).map((c) => r.vals[c] ?? null));
      return ok("select", { rows: result.length }, result);
    }

    if (stmt.k === "update") {
      if (stmt.set.some((e) => m.cols.indexOf(e.col) < 0)) throw notSim("unknownColumn");
      if (stmt.set.some((e) => m.unique.some((u) => u.includes(e.col)))) throw notSim("updateUniqueColumn");
      const rows = view(tx, stmt.table).filter((r) => matches(r.vals, stmt.where));
      if (ser) tx.reads.push({ table: stmt.table, where: stmt.where });
      const b = lockRows(tx, stmt.table, rows);
      if (b) return fail(b);
      for (const r of rows) {
        const next: Row = { ...r.vals };
        for (const e of stmt.set) {
          if (e.delta === undefined) next[e.col] = e.val ?? null;
          else if (typeof next[e.col] === "number") next[e.col] = (next[e.col] as number) + e.delta;
          else throw notSim("arithmeticOnNonNumber");
        }
        const own = tx.ins.find((i) => i.row.rid === r.rid);
        if (own) own.row = { ...own.row, vals: next }; else tx.upd.set(r.rid, { table: stmt.table, vals: next });
        tx.writes.push({ table: stmt.table, row: r.vals }, { table: stmt.table, row: next });
      }
      return ok("update", { rows: rows.length });
    }

    // insert
    if (stmt.cols.some((c) => !m.cols.includes(c))) throw notSim("unknownColumn");
    // a retry after a unique-key wait keeps the guard result of the original statement snapshot
    if (stmt.notExists && !skipGuard) {
      knownCols(stmt.notExists.table, stmt.notExists.where);
      if (ser) tx.reads.push(stmt.notExists);
      if (view(tx, stmt.notExists.table).some((r) => matches(r.vals, stmt.notExists!.where))) return ok("insert", { rows: 0 });
    }
    const pending: { row: Row; keys: string[] }[] = [];
    for (const tuple of stmt.rows) {
      const row: Row = Object.fromEntries(m.cols.map((c) => [c, stmt.cols.includes(c) ? tuple[stmt.cols.indexOf(c)] : null]));
      if (m.notNull.some((c) => row[c] === null)) throw notSim("notNullViolation");
      const keys: string[] = [];
      for (const u of m.unique) {
        const kv = u.map((c) => row[c]);
        if (kv.includes(null)) continue;
        const res = `uk:${stmt.table}:${u.join(",")}:${JSON.stringify(kv)}`;
        const h = holderOf(res, s);
        if (h) return { t: "blocked", resource: res, holder: h };
        const dup = [...committed.get(stmt.table)!, ...tx.ins.filter((i) => i.table === stmt.table).map((i) => i.row)]
          .some((r) => u.every((c) => r.vals[c] === row[c]));
        // Postgres may report 40001 instead of 23505 here after a read; not modelled.
        if (dup) { if (ser && tx.reads.length) throw notSim("uniqueInSerializable"); return fail(err("23505", "uniqueViolation")); }
        keys.push(res);
      }
      pending.push({ row, keys });
    }
    for (const p of pending) {
      const row = { rid: ++ridSeq, ver: 0, vals: p.row };
      tx.ins.push({ table: stmt.table, row });
      tx.writes.push({ table: stmt.table, row: p.row });
      for (const k of p.keys) { tx.locks.add(k); lockTable.set(k, s); }
    }
    return ok("insert", { rows: pending.length });
  }

  function step(s: SessionId, sql: string, stmt: Stmt, again: boolean, skipGuard = false) {
    const r = exec(s, stmt, skipGuard);
    if (r.t === "blocked") {
      pend[s] = { sql, stmt, resource: r.resource, holder: r.holder, since: ticks.length };
      emit(s, sql, "waiting", "conflictSim.tick.waiting", { values: { resource: r.resource, holder: r.holder } });
    } else if (r.t === "error") emit(s, sql, "error", r.key, { sqlstate: r.sqlstate, values: r.values });
    else {
      if (r.result && cur[s]) selLog.push({ tx: cur[s]!.id, sql: normalize(sql), result: JSON.stringify(r.result) });
      emit(s, sql, again ? "resumed" : "ran", r.key, { values: r.values, ...(r.result ? { result: r.result } : {}) });
    }
  }

  function deadlockVictim(): SessionId | null {
    for (const start of IDS) {
      const path: SessionId[] = [start];
      let c: SessionId = start;
      for (;;) {
        const p = pend[c];
        if (!p) break;
        c = p.holder;
        if (c === start) return path.reduce((a, b) => (pend[a]!.since <= pend[b]!.since ? a : b));
        if (path.includes(c)) break;
        path.push(c);
      }
    }
    return null;
  }

  function settle() {
    for (let guard = 0; guard < 1000; guard++) {
      let progressed = false;
      for (const s of IDS) {
        const p = pend[s];
        if (p && !holderOf(p.resource, s)) { pend[s] = null; step(s, p.sql, p.stmt, true, p.resource.startsWith("uk:")); progressed = true; }
        if (!pend[s] && queue[s].length) { const q = queue[s].shift()!; step(s, q.sql, q.stmt, false); progressed = true; }
      }
      if (progressed) continue;
      const v = deadlockVictim();
      if (!v) return;
      const p = pend[v]!;
      pend[v] = null;
      abort(cur[v]!);
      emit(v, p.sql, "error", "conflictSim.error.deadlock", { sqlstate: "40P01" });
    }
    throw notSim("noProgress");
  }

  // Setup writes straight to the committed state.
  for (const st of setup) {
    if (st.k === "create") { meta.set(st.table, { cols: st.cols, unique: st.unique, notNull: st.notNull }); committed.set(st.table, []); }
    else if (st.k === "index") table(st.table).unique.push(st.cols);
    else if (st.k === "insert" && !st.notExists) {
      const m = table(st.table);
      for (const t of st.rows) {
        const row: Row = Object.fromEntries(m.cols.map((c) => [c, st.cols.includes(c) ? t[st.cols.indexOf(c)] : null]));
        if (m.notNull.some((c) => row[c] === null)) throw notSim("notNullViolation");
        if (m.unique.some((u) => committed.get(st.table)!.some((r) => u.every((c) => r.vals[c] === row[c])))) throw notSim("unsupportedSql");
        committed.get(st.table)!.push({ rid: ++ridSeq, ver: 0, vals: row });
      }
    } else throw notSim("unsupportedSql");
  }

  knownCols(check.table, check.where);
  for (const st of steps) {
    if (pend[st.session] || queue[st.session].length) queue[st.session].push(st);
    else step(st.session, st.sql, st.stmt, false);
    settle();
  }
  if (IDS.some((s) => pend[s] || queue[s].length)) throw notSim("stuckSession");

  let outcome: TimelineOutcome;
  let observed: string | number = "";
  if (ticks.some((t) => t.sqlstate === "40P01")) outcome = "deadlock";
  else if (ticks.some((t) => t.sqlstate === "40001")) outcome = "serialization_failure";
  else if (differs) {
    const key = normalize(sc.brokenCheck.sql);
    const byTx = new Map<number, Set<string>>();
    for (const l of selLog) if (l.sql === key) byTx.set(l.tx, (byTx.get(l.tx) ?? new Set()).add(l.result));
    outcome = [...byTx.values()].some((r) => r.size > 1) ? "broken" : "not_broken";
  } else {
    const rows = view(null, check.table).filter((r) => matches(r.vals, check.where));
    const v = check.proj === "count" ? rows.length : rows[0]?.vals[Array.isArray(check.proj) ? check.proj[0] : ""] ?? null;
    if (typeof v !== "number") throw notSim("checkNotNumeric");
    observed = v;
    const n = Number(when![2]);
    outcome = cmpNum(v, when![1], n) ? "broken" : "not_broken";
  }

  const conclusion: Conclusion<{ ticks: Tick[]; outcome: TimelineOutcome }> = {
    kind: "conclusion", label: "simulated", data: { ticks, outcome },
    evidence: [{ kind: "conflict_sim", messageKey: `conflictSim.outcome.${outcome}`, values: { scenario: sc.id, isolation: sc.isolation, observed } }],
  };
  return conclusion;
}

function cmpNum(a: number, op: string, b: number) {
  return op === "=" ? a === b : op === "<>" ? a !== b : op === ">" ? a > b : op === "<" ? a < b : op === ">=" ? a >= b : a <= b;
}
