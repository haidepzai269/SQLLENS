# Task144: Share dialog: sao chép link, cảnh báo, đường lui khi link quá dài

Thuộc: SP022 / STR099
Mục tiêu: Người dùng lấy được link chia sẻ trong một cú bấm, và hiểu rõ link đó chứa gì trước khi gửi đi.

Phạm vi:
- `web/src/modules/share/components/share-dialog.tsx`
- `web/src/modules/share/components/share-dialog.test.tsx`
- `web/messages/vi/share.json`, `web/messages/en/share.json`
- `web/src/modules/lab/stage/stage.tsx` (chỉ thêm nút Share)

Không làm:
- Không làm trang `/share` (Task145).
- Không upload, không rút gọn link qua dịch vụ ngoài.
- Không đổi codec (Task143).

Hợp đồng:
- Nút Share dựng `SnapshotV1` từ store workspace, gọi `encodeSnapshot`, tạo URL `${origin}/${locale}/share#d=<payload>`.
- Trạng thái hiển thị theo kích thước: `ok` (< 8KB), `warn` (8–32KB), `blocked` (> 32KB).
- Khi `blocked`: chỉ cho tải file `.sqllens` (JSON snapshot) thay vì link.
- Key i18n: `share.title`, `share.copy`, `share.copied`, `share.warningPrivacy`, `share.warningLength`, `share.blocked`, `share.download`, `share.close`.

Tiêu chí xong:
- AC1: Bấm Share thì tạo URL, sao chép được, hiện "Đã sao chép".
- AC2: Luôn hiện cảnh báo "ai có link đều đọc được toàn bộ SQL trong đó" ở mọi trạng thái.
- AC3: 8–32KB hiện cảnh báo dán vào ứng dụng chat có thể bị cắt; > 32KB chặn link, chỉ cho tải file.
- AC4: 0 request mạng khi tạo link và khi sao chép (kiểm network log).
- AC5: Tải file `.sqllens` ra JSON đúng `SnapshotV1`, mở lại được bằng codec.
- AC6: Đủ vi/en, dùng được bằng bàn phím, 390px không tràn.

Ca biên: workspace 100 tab; trình duyệt chặn clipboard (phải có cách chọn link thủ công); URL dài 30KB; mở dialog khi đang chạy query.
Giao diện: 3 trạng thái ok/warn/blocked rõ ràng; cảnh báo không bị ẩn sau tooltip.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/share/components/share-dialog.test.tsx`.
Góc review thêm: bảo mật (nội dung nhạy cảm trong URL), giao diện vi/en.
Đọc thêm: `_bmad-output/SP022/STR099/Task143/task143.md`.
