// Kiểu dữ liệu của workspace cục bộ. Tách theo scope để dùng chung máy không lẫn nháp của nhau.

export type WorkspaceScope = { kind: "guest" } | { kind: "user"; userId: string };

export type WorkspaceEngine = "postgres" | "mysql" | "sqlite";

// Liên kết tới bản lưu trên cloud (Task153). Thiếu trường này nghĩa là dự án chỉ nằm trên máy.
// `remoteUpdatedAt` là mốc của server ở lần kéo/đẩy gần nhất, dùng làm `baseUpdatedAt` để
// server từ chối ghi đè khi máy khác đã sửa trước.
export interface WorkspaceCloudLink {
  remoteId: string;
  remoteUpdatedAt: string;
}

export interface WorkspaceProject {
  id: string;
  scopeKey: string;
  name: string;
  engine: WorkspaceEngine;
  createdAt: number;
  updatedAt: number;
  cloud?: WorkspaceCloudLink;
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
