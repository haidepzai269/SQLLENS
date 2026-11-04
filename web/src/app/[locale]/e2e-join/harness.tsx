"use client";

import gsap from "gsap";
import { useEffect, useState } from "react";
import type { EngineId } from "@/contracts/engine";
import type { PlanKind, PlanNode } from "@/contracts/plan";
import { JoinAnimation } from "@/modules/plan-runner/join-anim/join-animation";

const n = (id: string, kind: PlanKind, label: string, x: Partial<PlanNode> = {}, children: PlanNode[] = []): PlanNode => ({ id, kind, label, children, ...x });
const scan = (t: string) => n("s" + t, "seq_scan", "Seq Scan", { table: t });
const UNMOUNT = "unmount";
const NODES: Record<string, PlanNode> = {
  nl: n("1", "nested_loop", "Nested Loop", { actualRows: 100 }, [scan("orders"), scan("customers")]),
  nlIndex: n("2", "nested_loop", "Nested Loop", { actualRows: 100 }, [scan("orders"), n("i", "index_scan", "Index Scan", { table: "customers" })]),
  hash: n("3", "hash_join", "Hash Join", { actualRows: 5000 }, [scan("orders"), n("h", "hash", "Hash", {}, [scan("customers")])]),
  merge: n("4", "merge_join", "Merge Join", { actualRows: 12 }, [scan("a"), scan("b")]),
  zero: n("5", "hash_join", "Hash Join", { actualRows: 0 }, [scan("a"), scan("b")]),
  noRows: n("6", "hash_join", "Hash Join", {}, [scan("a"), scan("b")]),
  est: n("7", "nested_loop", "Nested loop inner join", { estimatedRows: 40 }, [scan("a"), scan("b")]),
  scan: scan("orders"),
};

export function Harness() {
  const [which, setWhich] = useState("nl");
  const [engine, setEngine] = useState<EngineId>("postgres");
  useEffect(() => {
    (window as unknown as { timelineCount: () => number }).timelineCount = () => gsap.globalTimeline.getChildren(false).length;
  }, []);
  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {Object.keys(NODES).map((k) => (
          <button key={k} onClick={() => setWhich(k)}>{k}</button>
        ))}
        {(["postgres", "mysql"] as const).map((k) => (
          <button key={k} onClick={() => setEngine(k)}>{k}</button>
        ))}
        <button onClick={() => setWhich("")}>{UNMOUNT}</button>
      </div>
      {NODES[which] && <JoinAnimation node={NODES[which]} engine={engine} />}
    </main>
  );
}
