# Task044: Giao diện đăng nhập và cổng MySQL, AI

Thuộc: SP005 / STR022, STR024
Điều kiện bắt đầu: Task042, Task043, Task027 đã merge.
Mục tiêu: Người dùng thấy mình đã đăng nhập hay chưa, đăng nhập được từ thanh trên. Chọn MySQL hoặc AI khi chưa đăng nhập thì được mời đăng nhập, xong quay về đúng chỗ, không mất SQL đã dán. Hết quota thì biết rõ khi nào có lại.
Phạm vi: `web/src/modules/auth/**`, `web/messages/*/error.json` (thêm `authRequired`, `quotaExceeded`, `quotaUnavailable` của Task043 và `notConfigured`, `originMismatch`, `invalidState`, `authUnavailable`, `rateLimited` của Task042), `web/src/components/shell/**`, `web/src/modules/lab/**` (chỉ chỗ gắn cổng), `web/messages/*/auth.json`, `web/e2e/auth.spec.ts`.
Không làm: sửa Gin, MySQL thật (SP004 STR019), AI (SP012).

Hợp đồng: dùng API của Task042 qua tiền tố `/api` (`/api/me`, `/api/auth/{provider}/start?next=`, `/api/auth/logout`) và lỗi `auth_required`, `quota_exceeded`, `quota_unavailable` của Task043.

Tiêu chí xong:
- AC1: Thanh trên: chưa đăng nhập hiện nút Đăng nhập mở `Dialog` của shadcn/ui có hai lựa chọn Google, GitHub. Đã đăng nhập hiện ảnh và tên trong `DropdownMenu` có Đăng xuất. Đang tải `/me` hiện skeleton, không nháy sai trạng thái.
- AC2: Chọn tab MySQL khi chưa đăng nhập: mở hộp thoại đăng nhập kèm câu giải thích vì sao MySQL cần đăng nhập, PostgreSQL vẫn dùng tự do. Hủy thì quay về PostgreSQL.
- AC3: SQL đang soạn được giữ qua vòng đăng nhập (lưu tạm trong `sessionStorage`, có `try/catch`) và trả lại đúng ô soạn. Sau khi khôi phục thì xóa bản lưu tạm. Không lưu SQL vào `localStorage` hay gửi lên server.
- AC4: Sau đăng nhập quay về đúng locale, đúng engine đã chọn.
- AC5: Lỗi `quota_exceeded`: hiện hạn mức, thời điểm có lại, và nói rõ PostgreSQL vẫn dùng được. Lỗi `quota_unavailable`: báo tạm thời không dùng được, không nói là hết quota.
- AC6: Đăng xuất gửi `POST` có `Origin` đúng, xong thì về PostgreSQL nếu đang ở MySQL.
- AC7: Playwright giả lập API bằng `page.route` cho mọi trạng thái AC1 đến AC6 ở `vi` và `en`, chụp ảnh 390 px và 1440 px. `npm run check`, `npm run build`, `npx playwright test` đều đạt.

- AC8: Trang đích đọc `?auth_error=cancelled|failed` của Task042, hiện câu rõ ràng rồi bỏ tham số khỏi URL.

Ca biên: cookie hết hạn giữa phiên thì `/me` trả 401 và giao diện về trạng thái chưa đăng nhập, không vòng lặp chuyển hướng; `sessionStorage` bị chặn thì vẫn đăng nhập được, báo SQL có thể mất trước khi chuyển trang.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: giao diện, chạy thử thật, bảo mật (không lộ SQL, open redirect phía client).
Đọc thêm: `EXPERIENCE.md` mục 2 và trạng thái lỗi; bàn giao Task020, Task032, Task042, Task043.
