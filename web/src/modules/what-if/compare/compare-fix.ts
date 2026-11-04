import type { Outcome } from "@/contracts/conclusion";
import type { EngineAdapter } from "@/contracts/engine";
import type { WhatIfData, WhatIfSide } from "@/contracts/whatif";
import { normalizePostgres } from "@/modules/plan-runner/normalize";

const side = (s: { rows: number; sharedHitBlocks: number; sharedReadBlocks: number }, plan: unknown): WhatIfSide => ({
  rows: s.rows,
  pagesRead: s.sharedHitBlocks + s.sharedReadBlocks,
  plan: normalizePostgres(plan),
});

/** Đo câu thăm dò trước và sau `change` (tryChange hoàn tác sạch). Lỗi EngineError của change/probe được ném lên cho giao diện. */
export async function compareFix(
  adapter: Pick<EngineAdapter, "tryChange">,
  input: { change: string; probe: string },
): Promise<Outcome<WhatIfData>> {
  const r = await adapter.tryChange(input.change, input.probe);
  if (r.kind !== "conclusion") return r;
  let before: WhatIfSide, after: WhatIfSide;
  try {
    before = side(r.data.before, r.data.plans.before);
    after = side(r.data.after, r.data.plans.after);
  } catch {
    // JSON plan không đọc được: không đoán, báo chưa mô phỏng được.
    return { kind: "not_simulated", reasonKey: "whatIfCompare.planUnreadable" };
  }
  const pagesChange = after.pagesRead < before.pagesRead ? "fewer" : after.pagesRead > before.pagesRead ? "more" : "same";
  return {
    kind: "conclusion",
    label: "real",
    data: { before, after, pagesChange, rowsChanged: before.rows !== after.rows },
    evidence: [
      { kind: "pages", messageKey: "whatIfCompare.pages", values: { before: before.pagesRead, after: after.pagesRead } },
      { kind: "rows", messageKey: "whatIfCompare.rows", values: { before: before.rows, after: after.rows } },
    ],
  };
}
