"use client";

import { useMemo, useState } from "react";
import type { EvidenceLabel } from "@/contracts/conclusion";
import { BTreeDrop } from "@/modules/btree-reader/anim/btree-drop";
import { BTreeRace, type BTreeRaceProps } from "@/modules/btree-reader/race/btree-race";
import { smallFixture } from "@/modules/btree-reader/view/fixtures";

type TestCase = "normal" | "noindex" | "zero" | "huge";

const CASES: Record<
  TestCase,
  {
    name: string;
    race: Omit<BTreeRaceProps, "label">;
    dimmed: boolean;
    dimReason?: string;
  }
> = {
  normal: {
    name: "Ca bình thường: Index Scan vs Seq Scan",
    race: {
      idxPages: 4,
      seqPages: 180,
      idxRows: 1,
      seqRows: 5000,
      noIndex: false,
    },
    dimmed: false,
  },
  noindex: {
    name: "Ca noindex / bọc biểu thức: Cây tối",
    race: {
      idxPages: 0,
      seqPages: 180,
      idxRows: 0,
      seqRows: 5000,
      noIndex: true,
    },
    dimmed: true,
  },
  zero: {
    name: "Ca biên: Bảng rỗng (0 trang, 0 dòng)",
    race: {
      idxPages: 0,
      seqPages: 0,
      idxRows: 0,
      seqRows: 0,
      noIndex: false,
    },
    dimmed: false,
  },
  huge: {
    name: "Ca chênh lệch cực lớn (2 vs 60.000)",
    race: {
      idxPages: 2,
      seqPages: 60000,
      idxRows: 10,
      seqRows: 1000000,
      noIndex: false,
    },
    dimmed: false,
  },
};

const SAMPLE_PATH = { key: "121", pages: [1, 2, 5], heapPage: 77 };

export function Harness() {
  const [testCase, setTestCase] = useState<TestCase>("normal");
  const [label, setLabel] = useState<EvidenceLabel>("real");

  const model = useMemo(() => smallFixture(), []);
  const current = CASES[testCase];

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 p-4 overflow-x-hidden">
      <div role="toolbar" aria-label="Controls" className="flex flex-wrap items-center gap-2 border-b border-line pb-3 text-xs">
        {(["normal", "noindex", "zero", "huge"] as const).map((k) => (
          <button
            key={k}
            data-testid={`case-${k}`}
            onClick={() => setTestCase(k)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              testCase === k
                ? "bg-lamp text-lamp-ink"
                : "bg-surface text-ink2 hover:text-white border border-line"
            }`}
          >
            {k}
          </button>
        ))}

        {(["real", "simulated", "estimated"] as const).map((l) => (
          <button
            key={l}
            data-testid={`label-${l}`}
            onClick={() => setLabel(l)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              label === l
                ? "bg-zinc-200 text-black"
                : "bg-surface text-ink2 hover:text-white border border-line"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="text-sm font-semibold text-white m-0">{current.name}</h2>
        <BTreeRace
          idxPages={current.race.idxPages}
          seqPages={current.race.seqPages}
          idxRows={current.race.idxRows}
          seqRows={current.race.seqRows}
          noIndex={current.race.noIndex}
          label={label}
        />
        <div className="flex min-h-[400px] min-w-0 flex-col rounded border border-line overflow-hidden">
          <BTreeDrop
            model={model}
            path={current.dimmed ? undefined : SAMPLE_PATH}
            label={label}
            dimmed={current.dimmed}
            dimReason={current.dimReason}
          />
        </div>
      </div>
    </main>
  );
}
