import { arr, lc, part, rec, table, text, walk, type Adapter, type Cat, type Pred, type Rec, type Scope, type Schema, type Source, type X } from "./types";

const OTHER: X = { k: "other" };

export function myX(n: unknown): X {
  const r = rec(n);
  if (!r) return OTHER;
  if (r.type === "column_ref") return text(r.column) && r.column !== "*" ? { k: "col", q: text(r.table), name: String(r.column) } : OTHER;
  if (r.type === "number") return { k: "num", v: String(r.value) };
  if (/^(single_quote_string|double_quote_string|string)$/.test(String(r.type))) return { k: "str", v: String(r.value ?? "") };
  if (r.type === "function") {
    const names = arr(rec(r.name)?.name).map((p) => text(rec(p)?.value)).filter((s): s is string => !!s);
    return names.length ? { k: "fn", name: lc(names[names.length - 1]), args: arr(rec(r.args)?.value).map(myX) } : OTHER;
  }
  return OTHER;
}

const CMP = new Set(["=", "<>", "!=", "<", ">", "<=", ">=", "<=>"]);

function preds(n: unknown, top: boolean, out: Pred[]) {
  const r = rec(n);
  // shortcut: chỉ đọc binary_expr, NOT và unary bỏ qua nên `NOT (lower(x)='a')` không báo; thêm khi cần.
  if (!r || r.type !== "binary_expr") return;
  const op = String(r.operator).toUpperCase();
  const l = myX(r.left);
  const items = arr(rec(r.right)?.value);
  if (op === "AND") [r.left, r.right].forEach((x) => preds(x, top, out));
  else if (op === "OR") [r.left, r.right].forEach((x) => preds(x, false, out));
  else if (op === "LIKE") out.push({ k: "like", l, r: myX(r.right), top });
  else if (op === "IN") (items.length ? items : [null]).forEach((i) => out.push({ k: "cmp", op: "=", l, r: myX(i), top }));
  else if (op === "BETWEEN") out.push({ k: "cmp", op: ">=", l, r: OTHER, top });
  else if (op === "IS") out.push({ k: "cmp", op: "is", l, r: OTHER, top });
  else if (CMP.has(op)) out.push({ k: "cmp", op, l, r: myX(r.right), top });
}

const typeCat = (t: unknown): Cat => {
  const n = lc(text(rec(t)?.dataType) ?? "");
  if (/^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real)$/.test(n)) return "number";
  return /^(char|varchar|tinytext|text|mediumtext|longtext)$/.test(n) ? "text" : "other";
};

// Mục trong CREATE TABLE hoặc ALTER ... ADD.
function def(s: Schema, t: string, d: Rec) {
  if (d.resource === "column") {
    const c = text(rec(d.column)?.column);
    if (!c) return;
    table(s, t).cols.set(lc(c), typeCat(d.definition));
    if (d.primary_key || d.unique) table(s, t).indexes.push({ btree: true, parts: [{ key: lc(c), col: lc(c) }] });
    return;
  }
  const kind = `${d.keyword ?? ""} ${d.constraint_type ?? ""}`.toLowerCase();
  if (d.resource !== "index" && !/primary|unique/.test(kind)) return;
  const parts = arr(d.definition).map((c) => part(myX(c)));
  if (parts.length) table(s, t).indexes.push({ btree: !/fulltext|spatial/.test(kind) && d.index_type !== "hash", parts });
}

const tname = (x: unknown) => lc(text(rec(arr(x)[0] ?? x)?.table) ?? "");

function sources(items: unknown[], ctes: Set<string>, out: Pred[]): Source[] {
  return items.map((i) => {
    const r = rec(i);
    if (r?.on) preds(r.on, true, out);
    const name = lc(text(r?.table) ?? "");
    return { name: !name || (!r?.db && ctes.has(name)) ? undefined : name, alias: text(r?.as) ? lc(String(r!.as)) : undefined };
  });
}

export const mysql: Adapter = {
  schema(ast, s) {
    const r = rec(ast);
    const t = tname(r?.table);
    if (!r || !t) return;
    if (r.type === "create" && r.keyword === "table") {
      table(s, t, true);
      arr(r.create_definitions).forEach((d) => def(s, t, rec(d) ?? {}));
    } else if (r.type === "create" && r.keyword === "index") {
      const kind = String(r.index_type ?? "").toLowerCase();
      table(s, t).indexes.push({ btree: !/fulltext|spatial/.test(kind) && r.index_using !== "hash", parts: arr(r.index_columns).map((c) => part(myX(c))) });
    } else if (r.type === "alter") {
      arr(r.expr).forEach((e) => rec(e)?.action === "add" && def(s, t, rec(e)!));
    }
  },
  scopes(ast) {
    const ctes = new Set<string>();
    walk(ast, (n) => {
      const c = text(rec(n.name)?.value);
      if (c && "stmt" in n) ctes.add(lc(c));
    });
    const out: Scope[] = [];
    walk(ast, (n) => {
      if (n.type !== "select" && n.type !== "update" && n.type !== "delete") return;
      const p: Pred[] = [];
      const src = sources(arr(n.type === "update" ? n.table : n.from), ctes, p);
      preds(n.where, true, p);
      out.push({ sources: src, preds: p });
    });
    return out;
  },
};
