// Kéo/đẩy dự án giữa workspace cục bộ và cloud (SP023 / Task153).
//
// Chỉ chạy khi người dùng bấm: không timer, không `setInterval`, không tự đồng bộ ngầm, và
// không có chỗ nào gọi mạng lúc import module (AC5 kiểm bằng grep + test).
//
// Không ghi đè im lặng: mỗi lần đẩy gửi kèm `baseUpdatedAt` là mốc server của lần đồng bộ
// trước. Server trả 409 khi bên kia đã sửa, hàm trả `{ kind: "conflict" }` để UI hỏi người
// dùng, và KHÔNG ghi gì vào IndexedDB.
//
// Thứ tự ghi: gọi mạng trước, chỉ ghi IndexedDB sau khi server đã nhận. Mất mạng giữa đường
// thì bản local nguyên vẹn và lần đẩy sau chạy lại được.

import { openWorkspaceDb } from "@/modules/workspace/db";
import { getRepository, WorkspaceQuotaError } from "@/modules/workspace/repository";
import {
  scopeKey,
  type WorkspaceEngine,
  type WorkspaceProject,
  type WorkspaceScope,
  type WorkspaceTab,
} from "@/modules/workspace/types";
import {
  CloudApiError,
  CloudConflictError,
  createCloudProject,
  getCloudProject,
  updateCloudProject,
  type CloudProjectPayload,
} from "./api";

export type CloudSyncErrorCode =
  | "STORAGE_UNAVAILABLE"
  | "QUOTA_EXCEEDED"
  | "NETWORK"
  | "AUTH_REQUIRED"
  | "NOT_FOUND"
  | "LOCAL_NOT_FOUND"
  | "UNAVAILABLE"
  | "REJECTED"
  | "TOO_LARGE"
  | "FAILED";

export class CloudSyncError extends Error {
  readonly code: CloudSyncErrorCode;
  /** Mã lỗi cụ thể của server (`too_many_tabs`, `tab_too_large`…) khi bị từ chối 400/413. */
  readonly serverCode?: string;

  constructor(code: CloudSyncErrorCode, message: string, cause?: unknown, serverCode?: string) {
    super(message);
    this.name = "CloudSyncError";
    this.code = code;
    this.cause = cause;
    this.serverCode = serverCode;
    Object.setPrototypeOf(this, CloudSyncError.prototype);
  }
}

/**
 * Kết quả đẩy. `conflict` mang đủ hai mốc để UI hiển thị "bản trên cloud lúc X, bản trên máy
 * lúc Y" mà không phải gọi thêm API.
 */
export type PushResult =
  | { kind: "ok"; updatedAt: string }
  | { kind: "conflict"; remoteUpdatedAt: string; localUpdatedAt: number };

export interface SyncOptions {
  /** Test truyền IndexedDB giả. */
  factory?: IDBFactory;
  /** Test truyền fetch giả. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  newId?: () => string;
}

async function openDb(factory?: IDBFactory): Promise<IDBDatabase> {
  try {
    return await openWorkspaceDb(factory);
  } catch (err) {
    throw new CloudSyncError("STORAGE_UNAVAILABLE", "Trình duyệt không cho mở bộ nhớ cục bộ", err);
  }
}

function closeDb(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // db có thể đã đóng do lỗi transaction
  }
}

function failure(err: unknown): CloudSyncError {
  if (err instanceof CloudSyncError) return err;
  if (err instanceof CloudApiError) {
    if (err.status === 401) return new CloudSyncError("AUTH_REQUIRED", "Phiên đăng nhập đã hết hạn", err);
    if (err.status === 404) return new CloudSyncError("NOT_FOUND", "Dự án không còn trên cloud", err);
    if (err.status === 0 || err.status >= 500) return new CloudSyncError("UNAVAILABLE", "Máy chủ cloud tạm thời không dùng được", err);
    // 413 (body > 1MB) và 400 (quá số tab, tab quá lớn, engine lạ) là lỗi dữ liệu, không phải
    // lỗi mạng: mang theo mã của server để UI dịch đúng thông báo.
    if (err.status === 413) return new CloudSyncError("TOO_LARGE", "Dự án quá lớn để lưu lên cloud", err, err.code);
    if (err.status === 400) return new CloudSyncError("REJECTED", "Máy chủ từ chối nội dung dự án", err, err.code);
    return new CloudSyncError("FAILED", "Máy chủ cloud từ chối yêu cầu", err);
  }
  return new CloudSyncError("NETWORK", "Không kết nối được máy chủ cloud", err);
}

function storageFailure(err: unknown): CloudSyncError {
  if (err instanceof WorkspaceQuotaError) {
    return new CloudSyncError("QUOTA_EXCEEDED", "Bộ nhớ trình duyệt đã đầy nên không lưu được dự án", err);
  }
  return new CloudSyncError("FAILED", "Không ghi được dự án vào bộ nhớ cục bộ", err);
}

/**
 * Kéo một dự án cloud về thành dự án MỚI trong workspace cục bộ.
 *
 * Tab nhận id mới, giữ nguyên tên/nội dung/thứ tự; engine giữ nguyên. Ghi dự án và toàn bộ tab
 * trong một transaction nên hết dung lượng giữa chừng không để lại dự án rỗng.
 */
export async function pullProject(
  remoteId: string,
  scope: WorkspaceScope,
  options: SyncOptions = {},
): Promise<WorkspaceProject> {
  let remote;
  try {
    remote = await getCloudProject(remoteId, { fetchImpl: options.fetchImpl });
  } catch (err) {
    throw failure(err);
  }

  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const at = now();
  const projectId = newId();

  const project: WorkspaceProject = {
    id: projectId,
    scopeKey: scopeKey(scope),
    name: remote.name,
    engine: remote.engine as WorkspaceEngine,
    createdAt: at,
    updatedAt: at,
    cloud: { remoteId: remote.id, remoteUpdatedAt: remote.updatedAt },
  };
  const tabs: WorkspaceTab[] = [...(remote.tabs ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((tab, index) => ({
      id: newId(),
      projectId,
      name: tab.name,
      sql: tab.sql,
      position: index,
      updatedAt: at,
    }));

  const db = await openDb(options.factory);
  try {
    await getRepository(db).putProjectWithTabs(project, tabs);
  } catch (err) {
    throw storageFailure(err);
  } finally {
    closeDb(db);
  }
  return project;
}

/**
 * Đẩy một dự án cục bộ lên cloud.
 *
 * Chưa từng đồng bộ thì tạo mới (POST). Đã từng thì ghi đè có điều kiện bằng `baseUpdatedAt`
 * (PUT). Server đổi trước → 409 → trả `conflict`, bản local giữ nguyên.
 */
export async function pushProject(projectId: string, options: SyncOptions = {}): Promise<PushResult> {
  const db = await openDb(options.factory);
  try {
    const repo = getRepository(db);
    let project: WorkspaceProject | undefined;
    let tabs: WorkspaceTab[];
    try {
      project = await repo.getProject(projectId);
      tabs = project ? await repo.listTabs(projectId) : [];
    } catch (err) {
      throw storageFailure(err);
    }
    if (!project) {
      throw new CloudSyncError("LOCAL_NOT_FOUND", "Không tìm thấy dự án trên máy");
    }

    const payload: CloudProjectPayload = {
      name: project.name,
      engine: project.engine,
      tabs: tabs.map((tab) => ({ name: tab.name, sql: tab.sql })),
      baseUpdatedAt: project.cloud?.remoteUpdatedAt,
    };

    let remote;
    try {
      remote = project.cloud
        ? await updateCloudProject(project.cloud.remoteId, payload, { fetchImpl: options.fetchImpl })
        : await createCloudProject(payload, { fetchImpl: options.fetchImpl });
    } catch (err) {
      if (err instanceof CloudConflictError) {
        // Không ghi gì cả: quyền quyết định thuộc về người dùng (UI ở Task154).
        return { kind: "conflict", remoteUpdatedAt: err.remoteUpdatedAt, localUpdatedAt: project.updatedAt };
      }
      throw failure(err);
    }

    // Chỉ từ đây mới ghi IndexedDB. Nếu bước này hỏng (hết dung lượng), dữ liệu đã nằm trên
    // cloud nhưng máy chưa biết: lần đẩy sau sẽ nhận 409 và người dùng kéo lại, không mất gì.
    const parsed = Date.parse(remote.updatedAt);
    const updatedAt = Number.isFinite(parsed) ? parsed : project.updatedAt;
    try {
      await repo.upsertProject({
        ...project,
        updatedAt,
        cloud: { remoteId: remote.id, remoteUpdatedAt: remote.updatedAt },
      });
    } catch (err) {
      throw storageFailure(err);
    }
    return { kind: "ok", updatedAt: remote.updatedAt };
  } finally {
    closeDb(db);
  }
}
