# Bàn giao Task113: Sửa lỗi 1-Click Fix tại Terminal - Thay thế câu lệnh theo offset và bảo toàn script

Đã làm:
- Khắc phục triệt để lỗi BUG-SP016-01: nút 1-Click Fix không còn xóa trắng SQL Editor khi người dùng chạy script đa câu lệnh.
- Xây dựng hàm `splitSqlStatementsDetailed` và `applyStatementFix` trong `statement-at-cursor.ts`: định vị chính xác vị trí câu lệnh lỗi bằng ranh giới statement kết hợp `errorPosition` (khi có câu trùng lặp hoặc chạy cả script), thay thế cục bộ và bảo toàn 100% các câu lệnh trước và sau, định dạng và comments xung quanh.
- Cập nhật `lab-workspace.tsx` sử dụng `applyStatementFix(sql, state.sql, newSql, state.position)` trong `onApplyFix`.
- Hỗ trợ hoàn tác Undo (`Ctrl+Z`) cho CodeMirror sau khi áp dụng fix.
- Giữ nguyên các thao tác Quick-Fix có sẵn (`replace_stmt`, `prepend_stmt`, `rebuild_sandbox`) và trạng thái giao diện nút 1-Click Fix ("Đã áp dụng", disabled).

File chính:
- `web/src/components/sql-editor/statement-at-cursor.ts`
- `web/src/components/sql-editor/statement-at-cursor.test.ts`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/src/components/result-grid/sql-error-view.test.tsx`

Kết quả kiểm tra:
- `npm run check:i18n`: 0 lỗi.
- `npm run lint`: 0 lỗi.
- `npm run typecheck`: 0 lỗi.
- `npx vitest run src/components/sql-editor/statement-at-cursor.test.ts src/components/result-grid/sql-error-view.test.tsx`: 47/47 tests PASS (100%).
- Toàn bộ test suite web (824 unit & integration tests) PASS 100%.

Kết quả review:
- 0 lỗi cần sửa. Reviewer độc lập nghiệm thu PASS 100%. Không có mục needs_validation nào còn lại.

Chưa làm được:
- Không có.

Phát sinh:
- Không có.

Việc tiếp theo cần biết:
- STR080 đã hoàn thành. Task tiếp theo là Task114 (thuộc STR081): Kết nối 6 cài đặt `/settings` vào CodeMirror và Root DOM (`BUG-SP016-02`).
