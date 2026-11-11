# Bàn giao Task101

Đã làm:
- Thêm phương thức `fresh(): Promise<void>` vào `EngineAdapter` và triển khai trong `createPostgresAdapter`: terminate worker cũ, xóa sạch history `ran = []`, khởi tạo worker mới sạch sẽ 100%.
- Nối nút "Khởi động lại Sandbox sạch" trong `SqlErrorView` với `resetClean()` (gọi `fresh()`), xóa sạch trạng thái bảng, giải quyết dứt điểm lỗi lặp lại `42P07 duplicate_table`.
- Bổ sung module `statement-at-cursor.ts` bóc tách câu lệnh SQL tại vị trí con trỏ thông minh (bỏ qua `;` trong strings, comments, dollar-quoting).
- Hỗ trợ `Run Selection` (bôi đen đoạn text -> nút Play và Ctrl+Enter chỉ chạy đoạn đó) và `Run Statement at Cursor` (nhấn Ctrl+Enter tại 1 dòng -> chỉ chạy câu lệnh đó).
- Cập nhật tooltip nút Play động và bổ sung đầy đủ nhãn i18n song ngữ Việt - Anh.

File chính:
- `web/src/contracts/engine.ts`
- `web/src/engines/postgres/adapter.ts`
- `web/src/engines/postgres/adapter.test.ts`
- `web/src/components/sql-editor/statement-at-cursor.ts`
- `web/src/components/sql-editor/statement-at-cursor.test.ts`
- `web/src/components/sql-editor/sql-editor.tsx`
- `web/src/components/sql-editor/sql-editor-impl.tsx`
- `web/src/components/sql-editor/sql-editor-impl.test.tsx`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/messages/vi/shell.json`, `web/messages/en/shell.json`
- `web/messages/vi/lab.json`, `web/messages/en/lab.json`

Kết quả kiểm tra:
- `npm run check:i18n`: Đạt 100% (không thiếu key nào)
- `npm run lint`: Đạt 100% (0 errors)
- `npm run typecheck`: Đạt 100% (0 errors)
- `npm test`: 58/58 test files passed (626 tests passed)

Kết quả review:
- Review độc lập bởi Task Reviewer: ĐẠT (PASS) cả 5 tiêu chí nghiệm thu (AC1 - AC5). 0 lỗi cần sửa.

Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết:
- Khi người dùng bôi đen text, tooltip nút Play chuyển sang "Chạy đoạn đã chọn (Ctrl + Enter)" và chỉ thực thi đoạn được chọn.
- Khi không bôi đen text, phím tắt Ctrl+Enter thực thi câu lệnh tại con trỏ mà không chạy lại toàn bộ file SQL. Bấm nút Play trên thanh công cụ vẫn giữ nguyên hành vi chạy toàn bộ script.
- Nút "Khởi động lại Sandbox sạch" đã xóa sạch hoàn toàn database sandbox, người dùng có thể chạy lại script DDL từ đầu mà không gặp lỗi bảng đã tồn tại.
