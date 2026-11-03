"use client";

import { useMemo, useState } from "react";
import type { EvidenceLabel } from "@/contracts/conclusion";
import { PlanTree } from "@/modules/plan-runner/plan-tree";
import { FIXTURES } from "@/modules/plan-runner/plan-tree/fixtures";

export function Harness() {
  const [which, setWhich] = useState<keyof typeof FIXTURES>("five");
  const [label, setLabel] = useState<EvidenceLabel>("real");
  const plan = useMemo(() => FIXTURES[which](), [which]);
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(Object.keys(FIXTURES) as (keyof typeof FIXTURES)[]).map((k) => (
          <button key={k} onClick={() => setWhich(k)}>{k}</button>
        ))}
        {(["real", "simulated", "estimated"] as const).map((k) => (
          <button key={k} onClick={() => setLabel(k)}>{k}</button>
        ))}
      </div>
      <PlanTree plan={plan} label={label} />
    </main>
  );
}
