import { arr, lc, part, rec, table, text, walk, type Adapter, type Cat, type Pred, type Rec, type Scope, type Schema, type Source, type X } from "./types";

const strs = (xs: unknown) => arr(xs).map((i) => text(rec(rec(i)?.String)?.sval)).filter((s): s is string => !!s);
const OTHER: X = { k: "other" };

export function pgX(n: unknown): X {
  const [name, v] = Object.entries(rec(n) ?? {})[0] ?? [];
  const r = rec(v);
  if (!r) return OTHER;
  const pos = typeof r.location === "number" ? r.location : undefined;
  if (name === "ColumnRef") {
    const f = arr(r.fields);
    const names = strs(f);
    if (!names.length || names.length !== f.length) return OTHER; // có `*`
    return { k: "col", q: names.length > 1 ? names[names.length - 2] : undefined, name: names[names.length - 1], pos };
  }
  if (name === "A_Const") {
    if (rec(r.sval)) return { k: "str", v: String(rec(r.sval)!.sval ?? "") };
    if (rec(r.ival)) return { k: "num", v: String(rec(r.ival)!.ival ?? 0) };
    if (rec(r.fval)) return { k: "num", v: String(rec(r.fval)!.fval) };
    return OTHER;
  }
  if (name === "FuncCall") {
    const fn = strs(r.funcname);
    return fn.length ? { k: "fn", name: lc(fn[fn.length - 1]), args: arr(r.args).map(pgX), pos } : OTHER;
  }
  return OTHER; // gồm TypeCast: ép kiểu tường minh không xét
}

function preds(n: unknown, top: boolean, out: Pred[]) {
  const [name, v] = Object.entries(rec(n) ?? {})[0] ?? [];
  const r = rec(v);
  if (!r) return;
  if (name === "BoolExpr") {
    if (r.boolop === "AND_EXPR") arr(r.args).forEach((a) => preds(a, top, out));
    else if (r.boolop === "OR_EXPR") arr(r.args).forEach((a) => preds(a, false, out));
    return; // shortcut: NOT (...) bỏ qua, nên `NOT (lower(x)='a')` không báo; thêm khi cần
  }
  if (name === "NullTest") out.push({ k: "cmp", op: "is", l: pgX(r.arg), r: OTHER, top });
  else if (name === "SubLink" && r.subLinkType === "ANY_SUBLINK" && r.testexpr) out.push({ k: "cmp", op: "=", l: pgX(r.testexpr), r: OTHER, top });
  else if (name === "A_Expr") {
    const op = strs(r.name)[0];
    const l = pgX(r.lexpr);
    if (r.kind === "AEXPR_OP") out.push({ k: "cmp", op, l, r: pgX(r.rexpr), top });
    else if (r.kind === "AEXPR_LIKE" || r.kind === "AEXPR_ILIKE") {
      if (op === "~~" || op === "~~*") out.push({ k: "like", l, r: pgX(r.rexpr), top });
    } else if (r.kind === "AEXPR_OP_ANY" && op === "=") out.push({ k: "cmp", op, l, r: OTHER, top });
    else if (r.kind === "AEXPR_IN" && op === "=") {
      arr(rec(rec(r.rexpr)?.List)?.items).forEach((i) => out.push({ k: "cmp", op, l, r: pgX(i), top }));
    } else if (r.kind === "AEXPR_BETWEEN") out.push({ k: "cmp", op: ">=", l, r: OTHER, top });
  }
}

const typeCat = (t: unknown): Cat => {
  const n = strs(rec(t)?.names).pop();
  if (!n) return "other";
  if (/^(int[248]?|integer|smallint|bigint|numeric|decimal|float[48]|real|serial[248]?|bigserial|smallserial)$/.test(n)) return "number";
  return /^(text|varchar|bpchar|char|character|name)$/.test(n) ? "text" : "other";
};

function constraint(s: Schema, t: string, c: Rec, own?: string) {
  if (c.contype !== "CONSTR_PRIMARY" && c.contype !== "CONSTR_UNIQUE") return;
  const keys = own ? [own] : strs(c.keys).map(lc);
  if (keys.length) table(s, t).indexes.push({ btree: true, parts: keys.map((k) => ({ key: k, col: k })) });
}

function columnDef(s: Schema, t: string, d: Rec) {
  const col = text(d.colname);
  if (!col) return;
  table(s, t).cols.set(lc(col), typeCat(d.typeName));
  arr(d.constraints).forEach((c) => constraint(s, t, rec(rec(c)?.Constraint) ?? {}, lc(col)));
}

function pgSources(items: unknown[], ctes: Set<string>, out: Pred[]): Source[] {
  return items.flatMap((i): Source[] => {
    const rv = rec(rec(i)?.RangeVar);
    if (rv) {
      const name = lc(text(rv.relname) ?? "");
      const alias = text(rec(rv.alias)?.aliasname);
      return [{ name: !name || (!rv.schemaname && ctes.has(name)) ? undefined : name, alias: alias && lc(alias) }];
    }
    const j = rec(rec(i)?.JoinExpr);
    if (!j) return [{}];
    if (j.quals) preds(j.quals, true, out);
    return pgSources([j.larg, j.rarg], ctes, out);
  });
}

export const pg: Adapter = {
  schema(ast, s) {
    const [name, v] = Object.entries(rec(ast) ?? {})[0] ?? [];
    const r = rec(v);
    const rel = lc(text(rec(r?.relation)?.relname) ?? "");
    if (!r || !rel) return;
    if (name === "CreateStmt") {
      table(s, rel, true);
      for (const e of arr(r.tableElts)) {
        const o = rec(e);
        if (rec(o?.ColumnDef)) columnDef(s, rel, rec(o!.ColumnDef)!);
        else if (rec(o?.Constraint)) constraint(s, rel, rec(o!.Constraint)!);
      }
    } else if (name === "IndexStmt") {
      const parts = arr(r.indexParams).map((p) => {
        const e = rec(rec(p)?.IndexElem);
        return e?.name ? part({ k: "col", name: String(e.name) }) : part(pgX(e?.expr));
      });
      table(s, rel).indexes.push({ btree: r.accessMethod === "btree", parts });
    } else if (name === "AlterTableStmt") {
      for (const c of arr(r.cmds)) {
        const cmd = rec(rec(c)?.AlterTableCmd);
        if (cmd?.subtype === "AT_AddConstraint") constraint(s, rel, rec(rec(cmd.def)?.Constraint) ?? {});
        else if (cmd?.subtype === "AT_AddColumn" && rec(rec(cmd.def)?.ColumnDef)) columnDef(s, rel, rec(rec(cmd.def)!.ColumnDef)!);
      }
    }
  },
  scopes(ast) {
    const ctes = new Set<string>();
    walk(ast, (n) => {
      const c = text(rec(n.CommonTableExpr)?.ctename);
      if (c) ctes.add(lc(c));
    });
    const out: Scope[] = [];
    const build = (s: Rec, isSel: boolean, upd: boolean) => {
      const p: Pred[] = [];
      const from = isSel ? arr(s.fromClause) : [{ RangeVar: s.relation }, ...arr(upd ? s.fromClause : s.usingClause)];
      const sources = pgSources(from, ctes, p);
      if (s.whereClause) preds(s.whereClause, true, p);
      out.push({ sources, preds: p });
      // UNION/INTERSECT/EXCEPT: hai nhánh là SelectStmt trần, không có khóa bọc nên walk không tự thấy.
      for (const b of [s.larg, s.rarg]) if (rec(b)) build(rec(b)!, true, false);
    };
    walk(ast, (n) => {
      if (rec(n.SelectStmt)) build(rec(n.SelectStmt)!, true, false);
      else if (rec(n.UpdateStmt)) build(rec(n.UpdateStmt)!, false, true);
      else if (rec(n.DeleteStmt)) build(rec(n.DeleteStmt)!, false, false);
    });
    return out;
  },
};
