import type { Plan, PlanKind, PlanNode } from "@/contracts/plan";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
// MySQL 8.4 đưa một số số dạng chuỗi ("100.00"); số dòng là số nguyên nhưng vẫn nhận cả chuỗi.
const num = (x: unknown) => {
  const n = typeof x === "string" && x.trim() !== "" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

// Chia sẻ bộ đếm id cho cả cây: id "n0", "n1"... theo thứ tự tạo, duy nhất trong một Plan.
type Ctx = { n: number };
const mk = (c: Ctx, label: string, kind: PlanKind, children: PlanNode[] = [], extra: Partial<PlanNode> = {}): PlanNode => ({
  id: String(c.n++),
  kind,
  label,
  children,
  ...extra,
});

// Mọi `query_block` con (subquery, union, bảng tạm) thành các nút con.
function subBlocks(o: Obj, c: Ctx): PlanNode[] {
  const out: PlanNode[] = [];
  // Mọi khóa dạng *_subqueries (attached, optimized_away, select_list, having, order_by...) và query_specifications.
  for (const [k, v] of Object.entries(o)) {
    if (!/subqueries$|^query_specifications$/.test(k) || !Array.isArray(v)) continue;
    for (const s of v.filter(isObj)) if (isObj(s.query_block)) out.push(block(s.query_block, c));
  }
  const m = o.materialized_from_subquery;
  if (isObj(m) && isObj(m.query_block)) out.push(block(m.query_block, c));
  return out;
}

function table(t: Obj, c: Ctx): PlanNode {
  const access = str(t.access_type) ?? "unknown";
  const key = str(t.key);
  const kind: PlanKind = access === "ALL" ? "seq_scan" : key ? (t.using_index === true ? "index_only_scan" : "index_scan") : "other";
  return mk(c, access, kind, subBlocks(t, c), {
    table: str(t.table_name),
    index: key,
    condition: str(t.index_condition) ?? str(t.attached_condition),
    // MySQL chỉ ước lượng (không có ANALYZE ở dạng JSON): rows_produced_per_join là số dòng sau lọc và sau mọi bảng trước.
    estimatedRows: num(t.rows_produced_per_join) ?? num(t.rows_examined_per_scan),
  });
}

// nested_loop là mảng phẳng của các bảng; MySQL nối trái-sang-phải, nên dựng cây lệch trái: ((t1 ⨝ t2) ⨝ t3).
function join(items: Obj[], c: Ctx): PlanNode {
  const first = items[0];
  let acc = isObj(first?.table) ? table(first.table, c) : mk(c, "unknown", "other");
  for (const it of items.slice(1)) {
    const t = isObj(it.table) ? table(it.table, c) : mk(c, "unknown", "other");
    const hash = isObj(it.table) && str(it.table.using_join_buffer)?.includes("hash");
    acc = mk(c, hash ? "hash join" : "nested loop", hash ? "hash_join" : "nested_loop", [acc, t]);
  }
  return acc;
}

const WRAP: Record<string, PlanKind> = { ordering_operation: "sort", grouping_operation: "aggregate", duplicates_removal: "other", windowing: "other", buffer_result: "other" };

// Một khối chứa đúng một trong: bảng, nested_loop, union_result, message, hoặc một lớp bọc quanh các thứ đó.
function inner(o: Obj, c: Ctx): PlanNode | undefined {
  if (Array.isArray(o.nested_loop)) return join(o.nested_loop.filter(isObj), c);
  if (isObj(o.table)) return table(o.table, c);
  if (isObj(o.union_result)) return mk(c, "union_result", "other", subBlocks(o.union_result, c));
  const msg = str(o.message);
  if (msg) return mk(c, msg, "other");
  for (const [k, kind] of Object.entries(WRAP)) {
    const w = o[k];
    if (!isObj(w)) continue;
    const child = inner(w, c);
    // ordering_operation không dùng filesort (đã sắp theo index) thì không có bước sắp xếp nào, nên không tạo nút sort.
    if (k === "ordering_operation" && w.using_filesort !== true) return child;
    return mk(c, k, kind, child ? [child] : []);
  }
  return undefined;
}

function block(q: Obj, c: Ctx): PlanNode {
  const root = inner(q, c) ?? mk(c, "query_block", "other");
  root.children.push(...subBlocks(q, c));
  return root;
}

/** Đọc `EXPLAIN FORMAT=JSON` của MySQL 8.4 (chuỗi JSON hoặc object). MySQL không cho số thật ở dạng JSON, nên `analyzed` luôn false và `actualRows`, `pagesRead` để trống. */
export function normalizeMysql(json: unknown): Plan {
  const v = typeof json === "string" ? (JSON.parse(json) as unknown) : json;
  if (!isObj(v) || !isObj(v.query_block)) throw new TypeError("Not a MySQL EXPLAIN JSON plan");
  return { engine: "mysql", analyzed: false, root: block(v.query_block, { n: 0 }) };
}
