# Task127: Project switcher: tạo, đổi tên, nhân bản, xóa

Thuộc: SP019 / STR091
Mục tiêu: Có danh sách dự án để người dùng giữ nhiều bài thử khác nhau thay vì xóa bài cũ.

Phạm vi:
- `web/src/modules/workspace/components/project-switcher.tsx`
- `web/src/modules/workspace/components/project-switcher.test.tsx`
- `web/messages/vi/workspace.json`
- `web/messages/en/workspace.json`

Không làm:
- Không làm engine theo dự án (Task128).
- Không làm cloud.
- Không đổi Tab Bar.

Hợp đồng:
- `<ProjectSwitcher />` đọc `useWorkspaceStore`, mở danh sách bằng phím và chuột.
- `duplicateProject(id)` tạo bản sao kèm hậu tố ` (bản sao)` / ` (copy)` theo ngôn ngữ, chép tabs với id mới.
- Key i18n: `project.new`, `project.rename`, `project.duplicate`, `project.delete`, `project.deleteConfirm`, `project.empty`, `project.updatedAt`.

Tiêu chí xong:
- AC1: Tạo dự án mới (đặt tên) thì tự chuyển sang dự án đó, danh sách cập nhật ngay.
- AC2: Đổi tên tại chỗ, Enter lưu, Esc hủy, rỗng thì giữ tên cũ.
- AC3: Nhân bản chép đủ tabs và nội dung, id mới toàn bộ, không chia sẻ bản ghi.
- AC4: Xóa cần xác nhận 2 bước, xóa luôn tabs trong IndexedDB, không để bản ghi mồ côi.
- AC5: Hiện engine và thời gian sửa cuối, định dạng theo ngôn ngữ.
- AC6: Đủ vi/en; 390px danh sách mở dạng sheet, không tràn.

Ca biên: 30 dự án, xóa dự án đang mở (phải chuyển sang dự án khác, không trắng màn hình), tên trùng nhau, nhân bản dự án 100 tab.
Giao diện: trạng thái rỗng có CTA; bàn phím dùng được; focus trap khi mở sheet trên mobile.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/workspace/components/project-switcher.test.tsx`.
Góc review thêm: giao diện (chạy thật, vi/en, 390px).
Đọc thêm: `_bmad-output/SP019/STR089/Task123/task123.md`.
