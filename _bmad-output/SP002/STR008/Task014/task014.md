# Task014: Cookie và stream qua rewrites

Thuộc: SP002 / STR008
Mục tiêu: Xác nhận khi trình duyệt gọi Gin qua `rewrites` của Next.js thì cookie đăng nhập được đặt và gửi lại đúng, và phản hồi dạng stream đến từng phần chứ không bị gom lại.
Phạm vi: `spikes/stream-cookie/**`, `_bmad-output/SP002/STR008/Task014/**`.
Không làm: sửa `web/` hay `api/`, auth thật (SP005), AI proxy thật (SP012).

Hợp đồng:
- `spikes/stream-cookie/server/`: server Go nhỏ dùng Gin cùng bản với `api/go.mod`. Có `GET /login` đặt cookie `sid` với `HttpOnly`, `Secure` khi chạy HTTPS, `SameSite=Lax`, `Path=/`. Có `GET /me` trả cookie nhận được. Có `GET /stream` gửi 10 phần cách nhau 300 ms theo dạng SSE, mỗi phần có thời điểm gửi.
- `spikes/stream-cookie/web/`: app Next.js tối thiểu, cùng bản Next với `web/package.json`, có `rewrites` `/api/:path*` đến server Go, và một trang gọi ba route trên.
- `npm run check` trong `spikes/stream-cookie/web/` chạy Playwright và in kết quả.

Tiêu chí xong:
- AC1: Ở `next start` trên máy, sau `/api/login` thì `/api/me` nhận được cookie `sid`, và cookie hiện trên domain của Next, không phải domain của Go.
- AC2: Ở `next start`, trình duyệt nhận các phần của `/api/stream` rải ra theo thời gian. Tiêu chí: khoảng cách giữa phần đầu và phần cuối lúc nhận lớn hơn 2 giây.
- AC3: Ghi các header cần thiết để stream không bị gom, ví dụ `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, và kiểm từng header có ảnh hưởng hay không.
- AC4: Phần Vercel và Render. Nếu `_bmad-output/SP001/STR005/Task010/ban_giao_task010.md` đã tồn tại trên `main` lúc làm task, deploy spike lên một project Vercel riêng và server Go lên một dịch vụ Render riêng, rồi chạy lại AC1, AC2. Nếu chưa có, ghi "chưa kiểm trên Vercel" và liệt kê từng bước để chạy lại sau. Không dùng tài khoản hay key nào ngoài những gì chủ dự án đã cấp.
- AC5: `ket_qua.md` trong thư mục task có kết quả từng AC, lệnh đã chạy, và cấu hình cần đưa vào `web/` và `api/`.

Ca biên: nếu `rewrites` gom stream thì thử Route Handler của Next làm proxy stream, và ghi so sánh.
Kiểm tra: chạy server Go, rồi `cd spikes/stream-cookie/web && npm ci && npm run build && npm run check`.
Góc review thêm: bảo mật của cookie.
Đọc thêm: `CLAUDE.md` mục "Kiến trúc", "Cần thử khi dựng"; `_bmad-output/SP001/STR005/Task010/task010.md`.
