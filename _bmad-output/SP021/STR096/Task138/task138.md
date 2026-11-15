# Task138: Menu Export & tải file `.sql`

Thuộc: SP021 / STR096
Mục tiêu: Người dùng tìm thấy nút xuất file ở một chỗ duy nhất và tải được `.sql` bằng một cú bấm.

Phạm vi:
- `web/src/modules/export/components/export-menu.tsx`
- `web/src/modules/export/components/export-menu.test.tsx`
- `web/messages/vi/export.json`, `web/messages/en/export.json`
- `web/src/modules/lab/stage/stage.tsx`

Không làm:
- Không làm ảnh và PDF (Task139–142).
- Không đổi serializer (Task137).
- Không thêm menu vào trang landing.

Hợp đồng:
- `<ExportMenu engine={...} schema={...} />` là chỗ duy nhất chứa các mục xuất; các task sau thêm mục vào đây, không tạo nút rải rác.
- Tên file: `<tên dự án>-schema-<YYYYMMDD-HHmm>.sql`, làm sạch ký tự không hợp lệ.
- Key i18n: `export.title`, `export.sql`, `export.disabledEmpty`, `export.done`, `export.failed`.

Tiêu chí xong:
- AC1: Bấm Export → Tải `.sql` thì file tải về đúng tên, nội dung khớp `serializeSchema`.
- AC2: Schema rỗng thì mục `.sql` bị disable kèm tooltip `export.disabledEmpty`.
- AC3: Có trạng thái đang xuất và thông báo xong/lỗi (vi/en).
- AC4: Menu dùng được bằng bàn phím (mở, điều hướng, Esc đóng), có aria-label.
- AC5: 390px menu mở dạng sheet, không tràn, không che nút Run.
- AC6: Không có request mạng nào khi xuất.

Ca biên: tên dự án 100 ký tự; tên có `/` và dấu tiếng Việt; bấm xuất 2 lần liên tiếp; xuất khi đang chạy query.
Giao diện: chạy thật cả vi và en, kiểm ở 390px và 1440px.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/export/components/export-menu.test.tsx`.
Góc review thêm: giao diện (chạy thật, vi/en, 390px).
Đọc thêm: `_bmad-output/SP021/STR096/Task137/task137.md`.
