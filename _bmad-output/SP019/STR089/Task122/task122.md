# Task122: Nền IndexedDB & repository workspace 2 tầng scope

Thuộc: SP019 / STR089
Mục tiêu: Xây lớp lưu trữ IndexedDB cho workspace, tách dữ liệu theo hai scope `guest` và `user_<uuid>` để dùng chung máy không lẫn nháp của nhau.

Phạm vi:
- `web/src/modules/workspace/types.ts`
- `web/src/modules/workspace/db.ts`
- `web/src/modules/workspace/repository.ts`
- `web/src/modules/workspace/repository.test.ts`

Không làm:
- Không làm store Zustand (Task123).
- Không sửa `lab-workspace.tsx` (Task124).
- Không đồng bộ cloud, không gọi API.

Hợp đồng:
- `type WorkspaceScope = { kind: "guest" } | { kind: "user"; userId: string }`
- `scopeKey(scope: WorkspaceScope): string` trả `guest` hoặc `user_<uuid>`.
- `type WorkspaceEngine = "postgres" | "mysql" | "sqlite"`
- `interface WorkspaceProject { id: string; scopeKey: string; name: string; engine: WorkspaceEngine; createdAt: number; updatedAt: number }`
- `interface WorkspaceTab { id: string; projectId: string; name: string; sql: string; position: number; updatedAt: number }`
- `openWorkspaceDb(): Promise<IDBDatabase>` với `CURRENT_DB_VERSION = 1`; stores: `projects` (keyPath `id`, index `by_scope` trên `scopeKey`), `tabs` (keyPath `id`, index `by_project` trên `projectId`), `meta` (keyPath `key`).
- `class WorkspaceQuotaError extends Error { code = "WORKSPACE_QUOTA_EXCEEDED" }`
- `getRepository(db): WorkspaceRepository` với `listProjects(scope)`, `getProject(id)`, `upsertProject(record)`, `deleteProjectCascade(id)`, `listTabs(projectId)`, `upsertTab(tab)`, `deleteTab(id)`, `countTabs(projectId)`.

Tiêu chí xong:
- AC1: Tạo đúng 3 object store và 2 index như hợp đồng, mở lại DB lần hai không lỗi `VersionError`.
- AC2: Hai project cùng tên ở hai scope khác nhau cùng tồn tại; `listProjects` chỉ trả bản ghi đúng scope.
- AC3: `deleteProjectCascade` xóa project và toàn bộ tab của nó trong cùng một transaction, không đụng project khác.
- AC4: Khi IndexedDB ném `QuotaExceededError`, repository ném `WorkspaceQuotaError`; không nuốt lỗi và không trả `undefined` im lặng.
- AC5: Unit test phủ: tạo/đọc/xóa, cascade, lọc scope, id trùng, tab mồ côi.
- AC6: Không có `fetch`/`XMLHttpRequest` nào trong module (test grep).

Ca biên: xóa project không tồn tại; tab có `projectId` trỏ tới project đã xóa; DB đang mở bằng version 0; hai tab trình duyệt cùng ghi một project.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/workspace/repository.test.ts`.
Góc review thêm: đúng yêu cầu, test có kiểm tra thật (không mock IndexedDB bằng object rỗng).
Đọc thêm: `_bmad-output/BAN_NHAP_STORY_WORKSPACE_EXPORT_SHARE.md` mục 2 (STR089).
