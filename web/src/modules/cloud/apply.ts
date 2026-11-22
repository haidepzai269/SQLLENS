// Lấy bản cloud đè lên dự án đang mở trên máy (SP023 / Task154).
//
// `sync.pullProject` (Task153) tạo dự án MỚI — đúng cho "kéo một dự án mình chưa có trên máy".
// Nhưng khi người dùng đang mở một dự án đã gắn cloud rồi chọn "lấy bản cloud" trong hộp thoại
// xung đột, tạo thêm một dự án trùng tên là sai ý: họ muốn nội dung trên cloud thay nội dung
// đang xem. Hàm này làm đúng việc đó, và KHÔNG đổi hành vi Task153 — không sửa, không gọi
// `pushProject`/`pullProject`.
//
// Ghi theo một transaction (`replaceProjectTabs`): tab cũ bị xóa, dự án giữ nguyên id (đang mở
// trong workspace) nên không phải chuyển tab, và hỏng giữa chừng thì IndexedDB rollback.
//
// Mạng trước, ghi sau: GET lỗi thì bản trên máy nguyên vẹn.

import { getRepository } from "@/modules/workspace/repository";
import type { WorkspaceEngine, WorkspaceProject, WorkspaceTab } from "@/modules/workspace/types";
import { getCloudProject } from "./api";
import { projectStamp } from "./status";
import {
  CloudSyncError,
  closeDb,
  currentSessionEpoch,
  failure,
  openDb,
  storageFailure,
  type SyncOptions,
} from "./sync";

export interface PullIntoResult {
  project: WorkspaceProject;
  tabs: WorkspaceTab[];
}

/**
 * Đọc bản cloud của dự án đang có trên máy rồi thay toàn bộ nội dung local bằng bản đó.
 *
 * Tab nhận id mới (giữ tên, nội dung, thứ tự); tên và engine của dự án lấy theo cloud. Trả về
 * dự án + tab mới để giao diện cập nhật store ngay, không phải nạp lại cả workspace.
 */
export async function pullIntoProject(
  projectId: string,
  options: SyncOptions = {},
): Promise<PullIntoResult> {
  // Như `pushProject`/`pullProject`: mất phiên giữa lúc đang kéo thì bản cloud vừa đọc thuộc
  // người dùng cũ. Ghi đè nội dung local và gắn liên kết cloud của người cũ là sai — người đăng
  // nhập sau trong cùng tab sẽ thấy nội dung của người trước và PUT đè lên dự án của họ.
  const epoch = currentSessionEpoch();
  const db = await openDb(options.factory);
  try {
    const repo = getRepository(db);

    let local: WorkspaceProject | undefined;
    try {
      local = await repo.getProject(projectId);
    } catch (err) {
      throw storageFailure(err);
    }
    if (!local) {
      throw new CloudSyncError("LOCAL_NOT_FOUND", "Không tìm thấy dự án trên máy");
    }
    if (!local.cloud) {
      throw new CloudSyncError("FAILED", "Dự án này chưa từng lưu lên cloud");
    }

    let remote;
    try {
      remote = await getCloudProject(local.cloud.remoteId, { fetchImpl: options.fetchImpl });
    } catch (err) {
      throw failure(err);
    }

    const now = options.now ?? Date.now;
    const newId = options.newId ?? (() => crypto.randomUUID());
    const at = now();
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

    // Dự án trên cloud luôn có ít nhất một tab (tạo từ workspace). Không có tab nào thì thay
    // bằng rỗng sẽ để lại dự án trống không mở được, nên báo lỗi và giữ nguyên bản trên máy.
    if (tabs.length === 0) {
      throw new CloudSyncError("REJECTED", "Dự án trên cloud không có tab nào", undefined, "empty_project");
    }

    // Kiểm TRƯỚC khi ghi: mất phiên giữa lúc chờ mạng thì phải dừng, không ghi nội dung của
    // người dùng cũ đè lên dự án đang mở trên máy.
    if (epoch !== currentSessionEpoch()) {
      throw new CloudSyncError("AUTH_REQUIRED", "Phiên đăng nhập đã đổi trong lúc đang kéo dự án");
    }

    const project: WorkspaceProject = {
      ...local,
      name: remote.name,
      engine: remote.engine as WorkspaceEngine,
      updatedAt: at,
      cloud: {
        remoteId: remote.id,
        remoteUpdatedAt: remote.updatedAt,
        stamp: projectStamp({ name: remote.name, engine: remote.engine as WorkspaceEngine }, tabs),
      },
    };

    try {
      await repo.replaceProjectTabs(project, tabs);
    } catch (err) {
      throw storageFailure(err);
    }

    return { project, tabs };
  } finally {
    closeDb(db);
  }
}
