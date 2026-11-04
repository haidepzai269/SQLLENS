import type { PlanKind, PlanNode } from "@/contracts/plan";
import type { EngineId } from "@/contracts/engine";

export type JoinKind = "nested_loop" | "hash_join" | "merge_join";

// Mẫu minh họa nhỏ, cố định. Không phải dữ liệu của người dùng và không lấy từ plan.
export const OUTER = [1, 3, 4, 6];
export const INNER = [1, 2, 3, 3, 5, 6];
export const BUCKETS = 3;

export type JoinStep = {
  msg: string;
  vals: Record<string, number>;
  a: number; // con trỏ bảng ngoài (-1: chưa có)
  b: number; // con trỏ bảng trong (-1: chưa có)
  bucket: number; // ô băm đang dùng (-1: không)
  probed: number[]; // dòng bảng trong được dò ở bước này
  hits: number[]; // dòng bảng trong khớp khóa ở bước này
  built: number; // số dòng đã vào bảng băm
  compares: number; // tổng số lần so khóa đến hết bước này
  out: number; // tổng số cặp khớp đến hết bước này
};

export const START: JoinStep = { msg: "idle", vals: {}, a: -1, b: -1, bucket: -1, probed: [], hits: [], built: 0, compares: 0, out: 0 };
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export function buildJoinSteps(kind: JoinKind, indexedInner = false): JoinStep[] {
  const out: JoinStep[] = [];
  let prev = START;
  const add = (s: Partial<JoinStep> & Pick<JoinStep, "msg">) => {
    const n = out.length + 1;
    const cur: JoinStep = { ...prev, probed: [], hits: [], bucket: -1, ...s, vals: { n, ...s.vals } };
    out.push(cur);
    prev = cur;
  };
  if (kind === "nested_loop") {
    OUTER.forEach((k, i) => {
      const hits = INNER.flatMap((v, j) => (v === k ? [j] : []));
      const probed = indexedInner ? hits : range(INNER.length);
      const cmp = indexedInner ? 1 : INNER.length; // tra index tính một lần so khóa
      add({ msg: `${indexedInner ? "nlIndex" : "nl"}${hits.length ? "" : "Miss"}`, a: i, probed, hits, compares: prev.compares + cmp, out: prev.out + hits.length, vals: { key: k, cmp, hits: hits.length } });
    });
  } else if (kind === "hash_join") {
    const table: number[][] = Array.from({ length: BUCKETS }, () => []);
    INNER.forEach((v, j) => {
      table[v % BUCKETS].push(j);
      add({ msg: "build", b: j, bucket: v % BUCKETS, built: j + 1, vals: { key: v, bucket: v % BUCKETS } });
    });
    OUTER.forEach((k, i) => {
      const cell = table[k % BUCKETS];
      const hits = cell.filter((j) => INNER[j] === k);
      add({ msg: hits.length ? "probe" : "probeMiss", a: i, bucket: k % BUCKETS, probed: cell, hits, compares: prev.compares + cell.length, out: prev.out + hits.length, vals: { key: k, bucket: k % BUCKETS, cmp: cell.length, hits: hits.length } });
    });
  } else {
    let i = 0;
    let j = 0;
    while (i < OUTER.length && j < INNER.length) {
      const a = OUTER[i];
      const b = INNER[j];
      const eq = a === b;
      add({ msg: eq ? "mergeEq" : a < b ? "mergeLt" : "mergeGt", a: i, b: j, probed: [j], hits: eq ? [j] : [], compares: prev.compares + 1, out: prev.out + (eq ? 1 : 0), vals: { a, b } });
      if (a < b) i++;
      else j++; // bằng nhau hoặc a > b: bảng ngoài không trùng khóa nên chỉ cần đẩy bảng trong
    }
  }
  return out;
}

// Chỉ ba loại join mới mô phỏng được; Merge Join không có trên MySQL.
export function joinSupport(node: PlanNode, engine: EngineId): { kind: JoinKind } | { reason: "notJoin" | "noMerge" } {
  const k: PlanKind = node.kind;
  if (k === "merge_join" && engine === "mysql") return { reason: "noMerge" };
  if (k === "nested_loop" || k === "hash_join" || k === "merge_join") return { kind: k };
  return { reason: "notJoin" };
}

export const isIndexed = (n: PlanNode) => ["index_scan", "index_only_scan"].includes(n.children[1]?.kind ?? "");

// Số dòng của plan thật theo quy ước Task046: actualRows là tổng, estimatedRows là mỗi lần chạy nên nhân với loops.
export function planRows(n: PlanNode): { real: number } | { est: number } | null {
  const ok = (v?: number): v is number => v !== undefined && Number.isFinite(v) && v >= 0;
  if (ok(n.actualRows)) return { real: n.actualRows };
  if (ok(n.estimatedRows)) return { est: Math.round(n.estimatedRows * (ok(n.loops) ? n.loops : 1)) };
  return null;
}
