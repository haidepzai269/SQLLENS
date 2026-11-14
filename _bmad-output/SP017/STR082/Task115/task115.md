# Task115: Chuẩn hóa phân quyền RBAC Backend Gin & Khắc phục lỗ hổng hết hạn VIP

Thuộc: SP017 / STR082
Mục tiêu: Khắc phục triệt để lỗ hổng middleware phân quyền RBAC trong Gin Backend (BUG-SP016-03): đảm bảo `a.RequireVip()` tự động nhận diện và xác thực Session Cookie của Neon khi đứng độc lập; bắt buộc kiểm tra `u.IsVIP()` (tính cả thời hạn `vip_until`) ngăn chặn tài khoản hết hạn truy cập API; đồng nhất luồng xác thực cho `/ai/inline-complete`.

Phạm vi:
- `api/internal/auth/middleware.go`
- `api/internal/auth/auth.go`
- `api/internal/ai/ai.go`
- `api/internal/auth/middleware_test.go`
- `api/internal/ai/inline_complete_test.go`

Không làm:
- Không xóa bỏ hỗ trợ JWT (vẫn giữ tương thích ngược cho header Authorization: Bearer).
- Không sửa logic sinh mã hoàn tất của model AI ở `inline_complete.go`.

Hợp đồng:
- `a.RequireVip()`:
  - Nếu context chưa có `userKey`, tự động đọc và kiểm tra session cookie (`sqllens_session`) qua `a.store.SessionUser`.
  - Kiểm tra `u.IsVIP()` (yêu cầu `role == "vip"` VÀ `now < vip_until` nếu `vip_until != nil`).
  - Nếu chưa đăng nhập: Abort 401 Unauthorized (`auth_required`).
  - Nếu đã đăng nhập nhưng `role != "vip"`: Abort 403 Forbidden (`vip_required`).
  - Nếu đã đăng nhập với `role == "vip"` nhưng `vip_until` đã hết hạn: Abort 403 Forbidden (`vip_expired`).
- `RequireRole("vip")`:
  - Bắt buộc kiểm tra `u.IsVIP()` đối với role "vip" thay vì so sánh chuỗi `role == "vip"`.
- Trong `ai.Mount`:
  - `gVip := r.Group("/ai", a.RequireVip())` hoạt động hoàn hảo với cả Session Cookie và Bearer JWT token.

Tiêu chí xong:
- AC1: Session Cookie VIP còn hạn: Request tới `/ai/inline-complete` mang cookie phiên VIP còn hạn được thông qua và xử lý bình thường (HTTP 200).
- AC2: Session Cookie thường: Request mang cookie phiên `role = "user"` bị từ chối HTTP 403 Forbidden với mã lỗi `vip_required`.
- AC3: Session Cookie VIP hết hạn: Request mang cookie phiên `role = "vip"` nhưng `vip_until < now()` bị từ chối HTTP 403 Forbidden với mã lỗi `vip_expired`.
- AC4: Chưa đăng nhập: Request không có cookie hoặc cookie không hợp lệ bị từ chối HTTP 401 Unauthorized với mã lỗi `auth_required`.
- AC5: Tương thích ngược JWT: Request mang header `Authorization: Bearer <valid_vip_jwt>` vẫn được xử lý bình thường; token VIP hết hạn bị từ chối 403.
- AC6: Toàn bộ Go tests trong `api/internal/auth` và `api/internal/ai` đạt 100% PASS (`go test ./...`).

Ca biên: Cookie rỗng hoặc bị sửa đổi chữ ký; `vip_until` là NULL (VIP vĩnh viễn) được xem là hợp lệ; server Neon Postgres tạm thời ngắt kết nối trả về lỗi an toàn.
Kiểm tra: `cd api; go test ./...`.
Góc review thêm: Bảo mật phân quyền / Tính toàn vẹn của Session Cookie / Không rò rỉ thông tin người dùng trong mã lỗi.
Đọc thêm: `_bmad-output/SPEC_VA_LOI_SP016.md` mục 2 (BUG-SP016-03) và mục 3 (STR082).
