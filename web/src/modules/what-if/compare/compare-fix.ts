import type { Outcome } from "@/contracts/conclusion";
import type { EngineAdapter, EngineId } from "@/contracts/engine";
import type { Plan } from "@/contracts/plan";
import type { WhatIfData, WhatIfSide } from "@/contracts/whatif";
import { normalizeMysql, normalizePostgres } from "@/modules/plan-runner/normalize";

function isMysqlPlan(plan: unknown): boolean {
  if (!plan) return false;
  let p = plan;
  if (typeof plan === "string") {
    try {
      p = JSON.parse(plan);
    } catch {
      return false;
    }
  }
  return typeof p === "object" && p !== null && "query_block" in p;
}

function parsePlan(plan: unknown, engine?: EngineId): Plan {
  if (engine === "mysql") return normalizeMysql(plan);
  if (engine === "postgres") return normalizePostgres(plan);
  return isMysqlPlan(plan) ? normalizeMysql(plan) : normalizePostgres(plan);
}

const side = (
  s: { rows: number; sharedHitBlocks: number; sharedReadBlocks: number },
  plan: unknown,
  engine?: EngineId,
): WhatIfSide => ({
  rows: s.rows,
  pagesRead: s.sharedHitBlocks + s.sharedReadBlocks,
  plan: parsePlan(plan, engine),
});

/** Đo câu thăm dò trước và sau `change` (tryChange hoàn tác sạch). Lỗi EngineError của change/probe được ném lên cho giao diện. */
export async function compareFix(
  adapter: Pick<EngineAdapter, "tryChange"> & { engine?: EngineId },
  input: { change: string; probe: string },
): Promise<Outcome<WhatIfData>> {
  const r = await adapter.tryChange(input.change, input.probe);
  if (r.kind !== "conclusion") return r;
  let before: WhatIfSide, after: WhatIfSide;
  try {
    before = side(r.data.before, r.data.plans.before, adapter.engine);
    after = side(r.data.after, r.data.plans.after, adapter.engine);
  } catch {
    // JSON plan không đọc được: không đoán, báo chưa mô phỏng được.
    return { kind: "not_simulated", reasonKey: "whatIfCompare.planUnreadable" };
  }
  const pagesChange = after.pagesRead < before.pagesRead ? "fewer" : after.pagesRead > before.pagesRead ? "more" : "same";
  const isMysql = adapter.engine === "mysql" || isMysqlPlan(r.data.plans.before);
  return {
    kind: "conclusion",
    label: "real",
    data: { before, after, pagesChange, rowsChanged: isMysql ? false : before.rows !== after.rows },
    evidence: [
      { kind: "pages", messageKey: "whatIfCompare.pages", values: { before: before.pagesRead, after: after.pagesRead } },
      { kind: "rows", messageKey: "whatIfCompare.rows", values: { before: before.rows, after: after.rows } },
    ],
  };
}
