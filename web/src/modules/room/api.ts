// Lớp gọi API phòng cộng tác (SP024 / STR113 / Task162).
//
// Chỉ là HTTP: không đụng IndexedDB, không giữ trạng thái. Ba đường dẫn dưới đây là hợp đồng
// Task161 (invite, join) và endpoint đọc danh sách thành viên thêm ở task này (D1 trong
// `task162.md`).
//
// Không log gì ở đây: Core Rule 7. Request của module này chỉ mang token/id, không bao giờ mang
// nội dung tab, nên 0 byte SQL rời máy.

import { isApiError } from "@/contracts/api-error";

export type RoomRole = "owner" | "editor" | "viewer";

/**
 * Vai trò chưa biết vẫn được giữ hàng: server có thể thêm vai trò mới trước khi bản web này cập
 * nhật, và bỏ im lặng một hàng khiến danh sách trông như phòng mất chủ.
 */
export type RoomMemberRole = RoomRole | "unknown";

export type RoomMember = {
  userId: string;
  name: string;
  role: RoomMemberRole;
};

export type RoomInvite = {
  token: string;
  role: RoomRole;
  expiresAt: string;
};

export type RoomJoinResult = {
  projectId: string;
  role: RoomRole;
  alreadyMember: boolean;
};

export class RoomApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RoomApiError";
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, RoomApiError.prototype);
  }
}

export interface RoomRequestOptions {
  /** Test truyền fetch giả; mặc định fetch của trình duyệt. */
  fetchImpl?: typeof fetch;
}

const BASE = "/api/v1/cloud/projects";

const ROLES: readonly RoomRole[] = ["owner", "editor", "viewer"];

function roleFrom(value: unknown): RoomRole | null {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value) ? (value as RoomRole) : null;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Thông điệp của RoomApiError chỉ phục vụ debug nội bộ; UI luôn dịch qua `room.json`, không
// render trực tiếp `err.message`.
function failureFrom(status: number, body: unknown): RoomApiError {
  const code = isApiError(body) ? body.error.code : "unknown";
  return new RoomApiError(status, code, `Room API request failed (${status})`);
}

async function send(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body: unknown,
  options: RoomRequestOptions,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await readJson(res);
  if (!res.ok) throw failureFrom(res.status, payload);
  return payload;
}

/** Tạo liên kết mời 24 giờ cho một dự án. Chỉ chủ dự án; server trả 403 cho người khác. */
export async function createInvite(
  projectId: string,
  options: RoomRequestOptions = {},
): Promise<RoomInvite> {
  const payload = await send("POST", `${BASE}/${encodeURIComponent(projectId)}/invite`, undefined, options);
  const invite = (payload as { token?: unknown; role?: unknown; expiresAt?: unknown } | null) ?? {};
  const role = roleFrom(invite.role);
  if (typeof invite.token !== "string" || !invite.token || !role || typeof invite.expiresAt !== "string") {
    throw new RoomApiError(0, "invalid_response", "Invalid room invite payload");
  }
  return { token: invite.token, role, expiresAt: invite.expiresAt };
}

/** Đổi token mời thành tư cách thành viên. Người nhận có thể chưa từng thấy dự án này. */
export async function joinRoom(
  token: string,
  options: RoomRequestOptions = {},
): Promise<RoomJoinResult> {
  const payload = await send("POST", `${BASE}/join`, { token }, options);
  const result = (payload as { projectId?: unknown; role?: unknown; alreadyMember?: unknown } | null) ?? {};
  const role = roleFrom(result.role);
  if (typeof result.projectId !== "string" || !result.projectId || !role) {
    throw new RoomApiError(0, "invalid_response", "Invalid room join payload");
  }
  return { projectId: result.projectId, role, alreadyMember: result.alreadyMember === true };
}

/**
 * Đọc danh sách thành viên của phòng. Chỉ chủ dự án đọc được; thành viên thường nhận 403 vì
 * policy SELECT của `cloud_project_members` chỉ cho họ thấy hàng của chính mình — trả danh sách
 * cụt sẽ là nói dối người dùng.
 *
 * Hàng thiếu `userId`/`name` bị bỏ qua thay vì làm hỏng cả danh sách: đây là dữ liệu qua mạng,
 * không tin kiểu. Vai trò lạ thì giữ hàng với nhãn "unknown", không bỏ người khỏi danh sách.
 */
export async function listMembers(
  projectId: string,
  options: RoomRequestOptions = {},
): Promise<RoomMember[]> {
  const payload = await send("GET", `${BASE}/${encodeURIComponent(projectId)}/members`, undefined, options);
  const raw = (payload as { members?: unknown } | null)?.members;
  if (!Array.isArray(raw)) {
    throw new RoomApiError(0, "invalid_response", "Invalid room members payload");
  }
  return raw.flatMap((item): RoomMember[] => {
    if (typeof item !== "object" || item === null) return [];
    const m = item as Record<string, unknown>;
    if (typeof m.userId !== "string" || typeof m.name !== "string") return [];
    return [{ userId: m.userId, name: m.name, role: roleFrom(m.role) ?? "unknown" }];
  });
}

/** Thu hồi quyền tham gia phòng của một thành viên. Chỉ chủ dự án; server trả 403 cho người khác. */
export async function removeMember(
  projectId: string,
  memberUserId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await send(
    "DELETE",
    `${BASE}/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberUserId)}`,
    undefined,
    { fetchImpl },
  );
}

/** Liên kết mời dùng chung: token nằm trong query, không có payload SQL nào. */
export function inviteUrl(origin: string, locale: string, token: string): string {
  return `${origin}/${locale}/join?token=${encodeURIComponent(token)}`;
}
