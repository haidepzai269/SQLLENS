// Trạng thái cloud của từng dự án (SP023 / Task154).
//
// "Đã lưu" hay "có thay đổi" KHÔNG so đồng hồ: `pushProject` ghi mốc server vào
// `project.updatedAt`, mà đồng hồ server có thể nhanh hơn máy vài giây — gõ thêm một câu ngay
// sau khi lưu vẫn bị coi là chưa đổi. Thay vào đó, mỗi lần lưu ta ghi lại dấu vân tay nội dung
// đã gửi (`cloud.stamp`); nội dung hiện tại khác dấu đó nghĩa là đã sửa.
//
// Hàm ở đây thuần, không đụng mạng, không đụng IndexedDB, không đọc `Date.now()`.

import type { WorkspaceProject, WorkspaceTab } from "@/modules/workspace/types";

/**
 * `local`: chỉ nằm trên máy. `synced`: khớp bản cloud. `modified`: đã sửa sau lần lưu cuối.
 * `conflict`: lần lưu gần nhất bị server từ chối vì máy khác đã sửa trước — trạng thái này chỉ
 * tồn tại trong phiên (hộp thoại chọn giữ bản máy / lấy bản cloud), không lưu xuống đĩa.
 */
export type CloudProjectState = "local" | "synced" | "modified" | "conflict";

/** FNV-1a 32 bit. Không phải mật mã: chỉ để nhận ra nội dung có đổi hay không. */
function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Dấu vân tay nội dung sẽ gửi lên cloud: tên dự án, engine, và từng tab theo đúng thứ tự
 * (tên tab + SQL). Cố ý gồm cả tên tab: đổi tên tab cũng là thay đổi chưa lưu.
 *
 * `position` không đưa vào chuỗi băm mà lấy theo thứ tự sau khi sắp xếp — cùng một bộ tab thì
 * kéo thả qua lại vẫn ra cùng dấu, và thứ tự tab có đổi thật thì vẫn đổi dấu.
 */
export function projectStamp(
  project: Pick<WorkspaceProject, "name" | "engine">,
  tabs: readonly WorkspaceTab[],
): string {
  const ordered = [...tabs]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((tab) => [tab.name, tab.sql]);
  return fnv1aHex(JSON.stringify([project.name, project.engine, ordered]));
}

/** Tab của một dự án, đã sắp xếp theo vị trí (thứ tự hiển thị trong workspace). */
export function projectTabs(tabs: readonly WorkspaceTab[], projectId: string): WorkspaceTab[] {
  return tabs
    .filter((tab) => tab.projectId === projectId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * Trạng thái của một dự án. Hàm không biết gì về xung đột đang chờ trong phiên — panel tự
 * chuyển sang `conflict` khi server trả 409.
 */
export function projectCloudState(
  project: WorkspaceProject,
  tabs: readonly WorkspaceTab[],
): CloudProjectState {
  if (!project.cloud) return "local";
  // Bản ghi tạo trước Task154 chưa có `stamp`: coi như khớp, lần lưu kế tiếp sẽ bổ sung.
  if (!project.cloud.stamp) return "synced";
  return projectStamp(project, projectTabs(tabs, project.id)) === project.cloud.stamp
    ? "synced"
    : "modified";
}
