import { readEvents } from "../ui/stream";

export interface DiagnoseParams {
  sql: string;
  error: string;
  engine: "postgres" | "mysql";
  locale: "vi" | "en";
  question?: string;
  onDelta?: (delta: string) => void;
  onComplete?: (fullText: string, suggestedSql: string | null) => void;
  onError?: (err: { messageKey?: string; message?: string }) => void;
}

/**
 * Bóc tách đoạn mã SQL được đề xuất sửa chữa nằm bên trong khối code block.
 * Ưu tiên block có tag ```sql ... ```. Nếu có block ```sql nhưng nội dung rỗng thì trả về null.
 * Nếu không có block ```sql thì tìm block ``` ... ``` chung.
 */
export function extractSuggestedSql(text: string): string | null {
  const sqlMatch = text.match(/```sql\b\s*([\s\S]*?)\s*```/i);
  if (sqlMatch) {
    const code = sqlMatch[1].trim();
    return code.length > 0 ? code : null;
  }
  const genericMatch = text.match(/```\s*([\s\S]*?)\s*```/);
  if (genericMatch) {
    const code = genericMatch[1].trim();
    return code.length > 0 ? code : null;
  }
  return null;
}

/**
 * Gọi SSE stream tới endpoint /api/ai/diagnose tại Gin backend.
 * Trả về hàm hủy (abort) để ngắt stream khi component unmount hoặc người dùng nhấn Hủy.
 */
export function diagnoseSqlError(params: DiagnoseParams): () => void {
  const ac = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/ai/diagnose", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sql: params.sql,
          error: params.error,
          engine: params.engine,
          locale: params.locale,
          ...(params.question ? { question: params.question } : {}),
        }),
        signal: ac.signal,
      });

      if (!res.ok) {
        let messageKey = "error.aiUnavailable";
        let message: string | undefined;
        try {
          const body = (await res.json()) as { messageKey?: string; message?: string; error?: string };
          if (body.messageKey) {
            messageKey = body.messageKey;
          } else if (body.error === "quota_exceeded" || res.status === 429) {
            messageKey = "error.quotaExceeded";
          } else if (body.error === "auth_required" || res.status === 401) {
            messageKey = "error.authRequired";
          } else if (res.status === 413) {
            messageKey = "error.payloadTooLarge";
          }
          if (body.message) {
            message = body.message;
          }
        } catch {
          if (res.status === 429) messageKey = "error.quotaExceeded";
          else if (res.status === 401) messageKey = "error.authRequired";
        }
        params.onError?.({ messageKey, message });
        return;
      }

      if (!res.body) {
        params.onError?.({ messageKey: "error.aiUnavailable" });
        return;
      }

      let fullText = "";
      for await (const ev of readEvents(res.body)) {
        if (ev.type === "delta") {
          fullText += ev.text;
          params.onDelta?.(ev.text);
        } else if (ev.type === "error") {
          params.onError?.({ messageKey: ev.messageKey });
          return;
        } else if (ev.type === "done") {
          break;
        }
      }

      const suggestedSql = extractSuggestedSql(fullText);
      params.onComplete?.(fullText, suggestedSql);
    } catch (e: unknown) {
      if (ac.signal.aborted) {
        return;
      }
      params.onError?.({
        messageKey: "error.aiUnavailable",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  })();

  return () => {
    ac.abort();
  };
}
