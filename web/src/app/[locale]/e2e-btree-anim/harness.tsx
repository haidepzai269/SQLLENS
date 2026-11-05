"use client";

import gsap from "gsap";
import { useEffect, useMemo, useState } from "react";
import type { BTreeModel, BTreeNode, BTreePath } from "@/contracts/btree";
import type { EvidenceLabel } from "@/contracts/conclusion";
import { BTreeDrop } from "@/modules/btree-reader/anim/btree-drop";
import { bigFixture, smallFixture } from "@/modules/btree-reader/view/fixtures";

const single = (): BTreeModel => ({ ...smallFixture(), height: 1, rootPage: 1, totalPages: 1, nodes: [{ page: 1, level: 0, keys: ["1", "2"], totalKeys: 2 }], hidden: [] });
// Cây 3 tầng, mỗi leaf 3 khóa (1..18), leaf nối nhau bằng next. gap: thiếu leaf 8 như khi readBTree chỉ đọc một phần.
const leafN = (page: number, from: number, next?: number): BTreeNode => ({ page, level: 0, keys: [from, from + 1, from + 2].map(String), totalKeys: 3, ...(next ? { next } : {}) });
const chain = (gap = false): BTreeModel => ({
  ...smallFixture(),
  index: "t_id_idx",
  table: "t",
  columns: ["id"],
  height: 3,
  totalPages: 9,
  nodes: [
    { page: 1, level: 2, keys: ["", "10"], children: [2, 3], totalKeys: 2 },
    { page: 2, level: 1, keys: ["", "4", "7"], children: [4, 5, 6], totalKeys: 3 },
    { page: 3, level: 1, keys: ["10", "13", "16"], children: [7, 8, 9], totalKeys: 3 },
    leafN(4, 1, 5), leafN(5, 4, 6), leafN(6, 7, 7), leafN(7, 10, 8), leafN(8, 13, 9), leafN(9, 16),
  ].filter((n) => !(gap && n.page === 8)),
  hidden: gap ? [{ level: 0, count: 1 }] : [],
});
const CP = { heap: { key: "5", pages: [1, 2, 5], heapPage: 90 }, plain: { key: "5", pages: [1, 2, 5] }, none: undefined };
const PATHS: Record<string, Record<string, BTreePath | undefined>> = {
  small: { heap: { key: "121", pages: [1, 2, 5], heapPage: 77 }, plain: { key: "121", pages: [1, 2, 5] }, none: undefined },
  big: { heap: { key: "7000", pages: [1, 11, 500], heapPage: 4021 }, plain: { key: "7000", pages: [1, 11, 500] }, none: undefined },
  chain: CP,
  gap: CP,
  single: { heap: { key: "1", pages: [1], heapPage: 3 }, plain: { key: "1", pages: [1] }, none: undefined },
};

export function Harness() {
  const [which, setWhich] = useState("small");
  const [pathKind, setPathKind] = useState("heap");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState<EvidenceLabel>("real");
  useEffect(() => {
    const w = window as unknown as { timelineCount: () => number; activeTweens: () => number };
    w.timelineCount = () => gsap.globalTimeline.getChildren(false).length;
    w.activeTweens = () => gsap.globalTimeline.getChildren(false, true, false).length; // tween bước tới/lùi (tweenTo) còn chạy
  }, []);
  const model = useMemo(() => (which === "big" ? bigFixture() : which === "chain" ? chain() : which === "gap" ? chain(true) : which === "single" ? single() : smallFixture()), [which]);
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 text-xs">
        {["small", "big", "single", "chain", "gap"].map((k) => (
          <button key={k} onClick={() => setWhich(k)}>{k}</button>
        ))}
        {["heap", "plain", "none"].map((k) => (
          <button key={k} onClick={() => setPathKind(k)}>{k}</button>
        ))}
        <input aria-label="to" value={to} onChange={(e) => setTo(e.target.value)} className="w-16 border" />
        {(["real", "simulated", "estimated"] as const).map((k) => (
          <button key={k} onClick={() => setLabel(k)}>{k}</button>
        ))}
      </div>
      <BTreeDrop model={model} path={PATHS[which][pathKind]} label={label} to={to || undefined} />
    </main>
  );
}
