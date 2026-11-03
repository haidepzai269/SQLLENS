# Task042: Đăng nhập bằng Google và GitHub

Thuộc: SP005 / STR022
Điều kiện bắt đầu: Task041 và Task043 đã merge.
Mục tiêu: Người dùng đăng nhập, đăng xuất bằng Google hoặc GitHub. Gin giữ phiên bằng cookie `sid`, chặn CSRF, và gắn quota cho các route MySQL và AI.
Phạm vi: `api/internal/auth/**`, `api/internal/httpapi/router.go`, `api/cmd/**`, `render.yaml`, `api/go.mod`, `api/go.sum`.
Không làm: giao diện (Task044), route MySQL và AI thật (SP004 STR019, SP012).

Hợp đồng (Task044 dựa vào), đường dẫn tính ở Gin, trình duyệt gọi thêm tiền tố `/api`:
- `GET /auth/{google|github}/start?next=/vi/...`: chuyển tới nhà cung cấp, kèm `state` và PKCE. `next` chỉ nhận đường dẫn tương đối trong site, không nhận URL tuyệt đối hay `//`.
- `GET /auth/{google|github}/callback`: kiểm `state`, đổi code lấy hồ sơ, gọi `store.UpsertIdentity`, đặt cookie `sid` rồi chuyển về `next`.
- `POST /auth/logout`: xóa phiên và cookie.
- `GET /me`: trả `{ id, name, avatarUrl, provider }` hoặc 401 `auth_required`.
- Cookie `sid`: `HttpOnly`, `Secure` (trừ khi `PUBLIC_ORIGIN` là `http://localhost`), `SameSite=Lax`, `Path=/`, hạn 30 ngày. Gin chỉ đọc cookie `sid`, bỏ qua mọi cookie khác vì `rewrites` chuyển nguyên header Cookie.
- Mọi yêu cầu đổi trạng thái (`POST`, `PUT`, `PATCH`, `DELETE`) phải có header `Origin` đúng `PUBLIC_ORIGIN`, sai hoặc thiếu trả 403 `origin_mismatch`.
- `redirect_uri` tính từ `PUBLIC_ORIGIN`, không từ header `Host`.
- Nhóm route `/mysql/*` và `/ai/*` gắn middleware đăng nhập và quota của Task043. Thêm một route `POST /mysql/ping` tạm, trả 204, để kiểm cổng chạy đúng; SP004 STR019 thay bằng route thật.
- Thiếu biến môi trường thì Gin vẫn khởi động, `/healthz` vẫn chạy, các route cần biến đó trả 503 rõ ràng. `render.yaml` khai báo các biến với `sync: false`, không chứa giá trị.

Tiêu chí xong:
- AC1: Test với nhà cung cấp giả bằng `httptest` cho cả Google và GitHub: đăng nhập trọn vòng, cookie `sid` có đủ thuộc tính, `/me` trả đúng user.
- AC2: `state` sai, thiếu, dùng lại lần hai, hoặc code verifier sai: không đăng nhập, không đặt cookie.
- AC3: `next=https://evil.com`, `next=//evil.com`, `next=/\evil.com`: chuyển về trang chủ, không chuyển ra ngoài.
- AC4: `POST /auth/logout` từ Origin khác bị 403. Đăng xuất xong thì `sid` cũ dùng lại bị 401.
- AC5: `POST /mysql/ping` chưa đăng nhập trả 401 `auth_required`, đã đăng nhập trả 204, vượt quota trả 429.
- AC6: Log không chứa token, code, cookie hay email.
- AC7: Chạy thật ở máy: `next dev` cộng Gin với key thật do chủ dự án đặt trong `api/.env`, đăng nhập được bằng cả Google và GitHub. Bước này cần người thật bấm đăng nhập: agent chuẩn bị lệnh chạy và ghi hướng dẫn trong bàn giao, phiên chính nhờ chủ dự án thử. Agent không đọc `api/.env`.
- AC8: `cd api && go vet ./... && go test ./...` thoát với mã 0.

Ca biên: GitHub không trả email; người dùng hủy ở trang đồng ý của nhà cung cấp; hai tab cùng đăng nhập.
Kiểm tra: `cd api && go vet ./... && go test ./...`
Góc review thêm: bảo mật theo `ATTACK-CLASSES.md` của skill `security-audit` phần xác thực, CSRF, open redirect, cookie.
Đọc thêm: `_bmad-output/SP005/README.md`; bàn giao Task009, Task010, Task014, Task041, Task043; `BAN_DO_STORY.md` dòng STR022.
