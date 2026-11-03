import type { Plan, PlanKind, PlanNode } from "@/contracts/plan";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

const KIND: Record<string, PlanKind> = {
  "Seq Scan": "seq_scan",
  "Index Scan": "index_scan",
  "Index Only Scan": "index_only_scan",
  "Bitmap Heap Scan": "bitmap_scan",
  "Bitmap Index Scan": "bitmap_scan",
  "Nested Loop": "nested_loop",
  "Hash Join": "hash_join",
  "Merge Join": "merge_join",
  Hash: "hash",
  Sort: "sort",
  "Incremental Sort": "sort",
  Aggregate: "aggregate",
  Limit: "limit",
};

const buffers = (n: Obj) => {
  const hit = num(n["Shared Hit Blocks"]);
  const read = num(n["Shared Read Blocks"]);
  return hit === undefined && read === undefined ? undefined : (hit ?? 0) + (read ?? 0);
};

// Nút con đệ quy; kế hoạch rất sâu vẫn an toàn tới vài nghìn tầng (giới hạn của call stack JS).
function node(n: Obj, id: string): PlanNode {
  const kids = (Array.isArray(n.Plans) ? n.Plans : []).filter(isObj);
  // Buffers của PostgreSQL tính cả nút con, nên pagesRead của chính nút này = nó trừ tổng các con (không âm).
  const total = buffers(n);
  const childTotal = kids.reduce((s, k) => s + (buffers(k) ?? 0), 0);
  const loops = num(n["Actual Loops"]);
  const perLoop = num(n["Actual Rows"]);
  const label = str(n["Node Type"]) ?? "unknown";
  return {
    id,
    kind: KIND[label] ?? "other",
    label,
    table: str(n["Relation Name"]),
    index: str(n["Index Name"]),
    condition: ["Index Cond", "Hash Cond", "Merge Cond", "Join Filter", "Filter", "Recheck Cond"].map((k) => str(n[k])).find(Boolean),
    // Plan Rows là ước lượng cho MỘT lần chạy nút; giữ nguyên, kèm `loops` để người dùng tự nhân.
    estimatedRows: num(n["Plan Rows"]),
    // Actual Rows của PostgreSQL là trung bình mỗi vòng lặp; đây là TỔNG qua mọi vòng (Actual Rows x Actual Loops).
    actualRows: perLoop === undefined ? undefined : perLoop * (loops ?? 1),
    loops,
    pagesRead: total === undefined ? undefined : Math.max(0, total - childTotal),
    children: kids.map((k, i) => node(k, `${id}.${i}`)),
  };
}

/** Đọc kết quả `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS)`: chuỗi JSON, mảng `[{Plan}]` hoặc `{Plan}`. Ném TypeError nếu không có `Plan`. */
export function normalizePostgres(json: unknown): Plan {
  const v = typeof json === "string" ? (JSON.parse(json) as unknown) : json;
  const top = Array.isArray(v) ? v[0] : v;
  if (!isObj(top) || !isObj(top.Plan)) throw new TypeError("Not a PostgreSQL EXPLAIN JSON plan");
  // Chỉ lấy các trường số dòng, trang, tên; mọi trường thời gian ("Actual Total Time", "Execution Time"...) bị bỏ.
  return { engine: "postgres", analyzed: num(top.Plan["Actual Rows"]) !== undefined, root: node(top.Plan, "0") };
}
