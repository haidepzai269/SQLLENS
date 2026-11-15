// Kiểu dữ liệu của workspace cục bộ. Tách theo scope để dùng chung máy không lẫn nháp của nhau.

export type WorkspaceScope = { kind: "guest" } | { kind: "user"; userId: string };

export type WorkspaceEngine = "postgres" | "mysql" | "sqlite";

export interface WorkspaceProject {
  id: string;
  scopeKey: string;
  name: string;
  engine: WorkspaceEngine;
  createdAt: number;
  updatedAt: number;
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
