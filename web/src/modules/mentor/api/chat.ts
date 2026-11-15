import type { MentorRequest } from "@/contracts/mentor";

export interface SendMentorChatOptions {
  request: MentorRequest;
  signal?: AbortSignal;
}

/**
 * Gửi yêu cầu chat tới AI Mentor proxy (/api/ai/chat).
 * Hỗ trợ truyền kèm `evidence_plan` (chuỗi nén ~40 tokens) lấy từ hook useActiveQueryPlan.
 */
export async function sendMentorChat(options: SendMentorChatOptions): Promise<Response> {
  const { request, signal } = options;

  return fetch("/api/ai/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
}
