import type { Isolation, Row, Val } from "./types";

// Parser for the tiny SQL subset the five scenarios need. Anything else returns null,
// which simulate() reports as NotSimulated (never guessed).
export type Op = "=" | "<>" | ">" | "<" | ">=" | "<=";
export type Cond = { col: string; op: Op | "is_null" | "not_null"; val: Val };
export type SetExpr = { col: string; delta?: number; val?: Val };
export type Stmt =
  | { k: "begin"; level: Isolation | null }
  | { k: "commit" }
  | { k: "rollback" }
  | { k: "create"; table: string; cols: string[]; unique: string[][]; notNull: string[] }
  | { k: "index"; table: string; cols: string[] }
  | { k: "insert"; table: string; cols: string[]; rows: Val[][]; notExists?: { table: string; where: Cond[] } }
  | { k: "update"; table: string; set: SetExpr[]; where: Cond[] }
  | { k: "select"; table: string; proj: "count" | "*" | "one" | string[]; where: Cond[]; forUpdate: boolean };

const ID = "[a-z_][a-z0-9_]*";
const LEVELS: Record<string, Isolation> = {
  "read committed": "read_committed",
  "repeatable read": "repeatable_read",
  serializable: "serializable",
};

export const normalize = (sql: string) => sql.trim().replace(/;+$/, "").trim().replace(/\s+/g, " ");

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = false, cur = "";
  for (const ch of s) {
    if (ch === "'") quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === ",") { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function lit(s: string): { v: Val } | null {
  s = s.trim();
  if (/^-?\d+$/.test(s)) return { v: Number(s) };
  const q = /^'((?:[^']|'')*)'$/.exec(s);
  if (q) return { v: q[1].replace(/''/g, "'") };
  if (/^true$/i.test(s)) return { v: true };
  if (/^false$/i.test(s)) return { v: false };
  if (/^null$/i.test(s)) return { v: null };
  return null;
}

function parseWhere(s: string): Cond[] | null {
  const conds: Cond[] = [];
  for (const part of s.split(/\s+and\s+/i)) {
    const isNull = new RegExp(`^(${ID}) is (not )?null$`, "i").exec(part);
    if (isNull) { conds.push({ col: isNull[1].toLowerCase(), op: isNull[2] ? "not_null" : "is_null", val: null }); continue; }
    const m = new RegExp(`^(${ID}) ?(=|<>|!=|>=|<=|>|<) ?(.+)$`, "i").exec(part);
    const v = m && lit(m[3]);
    if (!m || !v) return null;
    conds.push({ col: m[1].toLowerCase(), op: (m[2] === "!=" ? "<>" : m[2]) as Op, val: v.v });
  }
  return conds;
}

const cmp = (a: number | string | boolean, op: Op, b: number | string | boolean) =>
  op === "=" ? a === b : op === "<>" ? a !== b : op === ">" ? a > b : op === "<" ? a < b : op === ">=" ? a >= b : a <= b;

// SQL three-valued logic: a comparison with NULL is never true.
export function matches(row: Row, where: Cond[]): boolean {
  return where.every((c) => {
    const v = row[c.col] ?? null;
    if (c.op === "is_null") return v === null;
    if (c.op === "not_null") return v !== null;
    return v !== null && c.val !== null && cmp(v, c.op, c.val);
  });
}

function parseCreate(table: string, body: string): Stmt | null {
  const cols: string[] = [];
  const unique: string[][] = [];
  const notNull: string[] = [];
  for (const part of splitTop(body)) {
    const tbl = /^(unique|primary key) \(((([^)]+)))\)$/i.exec(part);
    if (tbl) {
      const cs = tbl[2].split(",").map((c) => c.trim().toLowerCase());
      unique.push(cs);
      if (/^primary/i.test(tbl[1])) notNull.push(...cs);
      continue;
    }
    const m = new RegExp(`^(${ID}) [a-z]+(?:\\(\\d+\\))?(.*)$`, "i").exec(part);
    if (!m) return null;
    const rest = m[2].toLowerCase();
    if (rest.replace(/primary key|unique|not null/g, "").trim()) return null;
    cols.push(m[1].toLowerCase());
    if (/primary key|unique/.test(rest)) unique.push([m[1].toLowerCase()]);
    if (/primary key|not null/.test(rest)) notNull.push(m[1].toLowerCase());
  }
  return cols.length ? { k: "create", table, cols, unique, notNull } : null;
}

export function parseSql(raw: string): Stmt | null {
  const sql = normalize(raw);
  let m: RegExpExecArray | null;
  if ((m = /^begin(?: isolation level (read committed|repeatable read|serializable))?$/i.exec(sql)))
    return { k: "begin", level: m[1] ? LEVELS[m[1].toLowerCase()] : null };
  if (/^commit$/i.test(sql)) return { k: "commit" };
  if (/^rollback$/i.test(sql)) return { k: "rollback" };
  if ((m = new RegExp(`^create table (${ID}) \\((.+)\\)$`, "i").exec(sql))) return parseCreate(m[1].toLowerCase(), m[2]);
  if ((m = new RegExp(`^create unique index (?:${ID} )?on (${ID}) \\(([^)]+)\\)$`, "i").exec(sql)))
    return { k: "index", table: m[1].toLowerCase(), cols: m[2].split(",").map((c) => c.trim().toLowerCase()) };
  if ((m = new RegExp(`^insert into (${ID}) \\(([^)]*)\\) values (.+)$`, "i").exec(sql))) {
    const cols = m[2].split(",").map((c) => c.trim().toLowerCase());
    const rows: Val[][] = [];
    for (const t of splitTop(m[3])) {
      const inner = /^\((.*)\)$/.exec(t);
      if (!inner) return null;
      const vals = splitTop(inner[1]).map(lit);
      if (vals.length !== cols.length || vals.some((v) => !v)) return null;
      rows.push(vals.map((v) => v!.v));
    }
    return { k: "insert", table: m[1].toLowerCase(), cols, rows };
  }
  if ((m = new RegExp(`^insert into (${ID}) \\(([^)]*)\\) select (.+) where not exists \\(select 1 from (${ID}) where (.+)\\)$`, "i").exec(sql))) {
    const cols = m[2].split(",").map((c) => c.trim().toLowerCase());
    const vals = splitTop(m[3]).map(lit);
    const where = parseWhere(m[5]);
    if (vals.length !== cols.length || vals.some((v) => !v) || !where) return null;
    return { k: "insert", table: m[1].toLowerCase(), cols, rows: [vals.map((v) => v!.v)], notExists: { table: m[4].toLowerCase(), where } };
  }
  if ((m = new RegExp(`^update (${ID}) set (.+?) where (.+)$`, "i").exec(sql))) {
    const where = parseWhere(m[3]);
    const set: SetExpr[] = [];
    for (const part of splitTop(m[2])) {
      const a = new RegExp(`^(${ID}) = (.+)$`, "i").exec(part);
      if (!a) return null;
      const col = a[1].toLowerCase();
      const d = new RegExp(`^${col} ([+-]) (\\d+)$`, "i").exec(a[2]);
      const v = lit(a[2]);
      if (d) set.push({ col, delta: (d[1] === "-" ? -1 : 1) * Number(d[2]) });
      else if (v) set.push({ col, val: v.v });
      else return null;
    }
    return where ? { k: "update", table: m[1].toLowerCase(), set, where } : null;
  }
  if ((m = new RegExp(`^select (.+?) from (${ID})(?: where (.+?))?( for update)?$`, "i").exec(sql))) {
    const where = m[3] ? parseWhere(m[3]) : [];
    if (!where) return null;
    const p = m[1].trim().toLowerCase();
    const cols = p.split(",").map((c) => c.trim());
    const proj = p === "count(*)" ? "count" : p === "*" ? "*" : p === "1" ? "one" : cols.every((c) => new RegExp(`^${ID}$`).test(c)) ? cols : null;
    return proj ? { k: "select", table: m[2].toLowerCase(), proj, where, forUpdate: !!m[4] } : null;
  }
  return null;
}
