# Task154: Cloud panel trong giao diện

Thuộc: SP023 / STR104
Mục tiêu: Người dùng thấy rõ dự án nào đã ở cloud, trạng thái lưu, và xóa được vĩnh viễn nếu muốn.

Phạm vi:
- `web/src/modules/cloud/components/cloud-panel.tsx`
- `web/src/modules/cloud/components/cloud-panel.test.tsx`
- `web/messages/vi/cloud.json`, `web/messages/en/cloud.json`
- `web/src/modules/workspace/components/project-switcher.tsx` (chỉ thêm mục Cloud)

Không làm:
- Không đổi logic sync (Task153).
- Không tự đẩy khi đóng tab.
- Không hiện nút Cloud cho khách chưa đăng nhập (thay bằng lời mời đăng nhập).

Hợp đồng:
- Trạng thái mỗi dự án: `local`, `synced`, `modified`, `conflict`.
- Nút: "Lưu vào Cloud", "Kéo về máy", "Xóa trên Cloud" (xác nhận 2 bước).
- Key i18n: `cloud.save`, `cloud.pull`, `cloud.delete`, `cloud.deleteConfirm`, `cloud.conflict`, `cloud.needLogin`, `cloud.saving`, `cloud.failed`.

Tiêu chí xong:
- AC1: Dự án chưa lưu hiện `local`; sau khi lưu hiện `synced` kèm thời gian.
- AC2: Sửa SQL sau khi lưu thì hiện `modified`, không tự đẩy.
- AC3: Gặp conflict thì hiện hộp thoại 2 lựa chọn (giữ bản máy / lấy bản cloud), không tự chọn.
- AC4: Xóa trên cloud cần xác nhận, xong thì dự án local vẫn còn và chuyển về `local`.
- AC5: Khách chưa đăng nhập thấy lời mời đăng nhập, không thấy nút lưu.
- AC6: Đủ vi/en, dùng được bằng bàn phím, 390px không tràn.

Ca biên: token hết hạn giữa lúc lưu; 50 dự án; lưu khi đang chạy query; đổi ngôn ngữ khi panel đang mở.
Giao diện: 4 trạng thái rõ ràng, có spinner khi đang lưu, thông báo lỗi nêu việc cần làm.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/cloud/components/cloud-panel.test.tsx`.
Góc review thêm: giao diện (chạy thật, vi/en, 390px), bảo mật.
Đọc thêm: `_bmad-output/SP023/STR104/Task153/task153.md`.
