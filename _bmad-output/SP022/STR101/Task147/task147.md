# Task147: Fork snapshot vào workspace

Thuộc: SP022 / STR101
Mục tiêu: Người nhận link biến bài của người khác thành dự án của mình trong một cú bấm, và biết là đã xong.

Phạm vi:
- `web/src/modules/share/fork.ts`
- `web/src/modules/share/fork.test.ts`
- `web/src/modules/share/components/readonly-workspace.tsx` (thêm nút Fork)
- `web/messages/vi/share.json`, `web/messages/en/share.json`

Không làm:
- Không sửa snapshot trong URL.
- Không gọi API cloud.
- Không chạy SQL (Task148).

Hợp đồng:
- `forkSnapshot(snapshot: SnapshotV1, scope: WorkspaceScope): Promise<{ projectId: string; tabs: number }>`
- Tạo project mới tên `<tên gốc> (fork)` / `(fork)` theo ngôn ngữ, engine giữ nguyên, tabs mới id.
- Sau khi fork: điều hướng về editor của project mới, hiện toast xác nhận.

Tiêu chí xong:
- AC1: Fork tạo đúng project + đúng số tab với nội dung y hệt snapshot.
- AC2: Có toast "Đã thêm vào workspace" kèm số tab; điều hướng tới project mới.
- AC3: Fork hai lần tạo hai project khác nhau nhưng có cảnh báo "bạn đã fork link này" (không im lặng nhân bản).
- AC4: URL snapshot không đổi sau khi fork; tải lại trang share vẫn xem được.
- AC5: Không đụng dữ liệu của project khác trong scope.
- AC6: Đủ vi/en; nút Fork hiện rõ, dùng được ở 390px.

Ca biên: snapshot 100 tab; IndexedDB đầy giữa lúc fork (báo lỗi, không tạo nửa vời); fork khi chưa có project nào; fork khi đã đăng nhập.
Giao diện: nút Fork là hành động chính trên trang share, có trạng thái đang xử lý.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/share/fork.test.ts`.
Góc review thêm: giao diện vi/en, đúng yêu cầu.
Đọc thêm: `_bmad-output/SP022/STR100/Task146/task146.md`.
