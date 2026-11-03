// Đưa AST của hai engine (hình dạng khác nhau) về một dạng chung nhỏ, để phần suy luận không phải rẽ theo engine.
import type { EngineId } from "@/contracts/engine";

export type Ty = "integer" | "numeric" | "text" | "boolean" | "date" | "timestamp";

export type E =
  | { t: "col"; q?: string; name: string }
  | { t: "star"; q?: string; key?: string }
  | { t: "const"; ty?: Ty } // ty không có nghĩa là NULL
  | { t: "cmp"; op: string; l: E; r: E }
  | { t: "list" | "op"; kids: E[] }
  | { t: "sel"; s: Sel };

export type Src = { name?: string; schema?: string; sub?: Sel; alias?: string };
export type Sel = {
  ctes: { name: string; s: Sel; recursive?: boolean }[];
  from: Src[];
  items: { e: E; alias?: string }[];
  preds: E[];
  union: Sel[];
  using: string[]; // cột trong JOIN ... USING, có ở cả hai bảng
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown) => (typeof x === "string" && x ? x : undefined);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const emptySel = (): Sel => ({ ctes: [], from: [], items: [], preds: [], union: [], using: [] });
const kids = (v: unknown, f: (n: unknown) => E): E[] =>
  (Array.isArray(v) ? v : isObj(v) ? Object.values(v) : []).flatMap((x) => (typeof x === "object" && x !== null ? [Array.isArray(x) ? ({ t: "op", kids: kids(x, f) } as E) : f(x)] : []));

const TYPE_NAMES: Record<string, Ty> = {
  date: "date", timestamp: "timestamp", timestamptz: "timestamp", datetime: "timestamp", time: "timestamp",
  int: "integer", int4: "integer", int8: "integer", integer: "integer", bigint: "integer", smallint: "integer",
  numeric: "numeric", decimal: "numeric", float8: "numeric", float4: "numeric", bool: "boolean", boolean: "boolean",
};

// ---- PostgreSQL ----

function pgConst(v: Obj): E {
  const ty: Ty | undefined = "ival" in v ? "integer" : "fval" in v ? "numeric" : "sval" in v ? "text" : "boolval" in v ? "boolean" : undefined;
  return { t: "const", ty };
}

function pgExpr(n: unknown): E {
  if (!isObj(n)) return { t: "op", kids: [] };
  const ks = Object.keys(n);
  if (ks.length !== 1) return { t: "op", kids: kids(n, pgExpr) };
  const k = ks[0];
  const v = n[k];
  if (!isObj(v)) return { t: "op", kids: [] };
  switch (k) {
    case "ColumnRef": {
      const f = arr(v.fields).map((x) => (isObj(x) && isObj(x.String) ? str(x.String.sval) : isObj(x) && "A_Star" in x ? "*" : undefined));
      const name = f[f.length - 1];
      if (!name) return { t: "op", kids: [] };
      const q = f.length > 1 ? f[f.length - 2] : undefined;
      return name === "*" ? { t: "star", q } : { t: "col", q, name };
    }
    case "A_Const":
      return pgConst(v);
    case "TypeCast": {
      const arg = pgExpr(v.arg);
      const names = isObj(v.typeName) ? arr(v.typeName.names) : [];
      const last = names[names.length - 1];
      const ty = isObj(last) && isObj(last.String) ? TYPE_NAMES[String(last.String.sval)] : undefined;
      return arg.t === "const" ? { t: "const", ty: ty ?? arg.ty } : arg;
    }
    case "A_Expr": {
      const nm = arr(v.name)[0];
      const op = isObj(nm) && isObj(nm.String) ? String(nm.String.sval) : "";
      return { t: "cmp", op, l: pgExpr(v.lexpr), r: pgExpr(v.rexpr) };
    }
    case "List":
      return { t: "list", kids: arr(v.items).map(pgExpr) };
    case "SubLink":
      return { t: "op", kids: [pgExpr(v.testexpr), pgExpr(v.subselect)] };
    case "SelectStmt":
      return { t: "sel", s: pgSel(v) };
    default:
      return { t: "op", kids: kids(v, pgExpr) };
  }
}

function pgFrom(n: unknown, sel: Sel) {
  if (!isObj(n)) return;
  if (isObj(n.RangeVar)) {
    const r = n.RangeVar;
    sel.from.push({ name: str(r.relname), schema: str(r.schemaname), alias: isObj(r.alias) ? str(r.alias.aliasname) : undefined });
  } else if (isObj(n.JoinExpr)) {
    pgFrom(n.JoinExpr.larg, sel);
    pgFrom(n.JoinExpr.rarg, sel);
    if (n.JoinExpr.quals) sel.preds.push(pgExpr(n.JoinExpr.quals));
    for (const u of arr(n.JoinExpr.usingClause)) if (isObj(u) && isObj(u.String) && str(u.String.sval)) sel.using.push(str(u.String.sval)!);
  } else if (isObj(n.RangeSubselect)) {
    const r = n.RangeSubselect;
    const q = isObj(r.subquery) && isObj(r.subquery.SelectStmt) ? r.subquery.SelectStmt : {};
    sel.from.push({ sub: pgSel(q), alias: isObj(r.alias) ? str(r.alias.aliasname) : undefined });
  }
}

export function pgSel(s: Obj): Sel {
  const sel = emptySel();
  const w = s.withClause;
  if (isObj(w)) {
    for (const c of arr(w.ctes)) {
      const cte = isObj(c) && isObj(c.CommonTableExpr) ? c.CommonTableExpr : undefined;
      const q = cte && isObj(cte.ctequery) && isObj(cte.ctequery.SelectStmt) ? cte.ctequery.SelectStmt : {};
      if (cte && str(cte.ctename)) sel.ctes.push({ name: str(cte.ctename)!, s: pgSel(q), recursive: w.recursive === true });
    }
  }
  if (isObj(s.larg) && isObj(s.rarg)) {
    sel.union = [pgSel(s.larg), pgSel(s.rarg)];
    return sel;
  }
  for (const t of arr(s.targetList)) {
    const rt = isObj(t) && isObj(t.ResTarget) ? t.ResTarget : undefined;
    if (rt) sel.items.push({ e: pgExpr(rt.val), alias: str(rt.name) });
  }
  arr(s.fromClause).forEach((f) => pgFrom(f, sel));
  for (const p of [s.whereClause, s.havingClause]) if (p) sel.preds.push(pgExpr(p));
  for (const g of arr(s.groupClause)) sel.preds.push(pgExpr(g));
  for (const o of arr(s.sortClause)) sel.preds.push(pgExpr(isObj(o) && isObj(o.SortBy) ? o.SortBy.node : o));
  return sel;
}

// INSERT, UPDATE, DELETE đưa về một Sel: bảng đích là FROM, "cột = giá trị" là điều kiện giả để dùng lại phần suy kiểu.
function pgDml(stmt: Obj): Sel | undefined {
  const sel = emptySel();
  const target = (r: unknown) => {
    if (isObj(r) && str(r.relname)) sel.from.push({ name: str(r.relname), schema: str(r.schemaname), alias: isObj(r.alias) ? str(r.alias.aliasname) : undefined });
  };
  const k = Object.keys(stmt)[0];
  const v = stmt[k];
  if (!isObj(v)) return;
  target(v.relation);
  if (k === "InsertStmt") {
    const cols = arr(v.cols).map((c) => (isObj(c) && isObj(c.ResTarget) ? str(c.ResTarget.name) : undefined)).filter((x): x is string => !!x);
    if (!cols.length) sel.items.push({ e: { t: "star", key: "insert-without-columns" } });
    cols.forEach((c) => sel.items.push({ e: { t: "col", name: c } }));
    const inner = isObj(v.selectStmt) && isObj(v.selectStmt.SelectStmt) ? v.selectStmt.SelectStmt : {};
    for (const row of arr(inner.valuesLists)) {
      const vals = isObj(row) && isObj(row.List) ? arr(row.List.items) : [];
      vals.forEach((x, i) => cols[i] && sel.preds.push({ t: "cmp", op: "=", l: { t: "col", name: cols[i] }, r: pgExpr(x) }));
    }
    if (!inner.valuesLists) sel.preds.push({ t: "sel", s: pgSel(inner) });
  } else if (k === "UpdateStmt") {
    for (const t of arr(v.targetList)) {
      const rt = isObj(t) && isObj(t.ResTarget) ? t.ResTarget : undefined;
      if (rt && str(rt.name)) sel.preds.push({ t: "cmp", op: "=", l: { t: "col", name: str(rt.name)! }, r: pgExpr(rt.val) });
    }
    arr(v.fromClause).forEach((f) => pgFrom(f, sel));
    if (v.whereClause) sel.preds.push(pgExpr(v.whereClause));
  } else if (k === "DeleteStmt") {
    arr(v.usingClause).forEach((f) => pgFrom(f, sel));
    if (v.whereClause) sel.preds.push(pgExpr(v.whereClause));
  } else return;
  return sel;
}

// ---- MySQL ----

function myConst(v: Obj): E {
  const t = String(v.type);
  if (t === "number") return { t: "const", ty: /^-?\d+$/.test(String(v.value)) ? "integer" : "numeric" };
  if (/string$/.test(t)) return { t: "const", ty: "text" };
  if (t === "bool") return { t: "const", ty: "boolean" };
  return { t: "const", ty: TYPE_NAMES[t] }; // date, datetime, timestamp, time; null cho ra ty rỗng
}

function myExpr(n: unknown): E {
  if (Array.isArray(n)) return { t: "list", kids: n.map(myExpr) };
  if (!isObj(n)) return { t: "op", kids: [] };
  if (isObj(n.ast)) return { t: "sel", s: mySel(n.ast) };
  switch (n.type) {
    case "select":
      return { t: "sel", s: mySel(n) };
    case "column_ref": {
      const c = isObj(n.column) && isObj(n.column.expr) ? str(n.column.expr.value) : str(n.column);
      if (!c) return { t: "op", kids: [] };
      return c === "*" ? { t: "star", q: str(n.table) } : { t: "col", q: str(n.table), name: c };
    }
    case "binary_expr":
      return /^(AND|OR|XOR|&&|\|\|)$/i.test(String(n.operator)) ? { t: "op", kids: [myExpr(n.left), myExpr(n.right)] } : { t: "cmp", op: String(n.operator), l: myExpr(n.left), r: myExpr(n.right) };
    case "expr_list":
      return { t: "list", kids: arr(n.value).map(myExpr) };
    case "number": case "bool": case "date": case "datetime": case "timestamp": case "time": case "null":
      return myConst(n);
    default:
      if (/string$/.test(String(n.type))) return myConst(n);
      return { t: "op", kids: kids(n, myExpr) };
  }
}

function myFrom(f: unknown, sel: Sel) {
  if (!isObj(f)) return;
  const alias = str(f.as);
  if (isObj(f.expr) && isObj(f.expr.ast)) sel.from.push({ sub: mySel(f.expr.ast), alias });
  else if (str(f.table)) sel.from.push({ name: str(f.table), schema: str(f.db), alias });
  if (f.on) sel.preds.push(myExpr(f.on));
  for (const u of arr(f.using)) { const n = isObj(u) ? str(u.value) : str(u); if (n) sel.using.push(n); }
}

// unionTail: nhánh cuối của UNION, ORDER BY/LIMIT của node-sql-parser ở đây thuộc cả cụm.
export function mySel(s: Obj, unionTail = false): Sel {
  const sel = emptySel();
  for (const c of arr(s.with)) {
    if (!isObj(c) || !isObj(c.name) || !str(c.name.value) || !isObj(c.stmt) || !isObj(c.stmt.ast)) continue;
    sel.ctes.push({ name: str(c.name.value)!, s: mySel(c.stmt.ast), recursive: c.recursive === true });
  }
  if (isObj(s._next)) {
    const { _next, ...head } = s;
    sel.union = [mySel({ ...head, with: null }), mySel(_next as Obj, true)];
    return sel;
  }
  for (const c of arr(s.columns)) if (isObj(c)) sel.items.push({ e: myExpr(c.expr), alias: str(c.as) });
  if (s.columns === "*") sel.items.push({ e: { t: "star" } });
  arr(s.from).forEach((f) => myFrom(f, sel));
  for (const p of [s.where, s.having]) if (p) sel.preds.push(myExpr(p));
  for (const g of arr(isObj(s.groupby) ? s.groupby.columns : s.groupby)) sel.preds.push(myExpr(g));
  if (!unionTail || s._next) for (const o of arr(s.orderby)) sel.preds.push(myExpr(isObj(o) ? o.expr : o));
  return sel;
}

function myDml(a: Obj): Sel | undefined {
  const sel = emptySel();
  const tableOf = (t: unknown) => arr(t).forEach((f) => isObj(f) && str(f.table) && !f.addition && sel.from.push({ name: str(f.table), schema: str(f.db), alias: str(f.as) }));
  if (a.type === "insert") {
    tableOf(a.table);
    const cols = arr(a.columns).filter((c): c is string => typeof c === "string");
    if (!cols.length) sel.items.push({ e: { t: "star", key: "insert-without-columns" } });
    cols.forEach((c) => sel.items.push({ e: { t: "col", name: c } }));
    const vals = isObj(a.values) ? a.values : undefined;
    if (vals && Array.isArray(vals.values)) {
      for (const row of vals.values) arr(isObj(row) ? row.value : []).forEach((x, i) => cols[i] && sel.preds.push({ t: "cmp", op: "=", l: { t: "col", name: cols[i] }, r: myExpr(x) }));
    } else if (isObj(a.values) && isObj(a.values.ast)) sel.preds.push(myExpr(a.values));
    else if (a.values && isObj(a.values)) sel.preds.push(myExpr(a.values));
  } else if (a.type === "update") {
    tableOf(a.table);
    for (const s of arr(a.set)) if (isObj(s) && str(s.column)) sel.preds.push({ t: "cmp", op: "=", l: { t: "col", name: str(s.column)! }, r: myExpr(s.value) });
    if (a.where) sel.preds.push(myExpr(a.where));
  } else if (a.type === "delete") {
    arr(a.from).forEach((f) => myFrom(f, sel));
    if (a.where) sel.preds.push(myExpr(a.where));
  } else return;
  return sel;
}

// Trả undefined cho câu không phải select/insert/update/delete.
export function toSel(ast: unknown, engine: EngineId): Sel | undefined {
  if (!isObj(ast)) return;
  if (engine === "postgres") {
    const k = Object.keys(ast)[0];
    return k === "SelectStmt" && isObj(ast[k]) ? pgSel(ast[k] as Obj) : pgDml(ast);
  }
  return ast.type === "select" ? mySel(ast) : myDml(ast);
}
