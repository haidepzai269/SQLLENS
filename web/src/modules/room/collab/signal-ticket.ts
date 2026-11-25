export interface SignalTicketResponse {
  ticket: string;
  expiresIn: number;
}

/**
 * Xin ticket 1-lần-dùng (TTL 30s) qua Vercel rewrite (same-origin gửi kèm cookie sid)
 * để sau đó mở WebSocket thẳng tới Render mà không cần cookie cross-origin.
 */
export async function requestSignalTicket(
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SignalTicketResponse> {
  if (!projectId) {
    throw new Error("projectId is required");
  }
  const url = `/api/v1/cloud/projects/${encodeURIComponent(projectId)}/signal-ticket`;
  const res = await fetchImpl(url, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to request signal ticket (HTTP ${res.status})`);
  }
  const data = (await res.json()) as Partial<SignalTicketResponse> | null;
  if (!data || typeof data.ticket !== "string" || data.ticket.length === 0) {
    throw new Error("Invalid signal ticket response: missing ticket");
  }
  return {
    ticket: data.ticket,
    expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : 30,
  };
}

/**
 * Dựng URL WebSocket signaling: ưu tiên `wsOrigin ?? process.env.NEXT_PUBLIC_WS_ORIGIN`
 * (chuẩn hóa `https://` -> `wss://`, `http://` -> `ws://`, bỏ trailing slash), fallback về
 * `window.location` khi chạy local dev, và gắn `?ticket=...` nếu có.
 */
export function buildDirectSignalUrl(
  projectId: string,
  ticket?: string,
  wsOrigin?: string,
): string {
  const path = `/api/v1/cloud/projects/${encodeURIComponent(projectId)}/signal`;
  const rawOrigin = (wsOrigin ?? process.env.NEXT_PUBLIC_WS_ORIGIN ?? "").trim().replace(/\/+$/, "");

  let base: string;
  if (rawOrigin) {
    const normalizedOrigin = rawOrigin
      .replace(/^https:\/\//i, "wss://")
      .replace(/^http:\/\//i, "ws://");
    base = `${normalizedOrigin}${path}`;
  } else if (typeof window !== "undefined" && window.location && window.location.host) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    base = `${proto}//${window.location.host}${path}`;
  } else {
    base = path;
  }

  if (ticket) {
    return `${base}?ticket=${encodeURIComponent(ticket)}`;
  }
  return base;
}
