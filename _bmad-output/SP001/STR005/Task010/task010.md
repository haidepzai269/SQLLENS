# Task010: Deploy và giữ thức

Thuộc: SP001 / STR005
Điều kiện bắt đầu: Task007 và Task009 đã merge, chủ dự án đã có tài khoản Vercel và Render nối với repo GitHub.
Mục tiêu: `web/` chạy trên Vercel, `api/` chạy trên Render, trình duyệt gọi API qua cùng domain.
Phạm vi: `render.yaml`, `.github/workflows/keep-awake.yml`, `web/next.config.ts`.
Không làm: domain riêng, key của bên thứ 3, kiểm tra stream và cookie (STR008).

Hợp đồng:
- `web/next.config.ts`: `rewrites` chuyển `/api/:path*` đến `${API_ORIGIN}/:path*`. `API_ORIGIN` là biến môi trường phía server, không có tiền tố `NEXT_PUBLIC_`. Thiếu biến này thì build báo lỗi rõ.
- `render.yaml`: dịch vụ web, runtime Docker, gói free, `rootDir: api`, `healthCheckPath: /healthz`.
- `keep-awake.yml`: cron `*/10 0-16 * * *` theo UTC, tức 7:00 đến 23:50 giờ Việt Nam. Gọi URL từ biến repo `API_HEALTH_URL`. `permissions: {}`.
- Chủ dự án tự thao tác trên trang Vercel và Render. Liệt kê từng bước trong bàn giao: Root Directory của Vercel là `web`, biến `API_ORIGIN`, biến repo `API_HEALTH_URL`.

Tiêu chí xong:
- AC1: `curl https://<vercel>/api/healthz` trả 200 và `{"status":"ok"}`.
- AC2: `curl https://<vercel>/vi` trả 200.
- AC3: Bundle phía client không chứa giá trị `API_ORIGIN`. Kiểm bằng grep trong `web/.next/static`.
- AC4: Chạy tay `keep-awake.yml` bằng `workflow_dispatch` và thành công. URL lỗi thì job đỏ, dùng `curl --fail`.
- AC5: `actionlint` sạch.
- AC6: `curl https://<vercel>/en` hiện đúng tiếng Anh. Task007 thêm `outputFileTracingIncludes` cho `messages/**` nhưng chưa kiểm trên Vercel.

Ca biên:
- Render đang ngủ: `curl` trong `keep-awake.yml` có `--max-time 120` và `--retry 2`.
- GitHub có thể chạy cron trễ, nên ghi vào bàn giao mức trễ đo được nếu có.
- Điều khoản ping của Render chưa kiểm chứng, STR011 sẽ trả lời. Task này không kết luận về điều khoản.

Kiểm tra: AC1 đến AC4 trên domain thật. Thiếu tài khoản thì dừng và báo chủ dự án, không giả kết quả.
Góc review thêm: bảo mật.
Đọc thêm: `CLAUDE.md` mục "Kiến trúc", dòng "Giờ chạy backend"; bàn giao Task007, Task009.
