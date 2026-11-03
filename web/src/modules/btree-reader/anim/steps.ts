import type { BTreeModel, BTreePath } from "@/contracts/btree";

export type StepKind = "root" | "internal" | "leaf" | "rootLeaf";
export type StepMsg = "internal" | "internalOpen" | "internalNoRange" | "hidden" | "leafFound" | "leafMissing" | "heap";
export type Step = { n: number; page: number; heap: boolean; kind: StepKind; msg: StepMsg; vals: Record<string, string | number> };

const NEG_INF = "−∞";

// Mỗi trang trên đường đi là một bước, thêm một bước heap nếu có. Chỉ dùng số có trong model và path, không đoán.
export function buildSteps(model: BTreeModel, path: BTreePath): Step[] {
  const byPage = new Map(model.nodes.map((n) => [n.page, n]));
  const last = path.pages.length - 1;
  const steps: Step[] = path.pages.map((page, i): Step => {
    const kind: StepKind = last === 0 ? "rootLeaf" : i === 0 ? "root" : i === last ? "leaf" : "internal";
    const base = { n: i + 1, page, heap: false, kind };
    const node = byPage.get(page);
    if (!node) return { ...base, msg: "hidden", vals: { key: path.key } };
    if (i === last) {
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
  if (path.heapPage !== undefined) steps.push({ n: steps.length + 1, page: path.heapPage, heap: true, kind: "leaf", msg: "heap", vals: { page: path.heapPage } });
  return steps;
}
