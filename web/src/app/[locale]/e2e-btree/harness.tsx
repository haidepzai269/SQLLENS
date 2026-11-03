/* eslint-disable react/jsx-no-literals -- route thử của Playwright, không phải giao diện sản phẩm */
"use client";

import { Profiler, useEffect, useMemo, useState } from "react";
import type { BTreeModel } from "@/contracts/btree";
import type { EvidenceLabel } from "@/contracts/conclusion";
import { BTreeView, nodePosition, readStoredMode } from "@/modules/btree-reader/view/btree-view";
import { bigFixture, smallFixture } from "@/modules/btree-reader/view/fixtures";

const single = (): BTreeModel => ({ ...smallFixture(), height: 1, rootPage: 1, totalPages: 1, nodes: [{ page: 1, level: 0, keys: ["1", "2"], totalKeys: 2 }], hidden: [] });

export function Harness() {
  const [which, setWhich] = useState("small");
  const [label, setLabel] = useState<EvidenceLabel>("real");
  const [mode, setMode] = useState<"fixed" | "free">("fixed");
  const [path, setPath] = useState(true);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc localStorage sau hydrate
  useEffect(() => setMode(readStoredMode()), []);
  useEffect(() => {
    (window as unknown as { nodePosition: typeof nodePosition }).nodePosition = nodePosition;
  }, []);
  const model = useMemo(() => (which === "big" ? bigFixture() : which === "single" ? single() : smallFixture()), [which]);
  const p = useMemo(
    () =>
    which === "big" ? { key: "7000", pages: [1, 11, 500] } : which === "single" ? { key: "1", pages: [1] } : { key: "121", pages: [1, 2, 5] },
    [which],
  );
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 text-xs">
        {["small", "big", "single"].map((k) => (
          <button key={k} onClick={() => setWhich(k)}>{k}</button>
        ))}
        {(["real", "simulated", "estimated"] as const).map((k) => (
          <button key={k} onClick={() => setLabel(k)}>{k}</button>
        ))}
        <button onClick={() => setPath((v) => !v)}>path</button>
        <span data-testid="mode">{mode}</span>
      </div>
      <Profiler id="tree" onRender={(_, __, actual) => ((window as unknown as { __render: number[] }).__render ??= []).push(actual)}>
        <BTreeView model={model} path={path ? p : undefined} label={label} mode={mode} onModeChange={setMode} />
      </Profiler>
    </main>
  );
}
