# Biên bản bàn giao Task106: Phân quyền RBAC Backend Gin & Neon DB, schema role/vip_until, JWT claims và Middleware RequireVip

- **Thuộc:** SP016 / STR076
- **Thời gian bàn giao:** 2026-11-12
- **Người thực hiện:** Amelia (`amelia-dev`)
- **Người review độc lập:** Task Reviewer (`task-reviewer`)
- **Trạng thái:** HOÀN THÀNH (Reviewer PASS 100%)

---

## 1. Mục tiêu và Phạm vi đã triển khai

Nâng cấp toàn diện cơ chế phân quyền tài khoản (RBAC) 3 cấp độ (`guest`, `user`, `vip`) cho nền tảng SQLLens:
- CSDL Neon: Thêm cột `role` và `vip_until` vào bảng `users`, tạo bảng quản lý mã kích hoạt `vip_codes` và lịch sử nạp `user_vip_redemptions`.
- Tầng lưu trữ (Store): Struct `User` mở rộng, hàm `IsVIP()`, hàm transaction nạp VIP an toàn `RedeemVipCode`.
- Xác thực & JWT: Module JWT HS256 chuẩn RFC 7519, claims chứa `role` và `vip_until`, chống timing attack và thuật toán none.
- Middleware: Gin middleware `RequireVip()` và `RequireRole()` bảo vệ các endpoint độc quyền (trả HTTP 403 `vip_required`).
- API Endpoints: Cập nhật `GET /me` (kèm `role`, `vipUntil`, `isVip`), bổ sung `POST /auth/redeem-vip` & `POST /api/auth/redeem-vip` nạp voucher VIP tức thì.

---

## 2. Danh sách file thay đổi

| STT | Đường dẫn file | Thay đổi chính |
| :---: | :--- | :--- |
| 1 | `api/migrations/002_add_user_roles.sql` | Migration thêm cột `role`, `vip_until`, bảng `vip_codes`, `user_vip_redemptions` và seed mã mẫu. |
| 2 | `api/internal/store/store.go` | Cập nhật struct `User`, `IsVIP()`, `userCols`, `scanUser`, `SessionUser`, hàm nạp VIP `RedeemVipCode`. |
| 3 | `api/internal/store/store_test.go` | Unit test cho `User.IsVIP()` (VIP còn hạn, hết hạn, nil/vĩnh viễn, user thường). |
| 4 | `api/internal/auth/jwt.go` | Cấu trúc `Claims`, hàm `GenerateUserToken`, `ParseUserToken` dùng HMAC-SHA256 chuẩn. |
| 5 | `api/internal/auth/jwt_test.go` | Unit test toàn diện cho JWT: sinh, giải mã, hết hạn, sai chữ ký, fallback token cũ. |
| 6 | `api/internal/auth/middleware.go` | Middleware `RequireVip()` và `RequireRole()` hỗ trợ cả Cookie Session và Bearer JWT Token. |
| 7 | `api/internal/auth/middleware_test.go` | Test middleware: Guest (401), User thường (403), VIP còn hạn (200), VIP hết hạn (403), Bearer token. |
| 8 | `api/internal/auth/auth.go` | Bổ sung `role`, `vipUntil`, `isVip` vào `GET /me`; handler `POST /auth/redeem-vip`. |

---

## 3. Nghiệm thu tiêu chí (AC1 - AC5)

- [x] **AC1: Migration Neon DB schema role & vip_until** - Thêm cột `role text NOT NULL DEFAULT 'user'` và `vip_until timestamptz NULL`. Bảng `vip_codes` và `user_vip_redemptions` chống kích hoạt lặp lại.
- [x] **AC2: Sinh và giải mã JWT claims quyền hạn** - Token claims chứa `{ uid, role, vip_until, iat, exp }`. Chữ ký HMAC-SHA256, constant-time compare, fallback an toàn token cũ.
- [x] **AC3: Middleware RequireVip() và RequireRole()** - Bảo vệ route độc quyền. VIP còn hạn truy cập 200; người dùng thường hoặc VIP hết hạn trả HTTP 403 `vip_required`. Chưa đăng nhập trả HTTP 401.
- [x] **AC4: Endpoint POST /api/auth/redeem-vip** - Xử lý nạp mã voucher với transaction `FOR UPDATE`, cộng dồn thời hạn nếu đang là VIP, trả mã lỗi chi tiết khi mã sai / hết lượt / đã dùng.
- [x] **AC5: Kiểm thử tự động đạt 100%** - Toàn bộ unit tests tại `api/internal/auth` và `api/internal/store` đều PASS (`go test ./...` và `go vet ./...`).

---

## 4. Đánh giá bảo mật và chất lượng code

1. **Chống Timing Attack:** Toàn bộ chữ ký HMAC đều sử dụng `crypto/subtle.ConstantTimeCompare`.
2. **Chống None Algorithm Attack:** Bắt buộc kiểm tra `header.Alg == "HS256"`.
3. **Chống Race Condition:** Transaction nạp mã sử dụng khóa dòng `SELECT ... FOR UPDATE` và ràng buộc duy nhất `UNIQUE(user_id, code)` tầng CSDL.
4. **Chống Gian Lận Thời Gian:** Thời hạn VIP được máy chủ tính toán độc quyền dựa vào `duration_days` cấu hình trong CSDL.
5. **An toàn SQL:** 100% truy vấn dùng parameterized query (`$1`, `$2`), loại bỏ hoàn toàn nguy cơ SQL Injection.
