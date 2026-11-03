import type { EngineId } from "@/contracts/engine";
import type { ParsedStatement } from "../parser/types";
import { toSel, type E, type Sel, type Ty } from "./ir";

export type InferredColumn = { name: string; type: string; reason: "literal" | "name" | "default"; primaryKeyGuess: boolean };
export type InferredTable = {
  name: string;
  columns: InferredColumn[];
  foreignKeyGuesses: { column: string; table: string; refColumn: string }[];
  incomplete: boolean;
};
export type InferWarning = { key: string; table?: string };

type Origin = { table: string; column: string };
type Out = { cols: Map<string, Origin | null>; starTable?: string };
type Binding = { alias?: string; table?: string } & Partial<Out>;
type Col = { name: string; lits: Set<Ty> };
type TableAcc = { cols: Map<string, Col>; incomplete: boolean };

const HINTS: [RegExp, Ty][] = [
  [/(^|_)id$/i, "integer"],
  [/_at$|^(created|updated|deleted)/i, "timestamp"],
  [/(^|_)date$/i, "date"],
  [/^(is|has)_/i, "boolean"],
  [/(^|_)(price|amount|total|balance|cost)$/i, "numeric"],
  [/(^|_)(count|qty|quantity|age)$/i, "integer"],
];

export function inferSchema(statements: ParsedStatement[], engine: EngineId): { tables: InferredTable[]; warnings: InferWarning[] } {
  const ci = (s: string) => (engine === "mysql" ? s.toLowerCase() : s); // so khớp tên cột và alias
  const tables = new Map<string, TableAcc>();
  const eqs: [Origin, Origin][] = [];
  const warned = new Map<string, InferWarning>();
  const warn = (key: string, table?: string) => warned.set(`${key}|${table}`, { key, table });

  const ensure = (t: string) => tables.get(t) ?? (tables.set(t, { cols: new Map(), incomplete: false }), tables.get(t)!);
  const colOf = (o: Origin) => {
    const t = ensure(o.table);
    const k = ci(o.column);
    return t.cols.get(k) ?? (t.cols.set(k, { name: o.column, lits: new Set() }), t.cols.get(k)!);
  };

  function bindingCol(b: Binding, name: string): Origin | null {
    let o: Origin | null | undefined;
    if (b.table) o = { table: b.table, column: name };
    else o = b.cols?.get(ci(name)) ?? (b.starTable ? { table: b.starTable, column: name } : null);
    if (o) colOf(o);
    return o ?? null;
  }

  function resolve(sel: Sel, outer: Binding[][], ctes: Map<string, Out>): Out {
    const cm = new Map(ctes);
    for (const c of sel.ctes) {
      if (c.recursive) cm.set(c.name, { cols: new Map() }); // tên CTE tự gọi không được thành bảng
      cm.set(c.name, resolve(c.s, outer, cm));
    }
    if (sel.union.length) return sel.union.map((u) => resolve(u, outer, cm))[0];
    const scope: Binding[] = [];
    for (const s of sel.from) {
      if (s.sub) {
        scope.push({ alias: s.alias, ...resolve(s.sub, outer, cm) });
      } else if (s.name && !s.schema && cm.has(s.name)) {
        scope.push({ alias: s.alias ?? s.name, ...cm.get(s.name)! });
      } else if (s.name) {
        if (s.schema) warn("schema-ignored", s.name);
        ensure(s.name);
        scope.push({ alias: s.alias ?? s.name, table: s.name });
      }
    }
    const chain = [scope, ...outer];
    for (const u of sel.using) for (const x of scope) if (x.table) colOf({ table: x.table, column: u });

    const pick = (level: Binding[], name: string): Origin | null | "ambiguous" => {
      if (level.length === 1) return bindingCol(level[0], name);
      const hit = level.filter((b) => b.cols?.has(ci(name)));
      if (hit.length === 1 && !level.some((b) => b.table)) return bindingCol(hit[0], name);
      return "ambiguous";
    };
    const column = (e: { q?: string; name: string }): Origin | null => {
      if (e.q) {
        for (const level of chain) {
          const b = level.find((x) => x.alias !== undefined && ci(x.alias) === ci(e.q!));
          if (b) return bindingCol(b, e.name);
        }
        return null;
      }
      const level = chain.find((l) => l.length);
      if (!level) return null;
      const r = pick(level, e.name);
      if (r === "ambiguous") return warn("ambiguous-column"), null;
      return r;
    };
    const star = (e: { q?: string; key?: string }) => {
      const hit = e.q ? scope.filter((b) => b.alias !== undefined && ci(b.alias) === ci(e.q!)) : scope;
      for (const b of hit) {
        if (b.table) {
          ensure(b.table).incomplete = true;
          warn(e.key ?? "star", b.table);
        }
      }
      return hit;
    };
    const consts = (e: E): Ty[] =>
      e.t === "const" ? (e.ty ? [e.ty] : []) : e.t === "list" ? e.kids.flatMap((k) => (k.t === "const" && k.ty ? [k.ty] : [])) : [];

    const visit = (e: E): Origin | null => {
      switch (e.t) {
        case "col":
          return column(e);
        case "star":
          star(e);
          return null;
        case "sel":
          resolve(e.s, chain, cm);
          return null;
        case "cmp": {
          const l = visit(e.l);
          const r = visit(e.r);
          if (l) consts(e.r).forEach((t) => colOf(l).lits.add(t));
          if (r) consts(e.l).forEach((t) => colOf(r).lits.add(t));
          if (l && r && e.op === "=" && l.table !== r.table) eqs.push([l, r]);
          return null;
        }
        case "list":
        case "op":
          e.kids.forEach(visit);
          return null;
        default:
          return null;
      }
    };

    const out: Out = { cols: new Map() };
    const own = new Set(sel.items.flatMap((i) => (i.alias ? [ci(i.alias)] : [])));
    for (const it of sel.items) {
      if (it.e.t === "star") {
        const hit = star(it.e);
        for (const b of hit) {
          if (b.table) out.starTable = hit.length === 1 ? b.table : out.starTable;
          else {
            b.cols?.forEach((v, k) => out.cols.set(k, v));
            out.starTable ??= b.starTable;
          }
        }
        continue;
      }
      const o = visit(it.e);
      const name = it.alias ?? (it.e.t === "col" ? it.e.name : undefined);
      if (name) out.cols.set(ci(name), it.e.t === "col" ? o : null);
    }
    // ORDER BY / GROUP BY có thể gọi alias của SELECT: không tính là cột bảng.
    for (const p of sel.preds) {
      if (p.t === "col" && !p.q && own.has(ci(p.name))) continue;
      visit(p);
    }
    return out;
  }

  for (const s of statements) {
    const sel = toSel(s.ast, engine);
    if (sel) resolve(sel, [], new Map());
  }

  // ---- kết quả ----
  const names = [...tables.keys()];
  const findTable = (base: string) => names.find((n) => [base, base + "s", base + "es"].some((c) => ci(c) === ci(n)));
  const fks = new Map<string, Map<string, { table: string; refColumn: string }>>();
  const addFk = (from: Origin, to: Origin) => {
    const m = fks.get(from.table) ?? fks.set(from.table, new Map()).get(from.table)!;
    m.set(ci(from.column), { table: to.table, refColumn: to.column });
  };
  for (const [a, b] of eqs) {
    const aid = ci(a.column) === "id";
    const bid = ci(b.column) === "id";
    if (bid && !aid) addFk(a, b);
    else if (aid && !bid) addFk(b, a);
  }
  const result: InferredTable[] = [];
  for (const [tname, t] of tables) {
    const cols: InferredColumn[] = [];
    const fkList: InferredTable["foreignKeyGuesses"] = [];
    for (const [k, c] of t.cols) {
      const hint = HINTS.find(([re]) => re.test(c.name))?.[1];
      const lits = new Set(c.lits);
      if (lits.has("numeric")) lits.delete("integer");
      let type: Ty = hint ?? "text";
      let reason: InferredColumn["reason"] = hint ? "name" : "default";
      if (lits.size > 1) {
        type = "text";
        reason = "default";
        warn("type-conflict", tname);
      } else if (lits.size === 1) {
        const l = [...lits][0];
        // chuỗi so với cột tên ngày giờ: giữ kiểu theo tên; số nguyên so với cột tên tiền: giữ numeric
        const keepName = (l === "text" && (hint === "date" || hint === "timestamp")) || (l === "integer" && hint === "numeric");
        if (!keepName) {
          type = l;
          reason = "literal";
        }
        else reason = l === "integer" ? "literal" : "name";
      }
      cols.push({ name: c.name, type, reason, primaryKeyGuess: ci(c.name) === "id" });
      const m = /^(.+)_id$/i.exec(c.name);
      const target = m && !fks.get(tname)?.has(k) ? findTable(m[1]) : undefined;
      if (target && tables.get(target)!.cols.has(ci("id"))) addFk({ table: tname, column: c.name }, { table: target, column: "id" });
    }
    fks.get(tname)?.forEach((v, k) => fkList.push({ column: t.cols.get(k)?.name ?? k, ...v }));
    result.push({ name: tname, columns: cols, foreignKeyGuesses: fkList, incomplete: t.incomplete });
  }
  return { tables: result, warnings: [...warned.values()] };
}

// ---- CREATE TABLE ----

export const quoteIdent = (engine: EngineId, s: string) => {
  const clean = s.replace(/\0/g, "");
  return engine === "mysql" ? "`" + clean.replace(/`/g, "``") + "`" : '"' + clean.replace(/"/g, '""') + '"';
};

// Kiểu người dùng có thể sửa tay, nên chỉ nhận danh sách kiểu quen thuộc, còn lại về text.
const TYPE_RE = /^(smallint|integer|int|bigint|real|double precision|float|text|boolean|bool|date|time|timestamp|timestamptz|datetime|uuid|json|jsonb|(varchar|char|character varying)(\(\d{1,4}\))?|(numeric|decimal)(\(\d{1,4}(,\d{1,4})?\))?)$/;
const MYSQL_TYPE: Record<string, string> = {
  integer: "int", numeric: "decimal(20,6)", timestamp: "datetime", timestamptz: "datetime", uuid: "char(36)", jsonb: "json",
  "double precision": "double", "character varying": "varchar(255)", varchar: "varchar(255)", text: "text",
};

function typeSql(engine: EngineId, raw: string, pk: boolean) {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const ty = TYPE_RE.test(t) ? t : "text";
  if (engine === "postgres") return ty === "datetime" ? "timestamp" : ty;
  if (pk && /^(text|varchar|character varying)$/.test(ty)) return "varchar(255)"; // MySQL không cho khóa chính kiểu text
  return MYSQL_TYPE[ty] ?? ty;
}

export function toCreateSql(tables: InferredTable[], engine: EngineId): string {
  const q = (s: string) => quoteIdent(engine, s);
  return tables
    .map((t) => {
      const defs = t.columns.map((c) => `${q(c.name)} ${typeSql(engine, c.type, c.primaryKeyGuess)}${c.primaryKeyGuess ? " PRIMARY KEY" : ""}`);
      // MySQL không cho bảng không có cột (bảng chỉ dùng SELECT *): thêm một cột giữ chỗ.
      if (!defs.length && engine === "mysql") defs.push("`_sqllens_placeholder` int");
      // shortcut: khóa ngoại chỉ là gợi ý, không sinh REFERENCES vì kiểu hai phía có thể lệch; thêm khi có dữ liệu mẫu.
      return `CREATE TABLE ${q(t.name)} (${defs.join(", ")});`;
    })
    .join("\n");
}
