# Task123: Store workspace & autosave debounce

Thuộc: SP019 / STR089
Mục tiêu: Dựng store trạng thái workspace và bộ autosave gộp ghi, để gõ phím không tạo hàng trăm giao dịch IndexedDB.

Phạm vi:
- `web/src/modules/workspace/store.ts`
- `web/src/modules/workspace/autosave.ts`
- `web/src/modules/workspace/autosave.test.ts`

Không làm:
- Không làm UI (Task125, Task127).
- Không sửa `lab-workspace.tsx` (Task124).
- Không lưu lên server.

Hợp đồng:
- `useWorkspaceStore` (zustand) với state: `scope`, `projects`, `tabs`, `activeProjectId`, `activeTabId`, `saveState: "idle" | "saving" | "error"`, `saveError: string | null`.
- Actions: `setScope(scope)`, `hydrate(payload)`, `createProject({ name, engine })`, `renameProject(id, name)`, `deleteProject(id)`, `setActiveProject(id)`, `createTab(projectId)`, `renameTab(id, name)`, `closeTab(id)`, `reorderTab(id, toIndex)`, `updateTabSql(id, sql)`.
- `createAutosave({ save, delayMs = 300 })` trả `{ schedule(key, payload), flush(): Promise<void>, dispose(): Promise<void> }`.

Tiêu chí xong:
- AC1: Gọi `schedule` 5 lần trong 200ms cho cùng một key chỉ ghi đúng 1 lần, với payload của lần cuối.
- AC2: `flush()` ghi ngay phần đang chờ và trả về sau khi ghi xong; `dispose()` hủy timer, flush nốt, gỡ listener.
- AC3: Ghi lỗi thì `saveState = "error"` kèm thông điệp, dữ liệu trong RAM không bị mất, lần sửa kế tiếp vẫn thử ghi lại.
- AC4: `closeTab` khi còn 1 tab không xóa tab cuối; `closeTab` tab đang mở chọn tab kế bên.
- AC5: `reorderTab` cập nhật `position` liên tục 0..n-1, không để khoảng trống.
- AC6: Unit test dùng fake timer, phủ AC1–AC5.

Ca biên: `updateTabSql` với chuỗi 2MB; `dispose()` gọi hai lần; `flush()` khi không có gì chờ; tab id không tồn tại.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/workspace/autosave.test.ts`.
Góc review thêm: đúng logic, test thật.
Đọc thêm: `_bmad-output/SP019/STR089/Task122/task122.md` (hợp đồng repository).
