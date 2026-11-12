# Task108: Tích hợp CodeMirror 6 Dropdown Autocomplete theo Schema Sandbox CSDL động (Mặc định TẮT)

Thuộc: SP016 / STR077
Mục tiêu: Xây dựng extension gợi ý mã dạng dropdown popup truyền thống cho CodeMirror 6 sử dụng `@codemirror/lang-sql` kết hợp từ điển schema động (bảng, cột) từ Sandbox CSDL (PGlite / MySQL); đảm bảo tính năng ở trạng thái **Mặc định TẮT (OFF)** và chỉ kích hoạt khi người dùng bật trong Cài đặt.

Phạm vi:
- `web/src/components/sql-editor/extensions/dropdown-autocomplete.ts`
- `web/src/components/sql-editor/extensions/dropdown-autocomplete.test.ts`
- `web/src/components/sql-editor/sql-editor-impl.tsx`
- `web/src/modules/lab/lab-workspace.tsx`

Không làm: Không gọi mạng ngoài; không làm gián đoạn con trỏ gõ khi tính năng đang tắt; không gửi dữ liệu schema lên server.

Hợp đồng:
- `createSqlAutocompleteExtension({ schema, dialect, enabled }: { schema: Record<string, string[]>; dialect: SQLDialect; enabled: boolean }): Extension`: Tạo extension CodeMirror nạp danh sách bảng và cột.
- Khi `enabled === false`: Trả về extension rỗng (hoặc `autocompletion: false`), không tiêu tốn tài nguyên CPU.

Tiêu chí xong:
- AC1: Mặc định trong `SettingsContext`, `dropdownAutocomplete === false` (TẮT). Khi tắt, không có menu popup nào xổ xuống khi gõ phím.
- AC2: Khi người dùng bật tính năng trong `/settings` (`dropdownAutocomplete === true`):
  - Extension tự động ánh xạ danh sách bảng `tables` từ `lab-workspace.tsx` thành cấu trúc schema: `{ [tableName]: string[] }`.
  - Nạp schema vào `sql({ dialect, schema })` của `@codemirror/lang-sql`.
- AC3: Khi người dùng gõ từ khóa hoặc tên bảng, menu dropdown popup xổ xuống tức thì (< 1ms).
- AC4: Menu phân loại rõ ràng:
  - Icon bảng cho tên bảng trong sandbox.
  - Icon cột cho danh sách cột của bảng tương ứng.
  - Icon từ khóa cho các cú pháp SQL chuẩn (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `JOIN`, `WHERE`...).
- AC5: Hỗ trợ tìm kiếm mờ (Fuzzy matching), phím mũi tên `Up`/`Down` di chuyển, phím `Tab` hoặc `Enter` để chọn, phím `Esc` để đóng menu.
- AC6: Unit test kiểm thử việc kích hoạt/hủy kích hoạt và lọc gợi ý schema đạt 100%.

Ca biên: Database chưa có bảng nào (schema rỗng); bảng có tên chứa ký tự đặc biệt hoặc chữ in hoa; thay đổi engine từ PostgreSQL sang MySQL.
Kiểm tra: `npm run check` và `npx vitest run web/src/components/sql-editor/extensions/dropdown-autocomplete.test.ts`.
Góc review thêm: Độ trễ phản hồi khi gõ nhanh (< 1ms) / Không xung đột với phím tắt khác.
Đọc thêm: `_bmad-output/SPEC_SMART_EDITOR.md` mục 3 (STR077) & `MUC_TIEU_TRUOC_MAT.md` mục 5.

