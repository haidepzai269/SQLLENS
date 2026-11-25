// Kiểu dữ liệu của workspace cục bộ. Tách theo scope để dùng chung máy không lẫn nháp của nhau.

export type WorkspaceScope = { kind: "guest" } | { kind: "user"; userId: string };

export type WorkspaceEngine = "postgres" | "mysql" | "sqlite";

// Liên kết tới bản lưu trên cloud (Task153). Thiếu trường này nghĩa là dự án chỉ nằm trên máy.
// `remoteUpdatedAt` là mốc của server ở lần kéo/đẩy gần nhất, dùng làm `baseUpdatedAt` để
// server từ chối ghi đè khi máy khác đã sửa trước.
//
// `stamp` là dấu vân tay nội dung đã gửi lên cloud (Task154). So nó với nội dung hiện tại cho
// biết dự án đã bị sửa sau lần lưu hay chưa — không dựa vào đồng hồ, nên máy lệch giờ so với
// server vẫn đúng. Bản ghi tạo trước Task154 không có trường này: coi như đã lưu cho tới lần
// lưu kế tiếp.
export interface WorkspaceCloudLink {
  remoteId: string;
  remoteUpdatedAt: string;
  stamp?: string;
}

export interface WorkspaceRoomForkLink {
  projectId: string;
  forkedAt: number;
}

export interface WorkspaceProject {
  id: string;
  scopeKey: string;
  name: string;
  engine: WorkspaceEngine;
  createdAt: number;
  updatedAt: number;
  cloud?: WorkspaceCloudLink;
  /** Đánh dấu dự án được fork từ phòng cộng tác (Task167); không đồng bộ lên cloud hay projectStamp. */
  roomFork?: WorkspaceRoomForkLink;
}

export interface WorkspaceTab {
  id: string;
  projectId: string;
  name: string;
  sql: string;
  position: number;
  updatedAt: number;
}

// `guest` là nháp chưa đăng nhập; `user_<uuid>` là nháp của một tài khoản cụ thể.
export function scopeKey(scope: WorkspaceScope): string {
  return scope.kind === "guest" ? "guest" : `user_${scope.userId}`;
}
