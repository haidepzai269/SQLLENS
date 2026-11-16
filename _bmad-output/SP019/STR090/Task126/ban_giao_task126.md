# Bàn giao Task126

Đã làm: Dựng `TabRuntime` giữ đúng một CodeMirror view cho cả workspace, mỗi tab một `EditorState` riêng nên chuyển tab chỉ đổi tài liệu + lịch sử undo mà không dựng lại view hay worker PGlite/MySQL. Thêm `notifySchemaChanged` / `useSchemaChangedNotice` (tự ẩn sau 5 giây, nút "Xem tab" đưa về tab nguồn, ẩn khi tab nguồn bị đóng) và gắn `<TabBar />` của Task125 vào cột SQL. Trong lượt này cũng review Task123–125 và sửa 4 lỗi bên dưới.

File chính:
- `web/src/modules/workspace/tab-runtime.ts`, `web/src/modules/workspace/tab-runtime.test.ts`
- `web/src/modules/lab/lab-workspace.tsx`, `web/e2e/workspace-tabs.spec.ts`
- `web/src/components/sql-editor/sql-editor.tsx`, `web/src/components/sql-editor/sql-editor-impl.tsx`
- `web/src/modules/workspace/{autosave.ts,autosave.test.ts,hydrate.ts,hydrate.test.ts,store.ts}`, `web/src/modules/workspace/components/tab-bar.tsx`, `web/messages/{vi,en}/workspace.json`

Kết quả kiểm tra:
- `npm run check`: PASS 100% (i18n, eslint 0 error, tsc, 89 test files / 1002 tests PASS).
- `npx playwright test e2e/workspace-tabs.spec.ts`: 5/5 PASS (5 tab một editor + không nạp lại `pglite.wasm`, DDL chéo `CREATE TABLE` → `SELECT`, thông báo từ tab khác + nút Xem tab, thông báo ở 390px không tràn ngang, DDL lỗi không phát thông báo, undo riêng từng tab + reload).
- `npx playwright test e2e/workspace-persist.spec.ts`: 3/3 PASS. `e2e/sql-editor.spec.ts`: 11/12 PASS (lỗi còn lại là AC5 chữ 16px trên điện thoại, đã có từ trước — xem Phát sinh). `e2e/sql-intake.spec.ts`, `e2e/shell.spec.ts`: PASS.

Lỗi tìm thấy khi review Task123–125 và đã sửa ngay:
1. (Task123/124) Đóng tab ngay sau khi gõ làm tab sống lại sau F5: phần ghi debounce chạy sau lệnh xóa nên ghi lại tab vừa đóng vào IndexedDB. Tái hiện bằng test trong `hydrate.test.ts` (đỏ trước khi sửa: `['Query 1','Query 2']`), sửa bằng `Autosave.cancel(key)` gọi trước `deleteTab` / `deleteProjectCascade`.
2. (Task124) `bootWorkspace` không có cleanup: rời Lab vẫn còn subscription + kết nối IndexedDB. Thêm `disposeWorkspace()` trong cleanup của effect.
3. (Task125) Tab list đọc `aria-label` sai (`tab.untitled`) → thêm khóa `tab.list`.
4. (Task125) Space/Enter trên nút đóng bị tab cha nuốt (nút nằm trong `role="tab"`) → bỏ qua phím phát từ phần tử con.
Ngoài ra `updateTabSql` không còn tạo bản ghi mới khi nội dung y hệt (tránh autosave/rerender thừa khi chuyển tab).

Ghi chú kiến trúc: `basicSetup` được đưa vào danh sách `extensions` (không truyền prop riêng) và `SqlEditor` nhận thêm prop `onEditorReady(view, getExtensions)` — cần thiết để tạo state cho tab mới giống hệt state đầu tiên (history, keymap, số dòng). Nội dung ra ngoài vẫn đi qua một listener duy nhất, có bỏ qua giao dịch mang nhãn `ExternalChange`.

Kết quả review: Subagent task-reviewer độc lập thẩm định đạt chuẩn PASS 100% (AC1-AC6, 4 bug fix Task123-125, Core Rule 7 và nhãn kết luận Thật). Đủ điều kiện merge vào main. 0 mục `needs_validation` bắt buộc.

Chưa làm được: ca "chuyển tab khi query đang chạy" mới kiểm bằng đọc mã (switchTab không chạm adapter/sandbox), chưa có test tự động vì PGlite trả kết quả quá nhanh để giữ trạng thái đang chạy ổn định.

Phát sinh (đưa vào SP999):
- Task114 làm mất quy tắc 16px trên điện thoại: commit `21b1894` xóa `[&_.cm-content]:!text-[16px]`, thay bằng theme `font-size … !important` nên 390px còn 14px → `e2e/sql-editor.spec.ts:161` FAIL. Đã xác nhận lỗi có sẵn trên `main` (build sạch, không có thay đổi của lượt này).
- `e2e/golden-path.spec.ts` FAIL cả 4 kịch bản trên `main` sạch (`tbody:visible tr` = 0, wasm báo lỗi compile): Ctrl+Enter nay chỉ chạy câu tại con trỏ nên bước 3 của luồng vàng không còn ra 3 dòng. Cần cập nhật spec.
- Gõ phím trong khoảng ~50ms trước khi `bootWorkspace` xong thì store chưa có tab để nhận (chữ vẫn nằm trong CodeMirror, chỉ mất nếu F5 ngay). Chưa sửa.

Việc tiếp theo cần biết: STR090 xong 100%; Task127 (STR091) nối switcher dự án vào `<TabBar />` — `TabBar` đọc `activeProjectId` từ store nên chỉ cần đổi project là danh sách tab tự đổi; mỗi tab vẫn một `EditorState` trong cùng view nhờ `TabRuntime`.
