# Task126: Chuyển tab không dựng lại sandbox & thông báo schema đổi

Thuộc: SP019 / STR090
Mục tiêu: Chuyển tab chỉ đổi tài liệu trong một CodeMirror, giữ nguyên PGlite/MySQL đang chạy, và báo cho tab khác biết khi schema vừa đổi.

Phạm vi:
- `web/src/modules/workspace/tab-runtime.ts`
- `web/src/modules/workspace/tab-runtime.test.ts`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/e2e/workspace-tabs.spec.ts`

Không làm:
- Không sửa `tab-bar.tsx` (Task125).
- Không tạo worker mới khi chuyển tab.
- Không đồng bộ schema giữa hai engine khác nhau.

Hợp đồng:
- `TabRuntime` giữ đúng một CodeMirror view; `switchTab(tabId): void` đổi document và lịch sử undo riêng từng tab.
- `notifySchemaChanged(sourceTabId: string, kind: "ddl" | "reset"): void` phát sự kiện cho các tab khác.
- `useSchemaChangedNotice(): { message: string | null; dismiss(): void }`

Tiêu chí xong:
- AC1: Chuyển tab không khởi tạo lại worker; đo được < 50ms với 5 tab.
- AC2: Tab 1 `CREATE TABLE t`, tab 2 `SELECT * FROM t` chạy được, không cần reset sandbox.
- AC3: Chạy DDL ở tab A khi đang đứng tab B thì hiện "Schema đã cập nhật từ Tab A", tự ẩn sau 5 giây, có nút xem tab A.
- AC4: Undo `Ctrl+Z` ở mỗi tab chỉ tác động nội dung tab đó.
- AC5: Nội dung tab không active vẫn được autosave đúng (kiểm sau F5).
- AC6: E2E `workspace-tabs.spec.ts` chạy thật: tạo 2 tab, DDL chéo, reload.

Ca biên: chuyển tab khi query đang chạy; đóng tab A khi đang xem thông báo của A; DDL lỗi thì không được phát thông báo schema đổi.
Giao diện: thông báo vi/en, không che editor, đọc được ở 390px.
Kiểm tra: `npm run check` và `npx playwright test web/e2e/workspace-tabs.spec.ts`.
Góc review thêm: đúng logic (không dựng lại sandbox), nhãn kết luận (thông báo schema là Thật, không phải suy đoán).
Đọc thêm: `_bmad-output/SP019/STR090/Task125/task125.md`.
