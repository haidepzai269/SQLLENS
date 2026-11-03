import type { BTreeModel } from "@/contracts/btree";

export const NW = 168; // 3 ô khóa x 56 px
export const NH = 30;
export const CAP = 16; // dòng chú thích dưới node
export const GAP = 12;
export const ROW = 80;
export const PAD = 16;
export const LANE = 72;
export const MIN_GAP = 8; // EXPERIENCE Y1

export type Item = { id: string; level: number; page?: number; count?: number; w: number; x: number; y: number };
export type Edge = { from: string; to: string; kind: "child" | "next"; lit: boolean };
export type Layout = { items: Item[]; edges: Edge[]; width: number; height: number };
export type Off = Record<string, { x: number; y: number }>;

export const pid = (page: number) => `p${page}`;
export const hid = (level: number) => `h${level}`;
export const clusterWidth = (count: number) => Math.max(72, `+${count} node`.length * 7.6 + 16);

// Thứ tự trong tầng: duyệt từ root theo children, trang còn lại xếp theo số trang.
function orderNodes(m: BTreeModel) {
  const byPage = new Map(m.nodes.map((n) => [n.page, n]));
  const seen = new Set<number>();
  const order: number[] = [];
  const queue = [m.rootPage];
  for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
    const n = byPage.get(p);
    if (!n || seen.has(p)) continue;
    seen.add(p);
    order.push(p);
    queue.push(...(n.children ?? []));
  }
  for (const n of [...m.nodes].sort((a, b) => a.page - b.page)) if (!seen.has(n.page)) order.push(n.page);
  return order.map((p) => byPage.get(p)!);
}

export function layoutTree(m: BTreeModel, pathPages: number[] = []): Layout {
  const height = Math.max(1, m.height);
  const clamp = (l: number) => Math.min(height - 1, Math.max(0, l));
  const rows: Item[][] = Array.from({ length: height }, () => []);
  for (const n of orderNodes(m)) rows[height - 1 - clamp(n.level)].push({ id: pid(n.page), level: clamp(n.level), page: n.page, w: NW, x: 0, y: 0 });
  for (const h of m.hidden) if (h.count > 0) rows[height - 1 - clamp(h.level)].push({ id: hid(clamp(h.level)), level: clamp(h.level), count: h.count, w: clusterWidth(h.count), x: 0, y: 0 });
  const items = rows.flat();
  const byId = new Map(items.map((i) => [i.id, i]));
  const onPath = new Set(pathPages);
  const edges: Edge[] = [];
  for (const n of m.nodes) {
    const from = pid(n.page);
    const lowerHidden = hid(clamp(n.level) - 1);
    let addedHidden = false;
    for (const c of n.children ?? []) {
      if (byId.has(pid(c))) edges.push({ from, to: pid(c), kind: "child", lit: onPath.has(n.page) && onPath.has(c) });
      else if (byId.has(lowerHidden) && !addedHidden) {
        addedHidden = true;
        // trang con trên đường đi bị ẩn thì nhánh tới khối hidden được tô
        edges.push({ from, to: lowerHidden, kind: "child", lit: onPath.has(n.page) && onPath.has(c) });
      }
    }
    if (n.next !== undefined && byId.has(pid(n.next))) edges.push({ from, to: pid(n.next), kind: "next", lit: false });
  }
  const kidsOf = new Map<string, Item[]>();
  for (const e of edges) if (e.kind === "child" && !e.to.startsWith("h")) kidsOf.set(e.from, [...(kidsOf.get(e.from) ?? []), byId.get(e.to)!]);
  // Leaf xếp sát trái; mỗi tầng trên đặt giữa các con đang hiện, không chồng nhau.
  let right = 0;
  for (let ri = height - 1; ri >= 0; ri--) {
    let prev = ri === height - 1 ? LANE + PAD - GAP : -Infinity;
    for (const it of rows[ri]) {
      const kids = kidsOf.get(it.id) ?? [];
      const want = kids.length ? kids.reduce((s, k) => s + k.x + k.w / 2, 0) / kids.length - it.w / 2 : -Infinity;
      it.x = Math.max(want, prev + GAP, LANE + PAD);
      it.y = PAD + ri * ROW;
      prev = it.x + it.w;
      right = Math.max(right, prev);
    }
  }
  return { items, edges, width: right + PAD, height: PAD * 2 + (height - 1) * ROW + NH + CAP };
}

type Rect = { id: string; x: number; y: number; w: number; h: number };
const hit = (a: Rect, b: Rect, g: number) => a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g;

// Đẩy rect `movedId` ra khỏi mọi rect khác tối thiểu `gap`, không ra khỏi góc (0,0). Trả vị trí mới.
export function settle(rects: Rect[], movedId: string, gap = MIN_GAP): { x: number; y: number } {
  const me = rects.find((r) => r.id === movedId)!;
  const others = rects.filter((r) => r.id !== movedId);
  const free = (x: number, y: number) => x >= 0 && y >= 0 && !others.some((o) => hit({ ...me, x, y }, o, gap));
  if (free(me.x, me.y)) return { x: me.x, y: me.y };
  const cand: { x: number; y: number }[] = [];
  for (const o of others.filter((o) => hit(me, o, gap))) {
    cand.push({ x: o.x - gap - me.w, y: me.y }, { x: o.x + o.w + gap, y: me.y }, { x: me.x, y: o.y - gap - me.h }, { x: me.x, y: o.y + o.h + gap });
  }
  const ok = cand.filter((c) => free(c.x, c.y)).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
  if (ok[0]) return ok[0];
  // shortcut: dồn xuống dưới mọi rect khi các hướng gần đều kín; đủ vì canvas cuộn được.
  return { x: Math.max(0, me.x), y: Math.max(0, ...others.map((o) => o.y + o.h + gap)) };
}
