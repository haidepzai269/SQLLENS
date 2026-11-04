import { isApiError } from "@/contracts/api-error";

export type Me = { id: string; name: string; avatarUrl?: string; provider: string };

// Chỉ các khóa này có trong messages/*/error.json; messageKey lạ từ server quy về "internal".
const KEYS = [
  "authRequired", "quotaExceeded", "quotaUnavailable", "notConfigured",
  "originMismatch", "invalidState", "authUnavailable", "rateLimited", "internal",
] as const;
export type ErrorKey = (typeof KEYS)[number];

export type Failure = { status: number; code: string; key: ErrorKey; resetAt?: Date };

export async function readFailure(res: Response): Promise<Failure> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    /* thân không phải JSON */
  }
  const e = isApiError(body) ? body.error : { code: "unknown", messageKey: "" };
  const k = e.messageKey.replace(/^error\./, "");
  const key = (KEYS as readonly string[]).includes(k) ? (k as ErrorKey) : "internal";
  // X-Quota-Reset là RFC3339; thiếu thì lấy Retry-After (giây).
  const reset = Date.parse(res.headers.get("X-Quota-Reset") ?? "");
  const retry = Number(res.headers.get("Retry-After"));
  const resetAt = Number.isFinite(reset) ? new Date(reset) : retry > 0 ? new Date(Date.now() + retry * 1000) : undefined;
  return { status: res.status, code: e.code, key, resetAt };
}

// Đường dẫn trong site để quay về sau đăng nhập. Gin kiểm lại; bỏ auth_error để khỏi lặp thông báo.
export function currentNext(): string {
  const q = new URLSearchParams(window.location.search);
  q.delete("auth_error");
  const s = q.toString();
  return window.location.pathname + (s ? `?${s}` : "");
}
