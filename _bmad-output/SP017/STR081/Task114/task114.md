# Task114: Hiện thực hóa toàn diện 6 tùy chọn trong /settings vào CodeMirror & DOM Root

Thuộc: SP017 / STR081
Mục tiêu: Kết nối toàn bộ 6 tùy chọn trong `/settings` (Cỡ chữ, ngắt dòng, số dòng, highlight dòng vào CodeMirror; đồng bộ Theme và Contrast Boost vào DOM `<html>` và CSS tokens), loại bỏ triệt để hiện tượng cài đặt "hàng mã" (BUG-SP016-02).

Phạm vi:
- `web/src/components/sql-editor/sql-editor-impl.tsx`
- `web/src/contexts/settings-context.tsx`
- `web/src/app/globals.css`
- `web/src/components/sql-editor/sql-editor-impl.test.tsx`
- `web/src/modules/settings/settings-view.test.tsx`

Không làm:
- Không thay đổi thiết kế layout trang `/settings` (Task105 đã chốt).
- Không sửa các extension Autocomplete / Heuristics / Copilot (thuộc Task116, Task117).

Hợp đồng:
- `useSafeSettings()` trong `sql-editor-impl.tsx` đọc đầy đủ: `lineNumbers`, `lineWrapping`, `highlightActiveLine`, `fontSize`.
- CodeMirror `basicSetup` nhận động `{ lineNumbers: settings.lineNumbers, highlightActiveLine: settings.highlightActiveLine, autocompletion: false, foldGutter: false }`.
- Mảng `extensions` của CodeMirror nạp động `EditorView.lineWrapping` khi `settings.lineWrapping === true`.
- Theme CodeMirror áp dụng cỡ chữ động theo `settings.fontSize` (13px, 14px, 16px) thay vì class Tailwind ghim cứng.
- `SettingsProvider` (hoặc effect DOM tương ứng) đồng bộ lên thẻ `<html>`:
  - Class `dark` / `light` theo `settings.theme` (xử lý "auto" theo prefers-color-scheme).
  - Class `contrast-high` và attribute `data-contrast="boost"` khi `settings.contrastBoost === true`.
- `globals.css` bổ sung styles cho `.light` và `.contrast-high` để giao diện đổi màu thực tế.

Tiêu chí xong:
- AC1: Kích thước phông chữ: Đổi cỡ chữ trong Settings (13px, 14px, 16px) áp dụng trực tiếp lên `.cm-content` và `.cm-gutters` của SQL Editor.
- AC2: Tự động ngắt dòng: Khi bật toggle, nạp `EditorView.lineWrapping`; khi tắt toggle, gỡ bỏ để dòng dài cuộn ngang.
- AC3: Hiển thị số dòng: Khi bật toggle, hiển thị gutter số dòng; khi tắt toggle, ẩn gutter số dòng nhưng vẫn giữ nguyên `errorGutter`.
- AC4: Tô sáng dòng hiện tại: Toggle bật/tắt phản ánh chính xác vào `basicSetup.highlightActiveLine`.
- AC5: Theme & Tương phản: Chọn Tối / Sáng / Auto và bật Tăng độ tương phản đồng bộ chính xác lên thẻ `<html>` và cập nhật CSS tokens hiển thị.
- AC6: Unit & Integration tests đạt 100%, kiểm thử các thay đổi cài đặt tác động đúng vào CodeMirror editor và DOM root.

Ca biên: `SettingsContext` chưa sẵn sàng fallback về `DEFAULT_SETTINGS`; đổi theme "auto" khi OS đổi chế độ sáng/tối; chuyển đổi font size không làm lệch vị trí highlight lỗi `errorField`.
Giao diện: Thay đổi cài đặt có tác dụng tức thì, không cần tải lại trang.
Kiểm tra: `cd web; npm run check; npx vitest run src/components/sql-editor/sql-editor-impl.test.tsx src/modules/settings/settings-view.test.tsx`.
Góc review thêm: Độ mượt mà khi đổi theme / Khả năng tiếp cận A11y / Không vỡ layout Lab workspace.
Đọc thêm: `_bmad-output/SPEC_VA_LOI_SP016.md` mục 2 (BUG-SP016-02) và mục 3 (STR081).
