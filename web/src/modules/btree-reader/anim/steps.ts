import type { BTreeModel, BTreePath } from "@/contracts/btree";
import { planRange, type RangeEnd, type RangeError } from "./range";

export type StepKind = "root" | "internal" | "leaf" | "rootLeaf";
export type StepMsg = "internal" | "internalOpen" | "internalNoRange" | "hidden" | "leafFound" | "leafMissing" | "rangeStart" | "slide" | "heap" | "heapRange";
// src: chỉ số bước mà key đi từ đó tới (-1 cho bước đầu). slide: trượt ngang sang leaf bên phải.
// end: lý do dừng của range, chỉ có ở bước đọc leaf cuối.
export type Step = { n: number; page: number; heap: boolean; kind: StepKind; msg: StepMsg; vals: Record<string, string | number>; src: number; slide?: boolean; end?: RangeEnd };

const NEG_INF = "−∞";

export function rangeError(model: BTreeModel, path: BTreePath, to?: string): RangeError | undefined {
  if (to === undefined) return undefined;
  const r = planRange(model, path, to);
  return "error" in r ? r.error : undefined;
}

// Mỗi trang trên đường đi là một bước; có `to` thì thêm một bước cho mỗi leaf trượt sang, rồi một bước heap nếu có.
// Chỉ dùng số có trong model và path, không đoán.
export function buildSteps(model: BTreeModel, path: BTreePath, to?: string): Step[] {
  const plan = to === undefined ? undefined : planRange(model, path, to);
  if (plan && "error" in plan) return [];
  const byPage = new Map(model.nodes.map((n) => [n.page, n]));
  const last = path.pages.length - 1;
  const steps: Step[] = path.pages.map((page, i): Step => {
    const kind: StepKind = last === 0 ? "rootLeaf" : i === 0 ? "root" : i === last ? "leaf" : "internal";
    const base = { n: i + 1, page, heap: false, kind, src: i - 1 };
    const node = byPage.get(page);
    if (!node) return { ...base, msg: "hidden", vals: { key: path.key } };
    if (i === last) {
      if (plan) return { ...base, msg: "rangeStart", vals: { key: path.key, to: to!, leaves: 1 } };
      const found = node.keys.includes(path.key);
      return { ...base, msg: found ? "leafFound" : "leafMissing", vals: { key: path.key, total: node.totalKeys } };
    }
    const child = path.pages[i + 1];
    const idx = node.children?.indexOf(child) ?? -1;
    const lo = idx >= 0 ? node.keys[idx] : undefined;
    if (lo === undefined) return { ...base, msg: "internalNoRange", vals: { key: path.key, child } };
    const hi = node.keys[idx + 1];
    const vals = { key: path.key, child, lo: lo === "" ? NEG_INF : lo, hi: hi ?? "" };
    return { ...base, msg: hi === undefined ? "internalOpen" : "internal", vals };
  });
  const firstLeaf = steps.length - 1;
  if (plan && "slide" in plan) {
    plan.slide.forEach((node, i) =>
      steps.push({ n: steps.length + 1, page: node.page, heap: false, kind: "leaf", msg: "slide", vals: { leaves: i + 2, total: node.totalKeys }, src: steps.length - 1, slide: true }),
    );
    steps[steps.length - 1].end = plan.end;
  }
  // Heap là của dòng đầu tiên của khoảng (khóa từ), nên key quay về leaf đầu rồi mới nhảy sang heap.
  if (path.heapPage !== undefined)
    steps.push({ n: steps.length + 1, page: path.heapPage, heap: true, kind: "leaf", msg: plan ? "heapRange" : "heap", vals: { page: path.heapPage, key: path.key }, src: firstLeaf });
  return steps;
}
