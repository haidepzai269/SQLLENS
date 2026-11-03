"use client";

import gsap from "gsap";
import { useEffect, useMemo, useState } from "react";
import type { BTreeModel, BTreePath } from "@/contracts/btree";
import type { EvidenceLabel } from "@/contracts/conclusion";
import { BTreeDrop } from "@/modules/btree-reader/anim/btree-drop";
import { bigFixture, smallFixture } from "@/modules/btree-reader/view/fixtures";

const single = (): BTreeModel => ({ ...smallFixture(), height: 1, rootPage: 1, totalPages: 1, nodes: [{ page: 1, level: 0, keys: ["1", "2"], totalKeys: 2 }], hidden: [] });
const PATHS: Record<string, Record<string, BTreePath | undefined>> = {
  small: { heap: { key: "121", pages: [1, 2, 5], heapPage: 77 }, plain: { key: "121", pages: [1, 2, 5] }, none: undefined },
  big: { heap: { key: "7000", pages: [1, 11, 500], heapPage: 4021 }, plain: { key: "7000", pages: [1, 11, 500] }, none: undefined },
  single: { heap: { key: "1", pages: [1], heapPage: 3 }, plain: { key: "1", pages: [1] }, none: undefined },
};

export function Harness() {
  const [which, setWhich] = useState("small");
  const [pathKind, setPathKind] = useState("heap");
  const [label, setLabel] = useState<EvidenceLabel>("real");
  useEffect(() => {
    (window as unknown as { timelineCount: () => number }).timelineCount = () => gsap.globalTimeline.getChildren(false).length;
  }, []);
  const model = useMemo(() => (which === "big" ? bigFixture() : which === "single" ? single() : smallFixture()), [which]);
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 text-xs">
        {["small", "big", "single"].map((k) => (
          <button key={k} onClick={() => setWhich(k)}>{k}</button>
        ))}
        {["heap", "plain", "none"].map((k) => (
          <button key={k} onClick={() => setPathKind(k)}>{k}</button>
        ))}
        {(["real", "simulated", "estimated"] as const).map((k) => (
          <button key={k} onClick={() => setLabel(k)}>{k}</button>
        ))}
      </div>
      <BTreeDrop model={model} path={PATHS[which][pathKind]} label={label} />
    </main>
  );
}
