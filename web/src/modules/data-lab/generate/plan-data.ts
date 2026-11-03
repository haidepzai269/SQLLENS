import { Faker, en } from "@faker-js/faker";
import type { QueryResult } from "@/contracts/engine";

export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  references?: { table: string; column: string };
};
export type TableInfo = { schema: string; name: string; columns: ColumnInfo[] };
export type ColumnRule = { distinct?: number; nullRatio?: number; skew?: "uniform" | "zipf" };

export const BATCH_ROWS = 10_000;
const POOL_SIZE = 1000;
const MAX = "9223372036854775807";

// Identity ALWAYS / generated columns are left out: an explicit INSERT value would fail.
export const SCHEMA_QUERY = `
SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type, NOT a.attnotnull AS nullable,
  EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY (i.indkey)) AS is_pk,
  EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisunique AND i.indnatts = 1 AND i.indpred IS NULL AND i.indkey[0] = a.attnum) AS is_unique,
  (SELECT rc.relname FROM pg_constraint k JOIN pg_class rc ON rc.oid = k.confrelid
    WHERE k.conrelid = c.oid AND k.contype = 'f' AND k.conkey[1] = a.attnum AND array_length(k.conkey, 1) = 1 LIMIT 1) AS ref_table,
  (SELECT ra.attname FROM pg_constraint k JOIN pg_attribute ra ON ra.attrelid = k.confrelid AND ra.attnum = k.confkey[1]
    WHERE k.conrelid = c.oid AND k.contype = 'f' AND k.conkey[1] = a.attnum AND array_length(k.conkey, 1) = 1 LIMIT 1) AS ref_column
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
  AND a.attidentity <> 'a' AND a.attgenerated = ''
ORDER BY c.relname, a.attnum`;

export function parseSchema(result: QueryResult): TableInfo[] {
  const ix = (n: string) => {
    const i = result.columns.indexOf(n);
    if (i < 0) throw new Error(`parseSchema: missing column "${n}"`);
    return i;
  };
  const [s, t, c, ty, nu, pk, un, rt, rc] = [
    "schema_name", "table_name", "column_name", "data_type", "nullable", "is_pk", "is_unique", "ref_table", "ref_column",
  ].map(ix);
  const tables = new Map<string, TableInfo>();
  for (const r of result.rows) {
    const key = `${r[s]}.${r[t]}`;
    let tb = tables.get(key);
    if (!tb) tables.set(key, (tb = { schema: String(r[s]), name: String(r[t]), columns: [] }));
    tb.columns.push({
      name: String(r[c]), type: String(r[ty]), nullable: r[nu] === true, isPrimaryKey: r[pk] === true, isUnique: r[un] === true,
      ...(r[rt] != null && r[rc] != null ? { references: { table: String(r[rt]), column: String(r[rc]) } } : {}),
    });
  }
  return [...tables.values()];
}

type Kind =
  | { k: "int"; bits: 16 | 32 | 64 }
  | { k: "num"; p?: number; s?: number }
  | { k: "float"; real: boolean }
  | { k: "text"; n?: number }
  | { k: "bool" | "date" | "uuid" | "json" }
  | { k: "ts"; tz: boolean };

function parseType(raw: string): Kind | null {
  const t = raw.toLowerCase().trim();
  if (t === "smallint") return { k: "int", bits: 16 };
  if (t === "integer") return { k: "int", bits: 32 };
  if (t === "bigint") return { k: "int", bits: 64 };
  if (t === "real") return { k: "float", real: true };
  if (t === "double precision") return { k: "float", real: false };
  if (t === "text") return { k: "text" };
  if (t === "boolean") return { k: "bool" };
  if (t === "date") return { k: "date" };
  if (t === "uuid") return { k: "uuid" };
  if (t === "jsonb") return { k: "json" };
  let m = /^numeric(?:\((\d+)(?:,\s*(-?\d+))?\))?$/.exec(t);
  if (m) {
    if (!m[1]) return { k: "num" };
    const p = +m[1], s = m[2] ? +m[2] : 0;
    return s < 0 || s > p ? null : { k: "num", p, s };
  }
  m = /^character varying(?:\((\d+)\))?$/.exec(t);
  if (m) return { k: "text", n: m[1] ? +m[1] : undefined };
  m = /^character(?:\((\d+)\))?$/.exec(t);
  if (m) return { k: "text", n: m[1] ? +m[1] : 1 };
  m = /^timestamp(?:\(\d+\))? (with|without) time zone$/.exec(t);
  if (m) return { k: "ts", tz: m[1] === "with" };
  return null;
}

const q = (s: string) => `"${s.replaceAll('"', '""')}"`;
const lit = (s: string) => `'${s.replaceAll("\0", "").replaceAll("'", "''")}'`;
const fnv = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};
const STATUSES = ["pending", "active", "shipped", "completed", "cancelled"];

type PoolKind = "email" | "first_name" | "last_name" | "name" | "phone" | "status" | "country" | "city";
function poolKind(col: string): PoolKind | null {
  const n = col.toLowerCase();
  if (n.includes("email")) return "email";
  if (n === "status" || n.endsWith("_status")) return "status";
  if (n.includes("phone")) return "phone";
  if (n === "country" || n.endsWith("_country")) return "country";
  if (n === "city" || n.endsWith("_city")) return "city";
  if (n === "first_name") return "first_name";
  if (n === "last_name") return "last_name";
  if (n === "name" || n.endsWith("_name")) return "name";
  return null;
}
const isMoney = (col: string) => /^(price|amount|total)$|_(price|amount|total)$/.test(col.toLowerCase());

export function planData(
  tables: TableInfo[],
  rowsPerTable: Record<string, number>,
  rules: Record<string, ColumnRule> = {},
  seed = 1,
): { order: string[]; batches: string[] } {
  if (!Number.isSafeInteger(seed)) throw new Error("seed must be a safe integer");
  const byName = new Map(tables.map((t) => [t.name, t]));
  const rowsOf = (t: string) => {
    const n = rowsPerTable[t] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new Error(`Table "${t}": invalid row count ${n}`);
    return n;
  };
  const fail = (t: string, c: string, msg: string): never => {
    throw new Error(`Table "${t}" column "${c}": ${msg}`);
  };
  // FK to another known table; self-reference and unknown parents return undefined (they can only be NULL).
  const fkOf = (c: ColumnInfo, t: TableInfo) => {
    const r = c.references;
    return r && r.table !== t.name && byName.has(r.table) ? r : undefined;
  };

  const nulled = new Set<string>();
  for (const t of tables)
    for (const c of t.columns)
      if (c.references && !fkOf(c, t)) {
        if (c.nullable) nulled.add(`${t.name}.${c.name}`);
        else if (rowsOf(t.name) > 0)
          fail(t.name, c.name, `foreign key to "${c.references.table}" is a self-reference or unknown table and the column is NOT NULL`);
      }

  // Topological order, parents first. Cycles are broken by generating NULL in a nullable FK column.
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < tables.length) {
    const ready = tables.filter(
      (t) =>
        !done.has(t.name) &&
        t.columns.every((c) => {
          const r = fkOf(c, t);
          return !r || nulled.has(`${t.name}.${c.name}`) || done.has(r.table);
        }),
    );
    if (ready.length) {
      for (const t of ready) { order.push(t.name); done.add(t.name); }
      continue;
    }
    const stuck = tables.filter((t) => !done.has(t.name));
    const edge = stuck
      .flatMap((t) => t.columns.map((c) => ({ t, c })))
      .find(({ t, c }) => fkOf(c, t) && c.nullable && !nulled.has(`${t.name}.${c.name}`));
    if (!edge) throw new Error(`Foreign key cycle without a nullable column among tables: ${stuck.map((t) => t.name).join(", ")}`);
    nulled.add(`${edge.t.name}.${edge.c.name}`);
  }

  const pools = new Map<PoolKind, string[]>();
  const poolOf = (k: PoolKind): string[] => {
    let p = pools.get(k);
    if (!p) {
      if (k === "status") p = STATUSES;
      else {
        const f = new Faker({ locale: [en] });
        f.seed(seed + fnv(k));
        const gen = {
          email: () => f.internet.email(), first_name: () => f.person.firstName(), last_name: () => f.person.lastName(),
          name: () => f.person.fullName(), phone: () => f.phone.number(), country: () => f.location.country(), city: () => f.location.city(),
        }[k];
        p = [...new Set(Array.from({ length: POOL_SIZE }, gen))];
      }
      pools.set(k, p);
    }
    return p;
  };
  const salt = (t: string, c: string, extra = 0) => (seed % 1_000_000_007) * 1_000_003 + (fnv(`${t}.${c}`) % 1_000_003) + extra;
  const rand = (x: string, s: number) => `(hashint8extended(${x}::bigint, ${s}) & ${MAX})`;

  // Value for index j (bigint SQL expression in 1..k). Injective in j when the column is unique (k = n then).
  const valueAt = (t: TableInfo, c: ColumnInfo, j: string, n: number, k: number): string => {
    const unique = c.isPrimaryKey || c.isUnique;
    const kind = parseType(c.type);
    if (!kind) return fail(t.name, c.name, `unsupported type "${c.type}"`);
    const r = fkOf(c, t);
    if (unique && r) {
      const pt = byName.get(r.table)!;
      const pc = pt.columns.find((x) => x.name === r.column);
      if (!pc) return fail(t.name, c.name, `referenced column "${r.table}.${r.column}" not found`);
      return valueAt(pt, pc, j, n, n);
    }
    const name = c.name;
    switch (kind.k) {
      case "int": {
        const max = kind.bits === 16 ? 32767 : kind.bits === 32 ? 2147483647 : Number.MAX_SAFE_INTEGER;
        const ty = kind.bits === 16 ? "smallint" : kind.bits === 32 ? "integer" : "bigint";
        if (unique) {
          if (n > max) fail(t.name, name, `${n} unique values do not fit ${ty}`);
          return `${j}::${ty}`;
        }
        if (isMoney(name)) return `(1 + ${j} % 9999)::${ty}`;
        return `(${j} % ${Math.min(max, 1_000_000_000)})::${ty}`;
      }
      case "num": {
        const { p, s } = kind;
        const cast = p === undefined ? "numeric" : `numeric(${p},${s})`;
        const intDigits = p === undefined ? 18 : p - (s as number);
        if (unique) {
          if (p !== undefined && 10 ** intDigits <= n) fail(t.name, name, `${n} unique values do not fit ${cast}`);
          return `${j}::${cast}`;
        }
        if (isMoney(name) && intDigits >= 4) return `(1 + (${j} % 99999)::numeric / 100)::${cast}`;
        const M = Math.min(10 ** intDigits, 1e9), F = 10 ** Math.min(s ?? 2, 6);
        return `((${j} % ${M})::numeric + ((${j} * 7919) % ${F})::numeric / ${F})::${cast}`;
      }
      case "float": {
        const ty = kind.real ? "real" : "double precision";
        return unique ? `${j}::${ty}` : `((${j} % 1000000)::double precision / 100)::${ty}`;
      }
      case "bool":
        if (unique && n > 2) fail(t.name, name, "unique boolean allows at most 2 rows");
        return `(${j} % 2 = 0)`;
      case "date":
        return unique ? `(date '2000-01-01' + ${j}::integer)` : `(date '2023-01-01' + (${j} % 1095)::integer)`;
      case "ts": {
        const base = kind.tz ? "timestamptz '2023-01-01 00:00:00+00'" : "timestamp '2023-01-01'";
        return unique ? `(${base} + ${j} * interval '1 second')` : `(${base} + (${j} % 1051200) * interval '1 minute')`;
      }
      case "uuid":
        return `md5(${j}::text || ${lit(String(seed))})::uuid`;
      case "json":
        return unique ? `jsonb_build_object('id', ${j})` : `jsonb_build_object('id', ${j}, 'tag', 'v' || (${j} % 10))`;
      case "text": {
        const pk = poolKind(name);
        let e: string;
        let minLen = 0;
        if (unique) {
          const [pre, post] = pk === "email" ? ["user", "@example.com"] : [`${name.slice(0, 8)}_`, ""];
          minLen = pre.length + post.length + String(n).length;
          e = `${lit(pre)} || ${j}::text || ${lit(post)}`;
        } else if (pk) {
          const pool = poolOf(pk);
          const base = `(ARRAY[${pool.map(lit).join(",")}])[1 + (${j} - 1) % ${pool.length}]`;
          e = k > pool.length ? `${base} || '_' || ((${j} - 1) / ${pool.length})::text` : base;
        } else e = `'text_' || ${j}::text`;
        if (kind.n !== undefined) {
          if (unique && minLen > kind.n) fail(t.name, name, `${n} unique values do not fit length ${kind.n}`);
          return `left(${e}, ${kind.n})`;
        }
        return e;
      }
    }
  };

  const batches: string[] = [];
  for (const name of order) {
    const t = byName.get(name)!;
    const n = rowsOf(name);
    if (n === 0) continue;
    if (t.columns.filter((c) => c.isPrimaryKey).length > 1)
      throw new Error(`Table "${name}": composite primary key is not supported`);

    const cols: string[] = [];
    const exprs: string[] = [];
    for (const c of t.columns) {
      const key = `${name}.${c.name}`;
      const rule = rules[key] ?? {};
      if (rule.distinct !== undefined && (!Number.isSafeInteger(rule.distinct) || rule.distinct < 1))
        fail(name, c.name, "distinct must be a positive integer");
      if (rule.nullRatio !== undefined && !(rule.nullRatio >= 0 && rule.nullRatio <= 1))
        fail(name, c.name, "nullRatio must be between 0 and 1");
      const kind = parseType(c.type);
      if (!kind) {
        if (c.nullable) continue; // unsupported but optional: left to the DB default / NULL
        return fail(name, c.name, `unsupported type "${c.type}" and the column is NOT NULL`);
      }
      const unique = c.isPrimaryKey || c.isUnique;
      const s = salt(name, c.name);
      // index 1..k; when `cover`, the first k rows hit each value once so DISTINCT is exact
      const jOf = (k: number, cover: boolean) => {
        const rd = rand("g", s);
        const base =
          rule.skew === "zipf"
            ? `LEAST(${k}, floor(power(${k + 1}::double precision, (${rd}::double precision / ${MAX}.0) ^ 2))::bigint)`
            : `(1 + ${rd} % ${k})`;
        return cover ? `(CASE WHEN g <= ${k} THEN g ELSE ${base} END)` : base;
      };
      let expr: string;
      const fk = fkOf(c, t);
      if (fk && !nulled.has(key)) {
        const P = rowsOf(fk.table);
        const pt = byName.get(fk.table)!;
        const pc = pt.columns.find((x) => x.name === fk.column);
        if (!pc) return fail(name, c.name, `referenced column "${fk.table}.${fk.column}" not found`);
        if (!(pc.isPrimaryKey || pc.isUnique)) fail(name, c.name, `referenced column "${fk.table}.${fk.column}" is neither primary key nor unique`);
        if (P === 0) {
          if (!c.nullable) fail(name, c.name, `parent table "${fk.table}" has 0 rows`);
          expr = "NULL";
        } else if (unique) {
          if (n > P) fail(name, c.name, `unique foreign key allows at most ${P} rows (parent size)`);
          expr = valueAt(pt, pc, "g", P, P);
        } else {
          expr = valueAt(pt, pc, jOf(Math.min(rule.distinct ?? P, P, n), true), P, P);
        }
      } else if (fk || c.references) {
        expr = "NULL";
      } else if (unique) {
        expr = valueAt(t, c, "g", n, n);
      } else {
        const pk = kind.k === "text" ? poolKind(c.name) : null;
        const k = Math.min(rule.distinct ?? (pk ? poolOf(pk).length : n), n);
        expr = valueAt(t, c, jOf(k, rule.distinct !== undefined), n, k);
      }
      if (rule.nullRatio && c.nullable && expr !== "NULL")
        expr = `CASE WHEN ${rand("g", salt(name, c.name, 1))} % 10000 < ${Math.round(rule.nullRatio * 10000)} THEN NULL ELSE ${expr} END`;
      cols.push(q(c.name));
      exprs.push(expr);
    }
    if (!cols.length) throw new Error(`Table "${name}": no column can be generated`);
    const target = `${q(t.schema)}.${q(name)}`;
    for (let from = 1; from <= n; from += BATCH_ROWS) {
      const to = Math.min(n, from + BATCH_ROWS - 1);
      batches.push(`INSERT INTO ${target} (${cols.join(", ")}) SELECT ${exprs.join(", ")} FROM generate_series(${from}::bigint, ${to}::bigint) AS g`);
    }
  }
  return { order, batches };
}
