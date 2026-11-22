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
//
// Nhưng "server đã nhận" khác "máy đã biết id của bản trên cloud": nếu bước ghi local hỏng sau
// khi POST thành công (hết dung lượng, tab bị đóng, IndexedDB bị chặn) thì bản cũ mất id và lần
// đẩy sau lại POST — sinh dự án TRÙNG trên cloud. Vì vậy liên kết vừa nhận được giữ thêm trong
// bộ nhớ module (`unpersistedLinks`) ngay sau khi server trả về, trước khi chạm IndexedDB.

import { openWorkspaceDb } from "@/modules/workspace/db";
import { flushWorkspace } from "@/modules/workspace/hydrate";
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
import { projectStamp } from "./status";

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
  | "BUSY"
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
 * Liên kết cloud đã tồn tại trên server nhưng CHƯA ghi được vào IndexedDB, giữ theo id dự án
 * local và chỉ trong bộ nhớ của tab này.
 *
 * Vì sao cần: POST đã thành công nghĩa là dự án đã nằm trên cloud và có id. Nếu bước ghi
 * IndexedDB sau đó hỏng, id đó là thứ duy nhất biết đường về dự án vừa tạo; nuốt nó đi thì lần
 * đẩy sau lại POST và sinh dự án thứ hai (409 không bao giờ xảy ra với POST, chỉ với PUT).
 *
 * Mất bộ nhớ này khi tải lại trang là chấp nhận được và KHÔNG mất dữ liệu: bản local vẫn còn,
 * chỉ là người dùng phải kéo bản trên cloud về (thấy hai dự án) thay vì bị ghi đè im lặng.
 */
const unpersistedLinks = new Map<string, { remoteId: string; remoteUpdatedAt: string }>();

/**
 * Các lượt đẩy đang chạy, theo projectId. `unpersistedLinks` chỉ chặn được hai lượt đẩy TUẦN TỰ;
 * hai lượt chạy SONG SONG (hai tab, hoặc bấm đúp trước khi nút kịp chuyển sang trạng thái bận)
 * đều đọc `cloud` chưa có rồi cùng POST → hai dự án trùng trên cloud, đúng lỗi mà bộ nhớ kia
 * vừa sửa. Chặn bằng cách từ chối lượt thứ hai thay vì xếp hàng: người dùng bấm lại được, còn
 * xếp hàng thì hai lượt vẫn nối tiếp nhau và lượt sau ghi đè lượt trước một cách im lặng.
 */
const inFlight = new Set<string>();

/** Chỉ dùng cho test: quên các liên kết còn trong bộ nhớ giữa các ca. */
export function forgetUnpersistedLinks(): void {
  unpersistedLinks.clear();
  inFlight.clear();
}

/**
 * Kết quả đẩy. `conflict` mang đủ hai mốc để UI hiển thị "bản trên cloud lúc X, bản trên máy
 * lúc Y" mà không phải gọi thêm API.
 *
 * `remote_gone`: server trả 404 cho `remoteId` đã lưu, tức dự án trên cloud đã bị xóa ở nơi
 * khác. Trả trạng thái riêng thay vì ném lỗi để UI phân biệt được với lỗi mạng và hỏi người
 * dùng; hàm KHÔNG tự xóa liên kết (đó là quyết định của người dùng).
 */
export type PushResult =
  | {
      kind: "ok";
      updatedAt: string;
      /** Id bản cloud — lần tạo mới thì đây là lần duy nhất giao diện biết được nó (Task154). */
      remoteId: string;
      /** Dấu vân tay nội dung vừa gửi, để giao diện biết local còn khớp cloud hay không. */
      stamp: string;
    }
  | { kind: "conflict"; remoteUpdatedAt: string; localUpdatedAt: number }
  | { kind: "remote_gone"; remoteId: string };

export interface SyncOptions {
  /** Test truyền IndexedDB giả. */
  factory?: IDBFactory;
  /** Test truyền fetch giả. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  newId?: () => string;
  /**
   * Bỏ qua liên kết cloud đang có và đẩy lên thành dự án MỚI (POST). Dùng sau `remote_gone`:
   * người dùng đã đồng ý đẩy lại thay vì kéo bản khác về.
   */
  asNew?: boolean;
}

// `apply.ts` (Task154) dùng lại đúng bốn hàm dưới đây để lỗi và cách mở IndexedDB không bị
// viết lại lần hai.
export async function openDb(factory?: IDBFactory): Promise<IDBDatabase> {
  try {
    return await openWorkspaceDb(factory);
  } catch (err) {
    throw new CloudSyncError("STORAGE_UNAVAILABLE", "Trình duyệt không cho mở bộ nhớ cục bộ", err);
  }
}

export function closeDb(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // db có thể đã đóng do lỗi transaction
  }
}

export function failure(err: unknown): CloudSyncError {
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

export function storageFailure(err: unknown): CloudSyncError {
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
  // Vừa kéo về thì local khớp cloud: ghi luôn dấu vân tay để panel hiện `synced`.
  project.cloud = { ...project.cloud!, stamp: projectStamp(project, tabs) };

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
 * Gỡ liên kết cloud của một dự án local, để lần đẩy sau là POST (tạo dự án mới).
 *
 * Vì sao cần: khi dự án trên cloud đã bị xóa, `remoteId` còn trong IndexedDB làm mọi lần đẩy
 * sau PUT vào id đã chết và nhận 404 mãi. Chỉ gỡ liên kết, KHÔNG đụng tên/tab/createdAt của
 * người dùng; và chỉ chạy khi người dùng đã đồng ý (`pushProject(..., { asNew: true })` cũng
 * làm việc này). Chỉ ghi trường `cloud` của dự án nên gần như không thể hết dung lượng.
 */
export async function detachCloudLink(projectId: string, options: SyncOptions = {}): Promise<void> {
  const db = await openDb(options.factory);
  try {
    const repo = getRepository(db);
    let project: WorkspaceProject | undefined;
    try {
      project = await repo.getProject(projectId);
    } catch (err) {
      throw storageFailure(err);
    }
    if (!project) {
      throw new CloudSyncError("LOCAL_NOT_FOUND", "Không tìm thấy dự án trên máy");
    }
    if (!project.cloud) {
      unpersistedLinks.delete(projectId);
      return;
    }
    const rest: WorkspaceProject = { ...project };
    delete rest.cloud;
    try {
      await repo.upsertProject(rest);
    } catch (err) {
      throw storageFailure(err);
    }
    unpersistedLinks.delete(projectId);
  } finally {
    closeDb(db);
  }
}

/**
 * Đẩy một dự án cục bộ lên cloud.
 *
 * Chưa từng đồng bộ thì tạo mới (POST). Đã từng thì ghi đè có điều kiện bằng `baseUpdatedAt`
 * (PUT). Server đổi trước → 409 → trả `conflict`, bản local giữ nguyên. Dự án đã bị xóa trên
 * cloud → `remote_gone`, để UI hỏi người dùng có đẩy lên thành dự án mới hay không.
 */
export async function pushProject(projectId: string, options: SyncOptions = {}): Promise<PushResult> {
  if (inFlight.has(projectId)) {
    throw new CloudSyncError("BUSY", "Dự án này đang được đẩy lên cloud, chờ một chút rồi thử lại");
  }
  inFlight.add(projectId);
  let db: IDBDatabase;
  try {
    // Autosave ghi tab xuống IndexedDB qua debounce (mặc định 300 ms), còn hàm này đọc tab từ
    // IndexedDB. Không flush trước thì "gõ thêm một câu rồi bấm Lưu ngay" sẽ đẩy bản CŨ lên
    // cloud, panel báo đã lưu, và phần vừa gõ chỉ còn trên máy — đóng tab là mất.
    await flushWorkspace();
    db = await openDb(options.factory);
  } catch (err) {
    // Mở bộ nhớ hỏng thì phải nhả khóa, nếu không dự án kẹt ở trạng thái "đang đẩy" mãi.
    inFlight.delete(projectId);
    throw err;
  }
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

    // `asNew` bỏ qua liên kết cũ (người dùng đã đồng ý đẩy lên thành dự án mới). Còn lại dùng
    // liên kết đã ghi trong IndexedDB, hoặc liên kết còn kẹt trong bộ nhớ từ lần ghi local hỏng.
    const link = options.asNew ? undefined : (project.cloud ?? unpersistedLinks.get(projectId));

    const payload: CloudProjectPayload = {
      name: project.name,
      engine: project.engine,
      tabs: tabs.map((tab) => ({ name: tab.name, sql: tab.sql })),
      baseUpdatedAt: link?.remoteUpdatedAt,
    };

    const stamp = projectStamp(project, tabs);

    let remote;
    try {
      remote = link
        ? await updateCloudProject(link.remoteId, payload, { fetchImpl: options.fetchImpl })
        : await createCloudProject(payload, { fetchImpl: options.fetchImpl });
    } catch (err) {
      if (err instanceof CloudConflictError) {
        // Không ghi gì cả: quyền quyết định thuộc về người dùng (UI ở Task154).
        return { kind: "conflict", remoteUpdatedAt: err.remoteUpdatedAt, localUpdatedAt: project.updatedAt };
      }
      // 404 khi PUT: dự án trên cloud đã bị xóa. Trả trạng thái riêng, KHÔNG tự xóa liên kết:
      // người dùng có thể muốn kéo bản khác về hoặc đẩy bản này lên thành dự án mới.
      if (link && err instanceof CloudApiError && err.status === 404) {
        return { kind: "remote_gone", remoteId: link.remoteId };
      }
      throw failure(err);
    }

    // Ghi vào bộ nhớ NGAY, trước khi chạm IndexedDB: từ đây id của server không bị mất, kể cả
    // khi bước ghi dưới đây hỏng. Nhờ vậy lần đẩy sau là PUT, không phải POST lần hai.
    unpersistedLinks.set(projectId, { remoteId: remote.id, remoteUpdatedAt: remote.updatedAt });

    const parsed = Date.parse(remote.updatedAt);
    const updatedAt = Number.isFinite(parsed) ? parsed : project.updatedAt;
    try {
      await repo.upsertProject({
        ...project,
        updatedAt,
        cloud: { remoteId: remote.id, remoteUpdatedAt: remote.updatedAt, stamp },
      });
    } catch (err) {
      // Bản trên cloud đã tồn tại và id vẫn nằm trong bộ nhớ: báo lỗi ghi local, KHÔNG báo như
      // thể chưa có gì trên cloud (comment cũ nói "lần sau nhận 409" là sai với POST).
      throw storageFailure(err);
    }
    unpersistedLinks.delete(projectId);
    return { kind: "ok", updatedAt: remote.updatedAt, remoteId: remote.id, stamp };
  } finally {
    inFlight.delete(projectId);
    closeDb(db);
  }
}
