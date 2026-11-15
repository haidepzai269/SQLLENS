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
  ruleTags?: string[];
  compact?: boolean;
};

// Thân của POST /api/ai/chat.
export type MentorRequest = {
  question: string;
  evidence: EvidencePack;
  locale: "vi" | "en";
  contextSummary?: string;
  evidence_plan?: string;
};

// Đại diện một lượt hỏi đáp trong phiên hội thoại đa lượt
export type ConversationTurn = {
  id: number;
  question: string;
  answerText: string;
  phase: "sending" | "streaming" | "verifying" | "done" | "stopped" | "failed";
  timestamp: number;
  verified?: unknown;
};

// Mỗi sự kiện SSE là một dòng `data: <JSON>`.
export type MentorStreamEvent = { type: "delta"; text: string } | { type: "done" } | { type: "error"; messageKey: string };
