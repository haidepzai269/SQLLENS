import dagre from "@dagrejs/dagre";
import type { TableInfo } from "@/modules/data-lab/generate/plan-data";

export const CARD_W = 248;
export const HEAD_H = 40;
export const ROW_H = 26;
export const PAD_Y = 8;
export const GAP = 8; // Y1: khoảng cách tối thiểu giữa hai thẻ sau khi thả
export const NARROW_MAX = 560;
export const COLLAPSE_OVER = 30;

export type Pos = { x: number; y: number };
export type Edge = { id: string; source: string; target: string; sourceCol: string; targetCol: string };

export const tableKey = (t: TableInfo) => `${t.schema}.${t.name}`;
export const cardHeight = (t: TableInfo, collapsed: boolean) =>
  HEAD_H + (collapsed ? 0 : t.columns.length * ROW_H + PAD_Y);

/** FK thành cạnh. Bảng cha chỉ có tên nên ưu tiên cùng schema; cha không có trong danh sách thì đếm vào `missing`. */
export function relations(tables: TableInfo[]) {
  const byName = new Map<string, TableInfo[]>();
  for (const t of tables) byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
  const edges: Edge[] = [];
  const missing: { from: string; column: string; table: string }[] = [];
  for (const t of tables) {
    for (const c of t.columns) {
      if (!c.references) continue;
      const cands = byName.get(c.references.table);
      const parent = cands?.find((p) => p.schema === t.schema) ?? cands?.[0];
      if (!parent) missing.push({ from: t.name, column: c.name, table: c.references.table });
      else
        edges.push({
          id: `${tableKey(t)}.${c.name}->${tableKey(parent)}.${c.references.column}`,
          source: tableKey(t), target: tableKey(parent), sourceCol: c.name, targetCol: c.references.column,
        });
    }
  }
  return { edges, missing };
}

/** Bố cục chuẩn không chồng. Rộng: dagre trái sang phải. Hẹp: một cột, giữ thứ tự dagre. */
export function autoLayout(tables: TableInfo[], narrow: boolean, collapsed: boolean): Record<string, Pos> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 32, ranksep: 72, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of tables) g.setNode(tableKey(t), { width: CARD_W, height: cardHeight(t, collapsed) });
  for (const e of relations(tables).edges) if (e.source !== e.target) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const out: Record<string, Pos> = {};
  const nodes = tables.map((t) => {
    const n = g.node(tableKey(t));
    return { t, x: n.x - CARD_W / 2, y: n.y - n.height / 2 };
  });
  if (!narrow) {
    for (const n of nodes) out[tableKey(n.t)] = { x: n.x, y: n.y };
    return out;
  }
  let y = 0;
  for (const n of [...nodes].sort((a, b) => a.x - b.x || a.y - b.y)) {
    out[tableKey(n.t)] = { x: 0, y };
    y += cardHeight(n.t, collapsed) + 24;
  }
  return out;
}

export type Rect = { x: number; y: number; w: number; h: number };
const hit = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Y1: thẻ vừa thả chồng hoặc sát thẻ khác (< GAP) thì đẩy ra theo hướng gần nhất. */
export function separate(moved: Rect, others: Rect[], gap = GAP): Pos {
  let cur = { ...moved };
  for (let i = 0; i < others.length + 2; i++) {
    const o = others.find((r) => hit(cur, r, gap));
    if (!o) break;
    const c = cur;
    const cands: Pos[] = [
      { x: o.x - c.w - gap, y: c.y }, { x: o.x + o.w + gap, y: c.y },
      { x: c.x, y: o.y - c.h - gap }, { x: c.x, y: o.y + o.h + gap },
    ];
    const free = cands.filter((p) => !others.some((r) => hit({ ...c, ...p }, r, gap)));
    const pick = (free.length ? free : cands).reduce((a, b) =>
      Math.hypot(a.x - c.x, a.y - c.y) <= Math.hypot(b.x - c.x, b.y - c.y) ? a : b);
    cur = { ...c, ...pick };
  }
  return { x: cur.x, y: cur.y };
}

// Lưu vị trí: tách bản rộng và bản hẹp, mọi truy cập trong try/catch.
const storeKey = (narrow: boolean) => `sqllens.schema.${narrow ? "narrow" : "wide"}`;
export function loadPos(narrow: boolean): Record<string, Pos> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(storeKey(narrow)) ?? "{}");
    if (!v || typeof v !== "object") return {};
    const out: Record<string, Pos> = {};
    for (const [k, p] of Object.entries(v)) {
      const q = p as Partial<Pos> | null;
      if (q && Number.isFinite(q.x) && Number.isFinite(q.y)) out[k] = { x: q.x!, y: q.y! };
    }
    return out;
  } catch {
    return {};
  }
}
export function savePos(narrow: boolean, pos: Record<string, Pos> | null) {
  try {
    if (pos) localStorage.setItem(storeKey(narrow), JSON.stringify(pos));
    else localStorage.removeItem(storeKey(narrow));
  } catch {
    /* bị chặn: bỏ qua, sơ đồ vẫn chạy */
  }
}
