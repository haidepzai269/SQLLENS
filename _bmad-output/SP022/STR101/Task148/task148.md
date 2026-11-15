# Task148: Chạy thử snapshot ngay trên trang share

Thuộc: SP022 / STR101
Mục tiêu: Người nhận link bấm Chạy là thấy kết quả thật, chạy trong máy mình, không cần tài khoản và không cần server.

Phạm vi:
- `web/src/modules/share/try-run.ts`
- `web/src/modules/share/try-run.test.ts`
- `web/src/modules/share/components/readonly-workspace.tsx` (thêm vùng kết quả)
- `web/messages/vi/share.json`, `web/messages/en/share.json`

Không làm:
- Không tự tạo container MySQL.
- Không gửi SQL lên server.
- Không đổi engine của snapshot.

Hợp đồng:
- `runSnapshotTab(tab, engine): Promise<{ fields: string[]; rows: unknown[][]; label: "that" }>` dùng PGlite/SQLite trong worker của người xem.
- Engine `mysql` trả `{ kind: "needs_sandbox" }` kèm thông điệp, không gọi mạng.
- Có `cancel()` và timeout 1.500ms như các engine khác.

Tiêu chí xong:
- AC1: Snapshot Postgres chạy được ngay trên trang share, kết quả có nhãn Thật.
- AC2: Snapshot SQLite chạy được nếu STR094 đã xong; nếu chưa thì nút Chạy bị disable kèm lý do.
- AC3: Snapshot MySQL hiện thông điệp cần sandbox, không tự mở container, không gọi mạng.
- AC4: 0 request mạng khi chạy (kiểm network log).
- AC5: Query treo bị ngắt sau 1.500ms, có nút hủy, UI không đóng băng.
- AC6: Kết quả không ghi vào snapshot trong URL; tải lại trang là mất kết quả.
- AC7: Đủ vi/en, dùng được ở 390px, có trạng thái đang chạy/lỗi/rỗng.

Ca biên: SQL có DDL; SQL lỗi cú pháp; bảng chưa tồn tại; kết quả 100k dòng (phân trang); bấm Chạy 5 lần liên tiếp.
Giao diện: vùng kết quả không đẩy layout nhảy; nhãn Thật hiển thị rõ, không dùng nhãn Mô phỏng/Ước lượng cho kết quả này.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/share/try-run.test.ts`.
Góc review thêm: nhãn kết luận (Core Rule 1), bảo mật (không gọi mạng), giao diện vi/en.
Đọc thêm: `_bmad-output/SP018/STR088/` (rào chắn MySQL), `_bmad-output/SP022/STR101/Task147/task147.md`.
