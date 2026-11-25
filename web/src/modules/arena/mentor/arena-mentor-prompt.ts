// Dựng prompt và gọi AI Mentor cho Deadlock Arena (SP024 / STR116 / Task170).
// Chỉ lấy dữ liệu từ kịch bản mô phỏng conflict-sim (scenarios-data.ts).
// Tuyệt đối không đọc useWorkspaceStore hay nhúng SQL người dùng (Core Rule 7).
// Tuyệt đối chỉ gọi POST /api/ai/inline-complete (không gọi /api/v1/ai/*).

import type { ScenarioId } from "@/modules/conflict-sim/engine/types";
import { clampArenaStepIndex } from "../graph/graph-elements";
import { getArenaScenario } from "../scenarios-data";

export const ARENA_MENTOR_ENDPOINT = "/api/ai/inline-complete";
export const ARENA_MENTOR_TIMEOUT_MS = 10000;

export interface BuildArenaMentorPromptParams {
  scenarioId: ScenarioId;
  stepIndex: number;
  locale: string;
}

export interface ArenaMentorPromptPayload {
  prefix: string;
  suffix: string;
  engine: "postgres";
  schemaSnippet: string;
}

export interface AnalyzeArenaStepParams {
  scenarioId: ScenarioId;
  stepIndex: number;
  locale: string;
  signal?: AbortSignal;
}

export type ArenaMentorErrorKind =
  | "unauthorized"
  | "vip_required"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "empty_response"
  | "aborted";

export type AnalyzeArenaMentorResult =
  | { ok: true; analysis: string }
  | { ok: false; errorKind: ArenaMentorErrorKind };

/**
 * Dựng payload gửi AI Mentor thuần từ metadata kịch bản và bước hiện tại của conflict-sim.
 * Không đọc workspace store hay bất kỳ SQL tab nào của người dùng.
 */
export function buildArenaMentorPrompt(
  params: BuildArenaMentorPromptParams
): ArenaMentorPromptPayload {
  const { scenarioId, stepIndex, locale } = params;
  const scenario = getArenaScenario(scenarioId);
  const safeStepIndex = clampArenaStepIndex(stepIndex, scenario.totalSteps);
  const step = scenario.steps[safeStepIndex] ?? scenario.steps[0];
  const txA = step.transactions.A;
  const txB = step.transactions.B;

  const isVietnamese = locale.toLowerCase().startsWith("vi");
  const flags: string[] = [];
  if (step.deadlockDetected) {
    flags.push(`deadlockDetected=true${step.sqlstate ? ` (SQLSTATE ${step.sqlstate})` : ""}`);
  }
  if (step.conflictDetected) {
    flags.push("conflictDetected=true");
  }

  const instruction = isVietnamese
    ? "Giải thích ngắn gọn bằng tiếng Việt cơ chế khóa/xung đột ở bước mô phỏng này và cách phòng tránh."
    : "Briefly explain in English the locking/concurrency mechanism in this simulation step and how to prevent it.";

  const prefix = [
    `-- [Arena Simulation Analysis]`,
    `-- Scenario: ${scenario.id} | Step: ${safeStepIndex + 1}/${scenario.totalSteps}`,
    `-- Session A (${txA.status}): ${txA.sql}`,
    `-- Session B (${txB.status}): ${txB.sql}`,
    flags.length > 0 ? `-- Flags: ${flags.join(", ")}` : `-- Flags: none`,
    `-- ${instruction}`,
  ].join("\n");

  const schemaSnippet = [
    `conflict-sim scenario=${scenario.id}`,
    `step=${safeStepIndex + 1}/${scenario.totalSteps}`,
    `txA=${txA.status}`,
    `txB=${txB.status}`,
  ].join("; ");

  return {
    prefix,
    suffix: "",
    engine: "postgres",
    schemaSnippet,
  };
}

/**
 * Gọi POST /api/ai/inline-complete để lấy phân tích bước Arena cho user VIP.
 * Không bao giờ ném lỗi ra ngoài; trả kết quả có cấu trúc kèm errorKind an toàn.
 */
export async function analyzeArenaStepWithMentor(
  params: AnalyzeArenaStepParams,
  fetchImpl: typeof fetch = fetch
): Promise<AnalyzeArenaMentorResult> {
  const { scenarioId, stepIndex, locale, signal } = params;

  if (signal?.aborted) {
    return { ok: false, errorKind: "aborted" };
  }

  const payload = buildArenaMentorPrompt({ scenarioId, stepIndex, locale });
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ARENA_MENTOR_TIMEOUT_MS);

  let onExternalAbort: (() => void) | null = null;
  if (signal) {
    onExternalAbort = () => controller.abort();
    signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const res = await fetchImpl(ARENA_MENTOR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, errorKind: "unauthorized" };
      }
      if (res.status === 403) {
        return { ok: false, errorKind: "vip_required" };
      }
      if (res.status === 429) {
        return { ok: false, errorKind: "rate_limited" };
      }
      return { ok: false, errorKind: "server_error" };
    }

    const data = (await res.json()) as { completion?: unknown } | null;
    const completion =
      data && typeof data.completion === "string" ? data.completion.trim() : "";

    if (!completion) {
      return { ok: false, errorKind: "empty_response" };
    }

    return { ok: true, analysis: completion };
  } catch (err: unknown) {
    if (signal?.aborted) {
      return { ok: false, errorKind: "aborted" };
    }
    if (timedOut) {
      return { ok: false, errorKind: "network_error" };
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, errorKind: "aborted" };
    }
    return { ok: false, errorKind: "network_error" };
  } finally {
    clearTimeout(timer);
    if (signal && onExternalAbort) {
      signal.removeEventListener("abort", onExternalAbort);
    }
  }
}
