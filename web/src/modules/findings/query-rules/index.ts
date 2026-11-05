import type { EngineId } from "@/contracts/engine";
import type { RuleHit } from "@/contracts/finding";
import type { ParsedStatement } from "@/modules/sql-intake/parser/types";
import { mysql } from "./mysql";
import { pg } from "./pg";
import { colsIn, key, lc, type Pred, type Schema, type Scope, type X } from "./types";

// Luật chỉ đọc câu và index có trong đầu vào, chưa chạy gì nên chưa có nhãn: STR041 gắn nhãn và bằng chứng.
// Không có thông tin index hoặc kiểu cột thì luật cần chúng im lặng, không đoán.

const SKIP = new Set(["create_table", "create_index", "alter_table", "drop", "transaction", "set"]);
const CMP_OPS = new Set(["=", "<>", "!=", "<", ">", "<=", ">="]);
type Col = Extract<X, { k: "col" }>;

function resolve(c: Col, scope: Scope, schema: Schema): string | undefined {
  const { sources } = scope;
  const name = lc(c.name);
  if (c.q) {
    const q = lc(c.q);
    const m = sources.filter((s) => (s.alias ?? s.name) === q);
    return m.length === 1 ? m[0].name : undefined;
  }
  if (sources.length === 1) {
    const s = sources[0];
    const t = s.name ? schema.get(s.name) : undefined;
    // shortcut: subquery tương quan có thể trỏ cột ra bảng ngoài; chỉ chặn được khi biết đủ cột của bảng trong.
    return s.name && !(t?.declared && !t.cols.has(name)) ? s.name : undefined;
  }
  if (sources.some((s) => !s.name || !schema.get(s.name)?.declared)) return undefined;
  const m = sources.filter((s) => schema.get(s.name!)!.cols.has(name));
  return m.length === 1 ? m[0].name : undefined;
}

type Emit = (ruleId: string, x: X, table: string, column: string, values: Record<string, string | number>) => void;

function runScope(scope: Scope, schema: Schema, emit: Emit, engine: EngineId) {
  const tbl = (c: Col) => {
    const t = resolve(c, scope, schema);
    return t ? { name: t, info: schema.get(t) } : undefined;
  };
  const sides = (p: Pred) => [p.l, p.r];

  for (const p of scope.preds) {
    // function-on-indexed-column
    for (const x of sides(p)) {
      if (x.k !== "fn") continue;
      for (const c of colsIn(x)) {
        const t = tbl(c);
        const idx = t?.info?.indexes.filter((i) => i.btree) ?? [];
        if (!t || idx.some((i) => i.parts.some((q) => q.key !== null && q.key === key(x)))) break; // có expression index khớp
        if (idx.some((i) => i.parts.some((q) => q.col === lc(c.name)))) {
          emit("function-on-indexed-column", x, t.name, lc(c.name), { function: x.name });
          break;
        }
      }
    }

    // leading-wildcard
    if (p.k === "like" && p.l.k === "col" && p.r.k === "str" && /^[%_]/.test(p.r.v)) {
      const t = tbl(p.l);
      const col = lc(p.l.name);
      const has = (btree: boolean) => t?.info?.indexes.some((i) => i.btree === btree && i.parts.some((q) => q.col === col));
      // index gin/gist (vd pg_trgm) trên cột đó có thể phục vụ LIKE '%x', nên không báo.
      if (t && has(true) && !has(false)) emit("leading-wildcard", p.l, t.name, col, { pattern: p.r.v });
    }

    // implicit-cast
    if (p.k === "cmp" && CMP_OPS.has(p.op)) {
      for (const [c, v] of [[p.l, p.r], [p.r, p.l]]) {
        if (c.k !== "col" || (v.k !== "str" && v.k !== "num")) continue;
        const t = tbl(c);
        const cat = t?.info?.cols.get(lc(c.name));
        const dir = cat === "number" && v.k === "str" ? "number-vs-string" : cat === "text" && v.k === "num" ? "string-vs-number" : undefined;
        if (!t || !dir) continue;
        // PostgreSQL: literal chuỗi tự nhận kiểu cột (index vẫn dùng được), còn cột chữ so với số thì báo lỗi.
        // MySQL: chuỗi đổi thành số một lần, nhưng cột chữ so với số thì mỗi dòng bị ép kiểu nên index không dùng được.
        const effect = dir === "number-vs-string" ? "literalCast" : engine === "postgres" ? "error" : "columnCast";
        emit("implicit-cast", c, t.name, lc(c.name), { direction: dir, effect, literal: v.v });
      }
    }
  }

  // composite-prefix: chỉ xét điều kiện nối bằng AND, vì dưới OR không biết nhánh nào chạy.
  const used = new Map<string, Map<string, X>>(); // bảng -> khóa -> nút để tô
  const add = (x: X, op: string, like = false) => {
    const k = key(x);
    const c = colsIn(x)[0];
    const t = c && k ? tbl(c) : undefined;
    if (!t || !k || op === "<>" || op === "!=" || like) return;
    if (!used.has(t.name)) used.set(t.name, new Map());
    if (!used.get(t.name)!.has(k)) used.get(t.name)!.set(k, x);
  };
  for (const p of scope.preds) {
    if (!p.top) continue;
    if (p.k === "cmp") sides(p).forEach((x) => add(x, p.op));
    else add(p.l, "like", p.r.k !== "str" || /^[%_]/.test(p.r.v));
  }
  // shortcut: không biết số giá trị riêng của cột đầu nên không tính skip scan (PostgreSQL 18, MySQL 8); STR041 không được viết là index chắc chắn không dùng được.
  for (const [name, hit] of used) {
    const indexes = schema.get(name)?.indexes.filter((i) => i.btree) ?? [];
    if (indexes.some((i) => i.parts[0]?.key && hit.has(i.parts[0].key))) continue; // có index dùng được cột đầu
    for (const i of indexes) {
      if (i.parts.length < 2) continue;
      const q = i.parts.slice(1).find((p) => p.key && hit.has(p.key));
      if (!q) continue;
      const first = i.parts.map((p) => p.key ?? "(biểu thức)");
      emit("composite-prefix", hit.get(q.key!)!, name, q.col ?? q.key!, { index: first.join(", "), leading: first[0] });
    }
  }
}

// sql (tùy chọn): có thì PostgreSQL tô đúng biểu thức (vị trí trong ast là byte, cần sql để đổi sang ký tự). MySQL ast không có vị trí nên luôn tô cả câu.
export function checkQueries(statements: ParsedStatement[], engine: EngineId, sql?: string): RuleHit[] {
  const adapter = engine === "postgres" ? pg : mysql;
  const schema: Schema = new Map();
  for (const s of statements) {
    try {
      adapter.schema(s.ast, schema);
    } catch {
      // câu parser không đọc được: bỏ qua
    }
  }
  const bytes = sql === undefined ? undefined : new TextEncoder().encode(sql);
  const toChar = (b: number) => new TextDecoder().decode(bytes!.subarray(0, b)).length;
  const hits = new Map<string, RuleHit>();

  for (const s of statements) {
    if (SKIP.has(s.kind)) continue;
    let scopes: Scope[] = [];
    try {
      scopes = adapter.scopes(s.ast);
    } catch {
      continue;
    }
    const emit: Emit = (ruleId, x, table, column, values) => {
      let start = s.start;
      let end = s.end;
      const pos = "pos" in x ? x.pos : undefined;
      if (sql !== undefined && pos !== undefined) {
        const a = toChar(pos);
        if (a >= s.start && a < s.end) {
          start = a;
          end = Math.min(s.end, exprEnd(sql, a));
        }
      }
      const id = [ruleId, s.index, table, column, start].join("|");
      if (!hits.has(id)) hits.set(id, { ruleId, messageKey: `findings.query.${ruleId}`, values: { table, column, ...values }, table, column, statementIndex: s.index, start, end });
    };
    for (const sc of scopes) runScope(sc, schema, emit, engine);
  }
  return [...hits.values()];
}

// shortcut: đoán điểm cuối bằng tên (có thể có dấu chấm) và cặp ngoặc đầu tiên, không hiểu chuỗi chứa ngoặc; thêm khi ast có vị trí cuối.
function exprEnd(sql: string, from: number): number {
  const e = from + (/^[\w."$`]+/.exec(sql.slice(from))?.[0].length ?? 0);
  const open = /^\s*\(/.exec(sql.slice(e));
  if (open) {
    let depth = 0;
    for (let i = e + open[0].length - 1; i < sql.length; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")" && --depth === 0) return i + 1;
    }
  }
  return Math.max(e, from + 1);
}
