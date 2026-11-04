import type { EngineId } from "./engine";
import type { RuleHit } from "./finding";
import type { Plan } from "./plan";
import type { CapacityPoint, WhatIfData } from "./whatif";

// Thứ duy nhất AI được thấy về SQL của người dùng. Không chứa dòng dữ liệu kết quả.
export type EvidencePack = {
  engine: EngineId;
  sql: string;
  sqlTruncated?: boolean;
  plan?: Plan;
  findings?: RuleHit[];
  whatIf?: WhatIfData;
  capacity?: CapacityPoint[];
};

// Thân của POST /api/ai/chat.
export type MentorRequest = { question: string; evidence: EvidencePack; locale: "vi" | "en" };

// Mỗi sự kiện SSE là một dòng `data: <JSON>`.
export type MentorStreamEvent = { type: "delta"; text: string } | { type: "done" } | { type: "error"; messageKey: string };
