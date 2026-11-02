// Không có trường chứa SQL hay nội dung người dùng. Khớp định dạng lỗi của Gin (Task009).
export type ApiError = { error: { code: string; messageKey: string } };

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const e = (value as { error?: unknown }).error;
  if (typeof e !== "object" || e === null) return false;
  const { code, messageKey } = e as Record<string, unknown>;
  return typeof code === "string" && typeof messageKey === "string";
}
