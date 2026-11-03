import type { ParseError, ParseOutcome, ParsedStatement, StatementKind } from "./types";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null;
const str = (x: unknown) => (typeof x === "string" && x ? x : undefined);
// Cả hai engine ra cùng dạng: `schema.tên` hoặc `tên`, không trùng, sắp theo bảng chữ cái (hai parser duyệt cây khác thứ tự).
const qualify = (schema: unknown, name: string) => (str(schema) ? `${str(schema)}.${name}` : name);
const uniq = (xs: string[]) => [...new Set(xs)].sort();

export function lineCol(sql: string, position: number): Pick<ParseError, "line" | "column"> {
  const p = Math.max(0, Math.min(position, sql.length));
  const before = sql.slice(0, p);
  return { line: before.split("\n").length, column: p - before.lastIndexOf("\n") };
}

export const failure = (sql: string, message: string, position?: number): ParseOutcome => ({
  ok: false,
  error: position === undefined ? { message } : { message, position, ...lineCol(sql, position) },
});

// libpg-query trả vị trí câu theo byte UTF-8, đổi sang vị trí ký tự JS.
function byteToChar(sql: string): (b: number) => number {
  if (!/[^\x00-\x7f]/.test(sql)) return (b) => b;
  const map: number[] = [];
  let i = 0;
  for (const ch of sql) {
    const cp = ch.codePointAt(0)!;
    const bytes = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    for (let k = 0; k < bytes; k++) map.push(i);
    i += ch.length;
  }
  map.push(i);
  return (b) => map[Math.min(b, map.length - 1)];
}

const cpToIndex = (sql: string, cp: number) => {
  let i = 0;
  for (let n = 0; n < cp && i < sql.length; n++) i += sql.codePointAt(i)! > 0xffff ? 2 : 1;
  return i;
};

const trimRange = (sql: string, s: number, e: number): [number, number] => {
  while (s < e && /\s/.test(sql[s])) s++;
  while (e > s && /\s/.test(sql[e - 1])) e--;
  return [s, e];
};

// ---- PostgreSQL ----

const PG_KIND: Record<string, StatementKind> = {
  CreateStmt: "create_table",
  AlterTableStmt: "alter_table",
  IndexStmt: "create_index",
  DropStmt: "drop",
  SelectStmt: "select",
  InsertStmt: "insert",
  UpdateStmt: "update",
  DeleteStmt: "delete",
  TransactionStmt: "transaction",
  VariableSetStmt: "set",
};

// Tên trong thân CTE không đệ quy là bảng thật (`WITH t AS (SELECT * FROM t)`), nên chỉ lọc tên CTE ở ngoài thân, hoặc mọi nơi khi RECURSIVE.
function pgTables(root: unknown): string[] {
  const out: string[] = [];
  const outer: string[] = [];
  const ctes = new Set<string>();
  const declared = new Set<string>(); // CTE đã khai báo tại điểm đang duyệt
  let recursive = false;
  let depth = 0;
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isObj(n)) return;
    if (isObj(n.withClause) && n.withClause.recursive === true) recursive = true;
    const cte = n.CommonTableExpr;
    if (isObj(cte) && str(cte.ctename)) {
      const name = str(cte.ctename)!;
      ctes.add(name);
      if (recursive) declared.add(name);
      depth++;
      Object.values(n).forEach(walk);
      depth--;
      declared.add(name);
      return;
    }
    // RangeVar có lúc bọc trong khóa `RangeVar` (FROM), có lúc đứng trần ở `relation` (INSERT, CREATE, ALTER).
    if (str(n.relname)) {
      const t = qualify(n.schemaname, str(n.relname)!);
      if (!depth) outer.push(t);
      else if (!declared.has(t)) out.push(t);
    }
    const drop = n.DropStmt;
    if (isObj(drop) && drop.removeType === "OBJECT_TABLE" && Array.isArray(drop.objects)) {
      for (const o of drop.objects) {
        const items = isObj(o) && isObj(o.List) && Array.isArray(o.List.items) ? o.List.items : [];
        const names = items.map((i) => (isObj(i) && isObj(i.String) ? str(i.String.sval) : undefined)).filter((x): x is string => !!x);
        if (names.length) outer.push(names.slice(-2).join("."));
      }
    }
    Object.values(n).forEach(walk);
  };
  walk(root);
  const isCte = (t: string) => ctes.has(t) && !t.includes(".");
  // Tên CTE xuất hiện như một RangeVar không có schema, không phải bảng thật.
  return uniq([...out, ...outer.filter((t) => !isCte(t))]);
}

export type PgParser = (sql: string) => { stmts: { stmt: unknown; stmt_location?: number | null; stmt_len?: number | null }[] };

export function parsePostgres(sql: string, parseSync: PgParser): ParseOutcome {
  if (!/\S/.test(sql)) return { ok: true, statements: [] };
  let res: ReturnType<PgParser>;
  try {
    res = parseSync(sql);
  } catch (e) {
    const d = (e as { sqlDetails?: { cursorPosition?: number } }).sqlDetails;
    // cursorPosition đếm từ 0 theo code point (không phải UTF-16), đổi sang chỉ số chuỗi JS để emoji không làm lệch.
    const cp = typeof d?.cursorPosition === "number" ? d.cursorPosition : undefined;
    return failure(sql, e instanceof Error ? e.message : String(e), cp === undefined ? undefined : cpToIndex(sql, cp));
  }
  const toChar = byteToChar(sql);
  const bytes = new TextEncoder().encode(sql).length;
  const statements: ParsedStatement[] = res.stmts.map((s, index) => {
    const from = s.stmt_location ?? 0;
    // stmt_len 0 nghĩa là đến hết chuỗi.
    const to = s.stmt_len ? from + s.stmt_len : bytes;
    const [start, end] = trimRange(sql, toChar(from), toChar(to));
    const key = isObj(s.stmt) ? Object.keys(s.stmt)[0] : "";
    return { index, kind: PG_KIND[key] ?? "other", start, end, tables: pgTables(s.stmt), ast: s.stmt };
  });
  return { ok: true, statements };
}

// ---- MySQL ----

// Tách câu theo `;`, bỏ qua `;` trong chuỗi, tên bọc backtick và comment. Bỏ đoạn chỉ có comment.
// shortcut: không hiểu `DELIMITER` (lệnh của client mysql, không phải SQL), thêm khi có kịch bản trigger/procedure.
export function splitMysql(sql: string): [number, number][] {
  const out: [number, number][] = [];
  let first = -1;
  const push = (end: number) => {
    if (first >= 0) out.push(trimRange(sql, first, end));
    first = -1;
  };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === "/*") {
      const j = sql.indexOf("*/", i + 2);
      i = j < 0 ? sql.length : j + 2;
    } else if (c === "#" || (two === "--" && (i + 2 >= sql.length || /\s/.test(sql[i + 2])))) {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? sql.length : j + 1;
    } else if (c === ";") {
      push(i);
      i++;
    } else {
      if (first < 0 && !/\s/.test(c)) first = i;
      if (c === "'" || c === '"' || c === "`") {
        i++;
        while (i < sql.length) {
          if (sql[i] === "\\" && c !== "`") i += 2;
          else if (sql[i] === c) {
            if (sql[i + 1] === c) i += 2;
            else break;
          } else i++;
        }
      }
      i++;
    }
  }
  push(sql.length);
  return out;
}

const MY_KIND: Record<string, StatementKind> = {
  alter: "alter_table",
  drop: "drop",
  select: "select",
  insert: "insert",
  update: "update",
  delete: "delete",
  transaction: "transaction",
  set: "set",
};

function myKind(ast: unknown): StatementKind {
  if (!isObj(ast)) return "other";
  if (ast.type === "create") return ast.keyword === "table" ? "create_table" : ast.keyword === "index" ? "create_index" : "other";
  return MY_KIND[String(ast.type)] ?? "other";
}

function myTables(root: unknown): string[] {
  const inner: string[] = [];
  const outer: string[] = [];
  const ctes = new Set<string>();
  const declared = new Set<string>(); // CTE đã khai báo tại điểm đang duyệt
  let depth = 0;
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isObj(n)) return;
    // WITH: { name: { value }, stmt, recursive }
    const isCte = isObj(n.name) && !!str(n.name.value) && "stmt" in n;
    let cteName = "";
    if (isCte) {
      cteName = str((n.name as Obj).value)!;
      ctes.add(cteName);
      if (n.recursive === true) declared.add(cteName);
      depth++;
    }
    // Mục bảng có `table` là chuỗi; tham chiếu cột (`column_ref`, có `column`) thì bỏ.
    if (str(n.table) && n.type !== "column_ref" && !("column" in n)) {
      const t = qualify(n.db, str(n.table)!);
      if (!depth) outer.push(t);
      else if (!declared.has(t)) inner.push(t);
    }
    Object.values(n).forEach(walk);
    if (isCte) {
      depth--;
      declared.add(cteName);
    }
  };
  walk(root);
  const isCteName = (t: string) => ctes.has(t) && !t.includes(".");
  // Như PostgreSQL: tên trong thân CTE không đệ quy là bảng thật.
  return uniq([...inner, ...outer.filter((t) => !isCteName(t))]);
}

export type MyParser = { astify(sql: string, opt: { database: string }): unknown };

export function parseMysql(sql: string, parser: MyParser): ParseOutcome {
  const statements: ParsedStatement[] = [];
  for (const [start, end] of splitMysql(sql)) {
    try {
      const r = parser.astify(sql.slice(start, end), { database: "mysql" });
      const ast = Array.isArray(r) ? r[0] : r;
      statements.push({ index: statements.length, kind: myKind(ast), start, end, tables: myTables(ast), ast });
    } catch (e) {
      const off = (e as { location?: { start?: { offset?: number } } }).location?.start?.offset;
      return failure(sql, e instanceof Error ? e.message : String(e), start + (typeof off === "number" ? off : 0));
    }
  }
  return { ok: true, statements };
}
