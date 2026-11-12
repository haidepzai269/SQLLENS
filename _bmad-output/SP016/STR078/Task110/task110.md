# Task110: Extension CodeMirror 6 Inline Ghost Text: Render chữ mờ xám sau con trỏ, phím Tab nhận và Esc hủy

Thuộc: SP016 / STR078
Mục tiêu: Xây dựng extension CodeMirror 6 hiển thị gợi ý viết tiếp cục bộ dưới dạng chữ mờ xám (Ghost Text Widget) nối tiếp ngay sau con trỏ soạn thảo; tích hợp động cơ Heuristics từ Task109; xử lý phím tắt `Tab` để chèn trọn vẹn và `Escape` để hủy bỏ; đảm bảo tính năng ở trạng thái **Mặc định BẬT (ON)**.

Phạm vi:
- `web/src/components/sql-editor/extensions/inline-ghost-text.ts`
- `web/src/components/sql-editor/extensions/inline-ghost-text.test.ts`
- `web/src/components/sql-editor/sql-editor-impl.tsx`
- `web/src/modules/lab/lab-workspace.tsx`

Không làm: Không làm xung đột với phím `Tab` thụt lề khi không có ghost text; không làm rung giật con trỏ soạn thảo; không gọi mạng ngoài.

Hợp đồng:
- `createInlineGhostTextExtension({ enabled, getTables, getForeignKeys }): Extension`: Tạo extension CodeMirror quản lý StateField và ViewPlugin cho Ghost Text.
- Keymap:
  - `Tab`: Khi có Ghost Text -> Chèn chuỗi Ghost Text vào vị trí con trỏ, dời con trỏ đến cuối chuỗi vừa chèn, return `true` (chặn phím Tab mặc định). Khi không có Ghost Text -> return `false` (thụt lề 2 spaces bình thường).
  - `Escape`: Khi có Ghost Text -> Xóa trạng thái Ghost Text, return `true`. Khi không có -> return `false`.

Tiêu chí xong:
- AC1: Mặc định trong hệ thống, `ghostTextEnabled === true` (BẬT). Khi tắt trong Cài đặt, extension không can thiệp vào editor.
- AC2: Khi người dùng gõ câu lệnh khớp với Heuristics (Task109), một node DOM ảo (`Decoration.widget({ side: 1 })`) được chèn ngay tại vị trí con trỏ.
- AC3: Node DOM mang class thẩm mỹ: `opacity-40 select-none pointer-events-none text-muted-foreground font-mono inline-block`.
- AC4: Xử lý phím tắt chuẩn xác:
  - Nhấn `Tab`: Điền ngay nội dung ghost text vào tài liệu mà không bị thụt lề thừa, con trỏ đặt ở cuối câu.
  - Nhấn `Escape`: Biến mất ngay lập tức.
- AC5: Xử lý gõ tiếp (Type-ahead handling):
  - Nếu ký tự người dùng vừa gõ khớp với ký tự đầu tiên của ghost text: Cắt ngắn chuỗi ghost text đi 1 ký tự (mượt mà như Copilot).
  - Nếu ký tự gõ không khớp: Hủy bỏ ghost text ngay lập tức.
- AC6: Unit test và Interaction test cho extension đạt 100%.

Ca biên: Con trỏ di chuyển bằng chuột hoặc phím mũi tên (phải hủy ghost text cũ); người dùng paste đoạn văn bản dài; undo/redo lịch sử.
Kiểm tra: `npm run check` và `npx vitest run web/src/components/sql-editor/extensions/inline-ghost-text.test.ts`.
Góc review thêm: Trải nghiệm gõ phím mượt mà không cảm nhận được độ trễ / Không nuốt mất phím Tab của người dùng khi không có gợi ý.
Đọc thêm: `_bmad-output/SPEC_SMART_EDITOR.md` mục 3 (STR078) & `MUC_TIEU_TRUOC_MAT.md` mục 6.

