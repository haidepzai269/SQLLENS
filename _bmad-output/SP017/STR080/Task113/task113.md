# Task113: Sửa lỗi 1-Click Fix tại Terminal - Thay thế câu lệnh theo offset và bảo toàn script

Thuộc: SP017 / STR080
Mục tiêu: Khắc phục triệt để lỗi nút 1-Click Fix (BUG-SP016-01) xóa sạch toàn bộ nội dung Editor; xây dựng cơ chế xác định ranh giới statement để thay thế cục bộ chính xác câu lệnh bị lỗi, bảo toàn 100% các câu lệnh trước và sau, hỗ trợ hoàn tác Undo.

Phạm vi:
- `web/src/modules/lab/lab-workspace.tsx`
- `web/src/components/result-grid/sql-error-view.tsx`
- `web/src/components/result-grid/sql-error-view.test.tsx`
- `web/src/components/sql-editor/statement-at-cursor.ts` (hoặc module liên quan)

Không làm:
- Không thay đổi cấu trúc giao diện AI Doctor Card đã có ở Task103.
- Không sửa logic backend Gin `POST /ai/diagnose`.
- Không làm gián đoạn các Quick-Fix action có sẵn (`replace_stmt`, `prepend_stmt`, `rebuild_sandbox`).

Hợp đồng:
- `applyStatementFix(fullDoc: string, targetSql: string, replacementSql: string, errorPosition?: number): string`: Hàm tính toán chuỗi tài liệu mới, định vị chính xác vị trí câu lệnh `targetSql` trong `fullDoc` (kết hợp `errorPosition` nếu có nhiều câu lệnh giống nhau) và thay thế bằng `replacementSql`.
- Trong `lab-workspace.tsx`: Khi `SqlErrorView` kích hoạt `onApplyFix(suggestedSql)`, `lab-workspace.tsx` tính toán cập nhật cục bộ vào `sql` hiện tại thay vì ghi đè mù quáng `setSql(suggestedSql)`.

Tiêu chí xong:
- AC1: Đơn câu lệnh: Khi Editor chỉ có 1 câu lệnh trùng với câu lệnh bị lỗi, nhấn 1-Click Fix cập nhật câu lệnh đó thành `suggestedSql`.
- AC2: Đa câu lệnh (Multi-statement script): Khi Editor có nhiều câu lệnh (ví dụ: `CREATE TABLE ...; SELECT * FORM users; SELECT * FROM orders;`), chỉ câu lệnh lỗi (`SELECT * FORM users;`) được thay thế thành `SELECT * FROM users;`. Các câu lệnh trước và sau được giữ nguyên 100% không mất một ký tự.
- AC3: Nhiều câu lệnh giống nhau: Nếu tài liệu có nhiều câu lệnh giống hệt nhau, sử dụng `errorPosition` để xác định đúng câu lệnh bị lỗi đang chạy và thay thế đúng vị trí đó.
- AC4: Hỗ trợ hoàn tác (Undo): Người dùng có thể nhấn `Ctrl+Z` trong SQL Editor để hoàn tác câu lệnh vừa được 1-Click Fix sửa về lại trạng thái ban đầu.
- AC5: Đóng / Cập nhật thẻ: Nút 1-Click Fix hiển thị trạng thái "Đã áp dụng" và vô hiệu hóa để chặn click lặp lại.
- AC6: Unit test và Integration test đạt 100%, kiểm thử đầy đủ ca đơn câu lệnh, đa câu lệnh, câu lệnh có comment và nhiều câu trùng lặp.

Ca biên: `sql` rỗng; `targetSql` không khớp chính xác khoảng trắng trong `fullDoc` (cần chuẩn hóa đối soát an toàn); câu lệnh lỗi nằm ở đầu hoặc cuối file không có dấu chấm phẩy `;`.
Giao diện: Nút 1-Click Fix giữ nguyên phong cách visual của Task103, phản hồi tức thì.
Kiểm tra: `cd web; npm run check; npx vitest run web/src/components/result-grid/sql-error-view.test.tsx`.
Góc review thêm: Tính an toàn khi thay thế mã SQL / Bảo toàn dữ liệu người dùng / Không gây vỡ cú pháp các câu lệnh xung quanh.
Đọc thêm: `_bmad-output/SPEC_VA_LOI_SP016.md` mục 2 (BUG-SP016-01) và mục 3 (STR080).
