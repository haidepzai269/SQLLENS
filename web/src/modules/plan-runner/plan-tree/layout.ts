import { graphlib, layout } from "@dagrejs/dagre";
import type { Plan, PlanNode } from "@/contracts/plan";

export const NW = 248;
export const NH = 200;
const GAP = 24;
const RAIL_PAD = 20;
const RAIL_STEP = 14;
const RAIL_MAX_DEPTH = 4;
// Dưới ngưỡng này (bề rộng vùng vẽ, không phải màn hình) cây xếp một cột có đường rail bên trái.
export const NARROW = 560;

export type Pos = { x: number; y: number };
export type Flat = { node: PlanNode; depth: number; parent?: string };

// Duyệt tiền thứ tự: thứ tự này cũng là thứ tự Tab giữa các thẻ. Lặp thay vì đệ quy để plan sâu không tràn stack.
export function flatten(plan: Plan): Flat[] {
  const out: Flat[] = [];
  const seen = new Set<string>();
  const stack: Flat[] = [{ node: plan.root, depth: 0 }];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f.node.id)) continue; // id trùng: bỏ qua thay vì vẽ chồng hai thẻ
    seen.add(f.node.id);
    out.push(f);
    for (let i = f.node.children.length - 1; i >= 0; i--) stack.push({ node: f.node.children[i], depth: f.depth + 1, parent: f.node.id });
  }
  return out;
}

export function layoutPlan(flat: Flat[], narrow: boolean): Record<string, Pos> {
  if (narrow) {
    return Object.fromEntries(flat.map((f, i) => [f.node.id, { x: RAIL_PAD + Math.min(f.depth, RAIL_MAX_DEPTH) * RAIL_STEP, y: i * (NH + GAP) }]));
  }
  const g = new graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 64 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const f of flat) {
    g.setNode(f.node.id, { width: NW, height: NH });
    if (f.parent) g.setEdge(f.parent, f.node.id);
  }
  layout(g);
  const pos: Record<string, Pos> = {};
  for (const f of flat) {
    const n = g.node(f.node.id);
    pos[f.node.id] = { x: n.x - NW / 2, y: n.y - NH / 2 };
  }
  // dagre có thể đảo thứ tự anh em để giảm cắt cạnh, nhưng với plan trên là bảng ngoài, dưới là bảng trong.
  // Giữ nguyên các vị trí dagre tính, chỉ gán lại theo thứ tự duyệt tiền thứ tự trong từng tầng.
  const rows = new Map<number, Flat[]>();
  for (const f of flat) rows.set(f.depth, [...(rows.get(f.depth) ?? []), f]);
  for (const row of rows.values()) {
    const ys = row.map((f) => pos[f.node.id].y).sort((a, b) => a - b);
    row.forEach((f, i) => (pos[f.node.id] = { ...pos[f.node.id], y: ys[i] }));
  }
  return pos;
}

// So ước tính với thật phải tính loops: estimatedRows là mỗi lần chạy, actualRows là tổng các vòng.
export function expectedTotal(n: PlanNode): number | undefined {
  return n.estimatedRows === undefined ? undefined : n.estimatedRows * (n.loops ?? 1);
}

const RATIO = 10;
export function skew(n: PlanNode, analyzed: boolean): "more" | "less" | undefined {
  const e = expectedTotal(n);
  if (!analyzed || e === undefined || n.actualRows === undefined) return undefined;
  const r = (n.actualRows + 1) / (e + 1);
  return r >= RATIO ? "more" : r <= 1 / RATIO ? "less" : undefined;
}

export const signature = (flat: Flat[]) => flat.map((f) => f.node.id).join("|");
