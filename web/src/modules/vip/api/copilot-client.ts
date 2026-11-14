/**
 * Copyright (c) 2026 SQLLens
 * API client for VIP AI Inline Copilot Completion.
 * Calls POST /api/ai/inline-complete with 5s timeout and safe fallback.
 */

export interface FetchAiInlineCompletionParams {
  prefix: string;
  suffix?: string;
  engine?: string;
  schemaSnippet?: string;
  signal?: AbortSignal;
}

export interface InlineCompletionResult {
  completion: string;
  finishReason?: string;
}

export const COPILOT_TIMEOUT_MS = 5000;

/**
 * Gửi yêu cầu inline completion tới proxy AI Backend (/api/ai/inline-complete).
 * Tự động hủy khi quá timeout hoặc khi caller truyền AbortSignal (người dùng tiếp tục gõ).
 * An toàn tuyệt đối: Không ném lỗi ra ngoài khi mất mạng hoặc mã lỗi HTTP (401, 403, 500).
 */
export async function fetchAiInlineCompletion(
  params: FetchAiInlineCompletionParams
): Promise<InlineCompletionResult | null> {
  const { prefix, suffix = "", engine = "postgres", schemaSnippet = "", signal } = params;

  if (signal?.aborted) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, COPILOT_TIMEOUT_MS);

  let onExternalAbort: (() => void) | null = null;
  if (signal) {
    onExternalAbort = () => {
      controller.abort();
    };
    signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const res = await fetch("/api/ai/inline-complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix,
        suffix,
        engine,
        schemaSnippet,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // 401 unauthenticated, 403 vip_required, 429 rate limited, 500 server error
      return { completion: "", finishReason: "error" };
    }

    const data = (await res.json()) as { completion?: string; finishReason?: string };
    if (data && typeof data.completion === "string") {
      return {
        completion: data.completion,
        finishReason: data.finishReason ?? "stop",
      };
    }

    return { completion: "", finishReason: "stop" };
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      return null;
    }
    // Lỗi mạng hoặc lỗi ngoài ý muốn -> fallback an toàn
    return { completion: "", finishReason: "error" };
  } finally {
    clearTimeout(timer);
    if (signal && onExternalAbort) {
      signal.removeEventListener("abort", onExternalAbort);
    }
  }
}
