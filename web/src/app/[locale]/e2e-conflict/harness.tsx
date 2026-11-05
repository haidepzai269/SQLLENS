"use client";

import { useState } from "react";
import { ConflictPanel } from "@/modules/conflict-sim/ui/conflict-panel";

const TOGGLE = "toggle";

export function Harness() {
  const [on, setOn] = useState(true);
  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-col gap-3 px-4 py-3">
      <button className="w-fit text-xs" onClick={() => setOn((x) => !x)}>{TOGGLE}</button>
      {on && <ConflictPanel />}
    </main>
  );
}
