---
id: SPEC-auth-shield
companions:
  - architecture-diagrams.md
  - lua-script.md
sources: []
---

> **Canonical contract.** SPEC này cùng các file companion là hợp đồng kỹ thuật chuẩn mực cho việc triển khai, kiểm thử và nghiệm thu cơ chế bảo vệ xác thực (Authentication Hardening) của SQLLens.

# Kiên Cố Hóa Authentication: Signed Session Cookie (HMAC-SHA256) & Redis Atomic Abuse Gatekeeper

## Why

Hệ thống SQLLens hiện sử dụng Stateful Session qua cookie `sid` ngẫu nhiên 32 byte, lưu băm SHA-256 trên Neon Postgres. Tuy nhiên, Neon Postgres chỉ có `MaxConns = 4` nhằm đảm bảo khả năng tự động "ngủ" (auto-suspend) tiết kiệm compute hour trên gói miễn phí. 

Hiện tại, nếu kẻ tấn công hoặc botnet liên tục gửi các request mang cookie `sid` giả mạo (`sid` rác ngẫu nhiên), middleware `requireUser` sẽ thực thi câu lệnh SQL `SELECT ... FROM sessions WHERE token_hash = ...` trên Neon cho mỗi request. Với 4 connection ít ỏi, đợt spam này sẽ gây nghẽn hoàn toàn connection pool (Connection Pool Exhaustion), đẩy toàn bộ người dùng hợp lệ vào trạng thái lỗi `503 Service Unavailable`.

Giải pháp cấp bách: **Đẩy điểm xác thực và từ chối request độc hại ra càng xa database càng tốt**. Bằng cách kết hợp **Ký số Cookie bằng HMAC-SHA256 ngay trong bộ nhớ RAM của Gin** và **Khóa nguyên tử IP lạm dụng bằng Redis Lua Script trên Upstash**, 100% request rác sẽ bị loại bỏ ngay từ cửa ngõ trước khi có bất kỳ cơ hội nào chạm tới Neon Postgres.

## Capabilities

- **CAP-1: Signed Session Cookie (HMAC-SHA256 trong RAM)**
  - **intent:** Gin ký số mọi cookie `sid` được cấp phát bằng secret key (`SESSION_SECRET`) và kiểm tra tính toàn vẹn của chữ ký HMAC ngay trong RAM cho mỗi request trước khi chuyển tiếp.
  - **success:** Mọi request mang `sid` có định dạng sai, thiếu chữ ký, hoặc chữ ký HMAC không khớp bị Gin từ chối ngay với mã `401 Unauthorized` trong < 0.1ms; không có bất kỳ kết nối hay câu query nào được gửi tới Neon Postgres.

- **CAP-2: Redis Atomic Abuse Gatekeeper (Lua Script chống spam IP)**
  - **intent:** Hệ thống phát hiện và tự động tạm khóa (quarantine/ban) các IP có hành vi lạm dụng (gửi sid sai HMAC liên tục, gửi sid hợp lệ nhưng không tồn tại trong DB, hoặc spam request) bằng Redis Lua script nguyên tử.
  - **success:** Một IP gửi quá $N$ request lỗi trong cửa sổ $T$ giây (mặc định: 10 lỗi / 60 giây) sẽ tự động bị khóa trong $B$ giây (mặc định: 15 phút); mọi request tiếp theo từ IP này bị từ chối với mã `429 Too Many Requests` (kèm header `Retry-After`) trước khi vào Gin handler.

- **CAP-3: Local Fast-Path Ban Cache trong RAM của Gin**
  - **intent:** Gin lưu tạm danh sách các IP đang bị ban vào bộ nhớ cục bộ (in-memory cache với TTL ngắn 30-60 giây) để không làm tiêu hao quota REST API của Upstash Redis khi một IP bị ban tiếp tục bắn request dồn dập.
  - **success:** Khi một IP đã bị đưa vào danh sách ban, 100% request từ IP đó trong thời gian cache được trả thẳng mã `429` ngay tại RAM mà không phát sinh thêm HTTP call sang Upstash REST API.

- **CAP-4: Safe Transition & Graceful Session Handling**
  - **intent:** Hệ thống xử lý chuyển tiếp an toàn giữa các session cũ (chưa ký HMAC trước đợt nâng cấp) và session mới mà không gây vỡ ứng dụng.
  - **success:** Người dùng có session cũ chưa ký được thông báo hết hạn phiên một cách mượt mà (`auth_required`), chuyển hướng đăng nhập lại và nhận ngay cookie `sid` mới đã được ký HMAC.

## Constraints

- **Neon Connection Pool:** Giữ nguyên mức trần `MaxConns = 4` và `MinConns = 0` trên Neon Postgres; không được tăng pool để bù đắp cho lỗ hổng DoS.
- **Upstash REST API:** Tương tác Redis qua REST API sử dụng chung cấu hình và `http.Client` timeout <= 2 giây; gọi bằng Lua script nguyên tử đảm bảo server-side TTL.
- **Client Transparency:** Phía frontend Next.js hoàn toàn không phải thay đổi cơ chế gọi API; vẫn dùng `credentials: "same-origin"` và cookie `sid`.
- **Database Schema Integrity:** Bảng `sessions` trên Neon Postgres tiếp tục chỉ lưu `token_hash bytea` (SHA-256 của token thô), không bao giờ lưu trữ HMAC signature hay token gốc trên database.

## Non-goals

- **Không chuyển sang Stateless JWT:** Giữ vững nguyên tắc Stateful Session để bảo đảm quyền thu hồi phiên (revoke) ngay lập tức khi user logout hoặc cần ngắt session MySQL.
- **Không lưu trữ token ở Client Storage:** Tuyệt đối không đưa token vào `localStorage` hay `sessionStorage` của trình duyệt.
- **Không phụ thuộc WAF trả phí bên ngoài:** Xử lý triệt để bài toán bảo vệ ngay trong mã nguồn Gin và Upstash Redis hiện có, không phụ thuộc vào gói Cloudflare Enterprise hay AWS WAF.

## Success signal

- Khi chạy kịch bản thử nghiệm tải: Bắn 2.000 request/giây với `sid` ngẫu nhiên giả mạo vào `/api/me` hoặc các route có `requireUser`:
  1. 100% request rác bị chặn với mã `401` (sai HMAC) hoặc `429` (IP bị ban).
  2. Số lượng kết nối hoạt động (`Active Connections`) trên Neon Postgres đo được duy trì ở mức **0**.
  3. Người dùng thật đang thao tác bình thường không gặp bất kỳ độ trễ hay lỗi `503` nào.

## Assumptions

- Biến môi trường `SESSION_SECRET` (chuỗi bảo mật ngẫu nhiên tối thiểu 32 ký tự) được cấu hình an toàn trong `.env` và biến môi trường của Gin trên Render.
- Client IP được trích xuất chính xác từ header `X-Forwarded-For` thông qua proxy tin cậy của Vercel và Render.

