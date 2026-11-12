# Task106: Phân quyền RBAC Backend Gin & Neon DB: Schema role/vip_until, JWT claims và Middleware RequireVip

Thuộc: SP016 / STR076
Mục tiêu: Nâng cấp kiến trúc phân quyền tài khoản (RBAC) 3 cấp độ: `guest`, `user`, `vip` trong cơ sở dữ liệu Neon; tích hợp thông tin role vào JWT claims; xây dựng middleware Gin `RequireVip()` bảo vệ các endpoint độc quyền.

Phạm vi:
- `api/internal/auth/auth.go`
- `api/internal/auth/jwt.go`
- `api/internal/auth/middleware.go`
- `api/internal/auth/middleware_test.go`
- `api/migrations/000004_add_user_roles.sql` (hoặc migration kế tiếp)
- `api/internal/server/server.go`

Không làm: Không chặn người dùng thường truy cập các tính năng cơ bản (PGlite, Ghost Text Code-based, Quota cơ bản); không lưu trữ thẻ thanh toán tại máy chủ (chỉ hỗ trợ mã kích hoạt và phân quyền role).

Hợp đồng:
- Database: Bảng `users` có thêm cột `role VARCHAR(20) NOT NULL DEFAULT 'user'` và `vip_until TIMESTAMPTZ NULL`.
- JWT Claims: Bổ sung trường `"role": string` và `"vip_until": *time.Time`.
- Middleware: `RequireVip()` kiểm tra nếu `role != "vip"` hoặc `time.Now().After(*vip_until)` thì trả về HTTP 403:
  ```json
  { "error": "vip_required", "message": "Tính năng yêu cầu tài khoản VIP" }
  ```
- Endpoint: `POST /api/auth/redeem-vip` nhận `{ "code": string }`, kiểm tra mã kích hoạt hợp lệ và gia hạn VIP cho người dùng.

Tiêu chí xong:
- AC1: Migration Neon DB thêm cột `role` và `vip_until` hoàn tất an toàn, không ảnh hưởng dữ liệu người dùng cũ.
- AC2: Hàm sinh JWT và giải mã JWT mang đầy đủ thông tin quyền hạn (`guest`, `user`, `vip`).
- AC3: Middleware `RequireVip()` bảo vệ thành công các endpoint nhạy cảm: Cho phép tài khoản VIP còn hạn truy cập; từ chối tài khoản thường hoặc tài khoản VIP đã hết hạn với mã lỗi chuẩn `vip_required`.
- AC4: Endpoint `POST /api/auth/redeem-vip` hỗ trợ nạp mã kích hoạt (Voucher/Promo code), cập nhật trạng thái `role = "vip"` và thời gian hết hạn tương ứng.
- AC5: Toàn bộ kiểm thử unit test Go cho middleware phân quyền và JWT claims đạt 100%.

Ca biên: Mã kích hoạt đã được sử dụng; tài khoản VIP vừa hết hạn đúng thời điểm gọi API; JWT cũ chưa có trường role (fallback về role 'user' an toàn).
Kiểm tra: `cd api && go test ./internal/auth/...`.
Góc review thêm: An toàn bảo mật JWT / Chống gian lận thời gian hết hạn.
Đọc thêm: `_bmad-output/SPEC_SMART_EDITOR.md` mục 3 (STR076) & `MUC_TIEU_TRUOC_MAT.md` mục 2.

