// Mở một phòng vừa tham gia trong workspace cục bộ (SP024 / STR113 / Task162).
//
// Sau khi `POST /join` thành công, dự án có thể CHƯA có trên máy người nhận. Hai đường:
//   1. Đã có dự án local gắn `cloud.remoteId` đúng id đó → mở lại chính nó. Kéo thêm lần nữa sẽ
//      nhân bản dự án và để người dùng thấy hai bản giống nhau.
//   2. Chưa có → `pullProject` (Task153) kéo về thành dự án MỚI trong một transaction IndexedDB.
//
// Không hàm nào gửi nội dung SQL lên mạng: `pullProject` chỉ GET dự án và ghi local (Core Rule 7).

import { closeDb, openDb, pullProject, CloudSyncError } from "@/modules/cloud/sync";
import { getRepository } from "@/modules/workspace/repository";
import type { WorkspaceScope } from "@/modules/workspace/types";
import { RoomApiError } from "./api";

export type JoinErrorKind =
  | "expired"
  | "invalid"
  | "forbidden"
  | "auth"
  | "network"
  | "storage"
  | "failed";

/**
 * Dịch lỗi của `POST /join` và của bước kéo dự án sang câu giao diện.
 *
 * 410 và 404 phải khác nhau: link hết hạn cần "xin link mới", link sai hoặc phòng đã xoá cần
 * "xin người gửi kiểm lại". Gộp hai ca thành một là nói sai việc người dùng phải làm.
 */
export function classifyJoinError(err: unknown): JoinErrorKind {
  if (err instanceof RoomApiError) {
    if (err.status === 401) return "auth";
    if (err.status === 403) return "forbidden";
    if (err.status === 410) return "expired";
    if (err.status === 404) return "invalid";
    if (err.status === 0 || err.status >= 500) return "network";
    return "failed";
  }
  if (err instanceof CloudSyncError) {
    switch (err.code) {
      case "AUTH_REQUIRED":
        return "auth";
      case "NOT_FOUND":
        return "invalid";
      case "NETWORK":
      case "UNAVAILABLE":
        return "network";
      case "STORAGE_UNAVAILABLE":
      case "QUOTA_EXCEEDED":
        return "storage";
      default:
        return "failed";
    }
  }
  // Lỗi mạng của `fetch` là TypeError, không phải RoomApiError.
  if (err instanceof TypeError) return "network";
  return "failed";
}

export interface JoinedProject {
  /** Id dự án trong IndexedDB của máy này. */
  projectId: string;
  /** `true` khi phải kéo dự án từ cloud về, `false` khi đã có sẵn trên máy. */
  pulled: boolean;
}

export interface EnsureProjectOptions {
  factory?: IDBFactory;
  now?: () => number;
  newId?: () => string;
  fetchImpl?: typeof fetch;
}

/**
 * Tìm dự án local đã liên kết `cloud.remoteId` rồi trả id; không thấy thì kéo bản cloud về.
 *
 * Chỉ so `cloud.remoteId`, không so tên: hai dự án trùng tên là chuyện bình thường, còn hai bản
 * local cùng trỏ một dự án cloud là bản sao không mong muốn.
 */
export async function ensureJoinedProject(
  remoteId: string,
  scope: WorkspaceScope,
  options: EnsureProjectOptions = {},
): Promise<JoinedProject> {
  let existing: string | null = null;
  const db = await openDb(options.factory);
  try {
    try {
      const projects = await getRepository(db).listProjects(scope);
      existing = projects.find((p) => p.cloud?.remoteId === remoteId)?.id ?? null;
    } catch (err) {
      if (err instanceof CloudSyncError) throw err;
      throw new CloudSyncError("STORAGE_UNAVAILABLE", "Could not read local workspace", err);
    }
  } finally {
    closeDb(db);
  }
  if (existing) return { projectId: existing, pulled: false };

  const project = await pullProject(remoteId, scope, options);
  return { projectId: project.id, pulled: true };
}

/**
 * Lỗi lưu máy luôn đi qua `CloudSyncError`: `openDb` (bị chặn IndexedDB), `listProjects` (lỗi
 * transaction/nâng version khi đọc danh sách) và `pullProject` (hết dung lượng) đều đã dịch
 * sẵn, nên `classifyJoinError` nhận được `storage` chứ không phải `failed`.
 */
