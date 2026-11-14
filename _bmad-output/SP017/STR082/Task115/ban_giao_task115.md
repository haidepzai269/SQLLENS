# Bàn giao Task115: Chuẩn hóa phân quyền RBAC Backend Gin & Khắc phục lỗ hổng hết hạn VIP

Đã làm:
- Khắc phục triệt để lỗ hổng BUG-SP016-03: `a.RequireVip()` và `a.RequireRole("vip")` tự động đọc, giải mã chữ ký HMAC-SHA256 của Session Cookie (`sid` và `sqllens_session`) qua `store.SessionUser` khi route đứng độc lập.
- Bắt buộc kiểm tra `u.IsVIP()` (tính cả `vip_until` so với thời điểm hiện tại), từ chối HTTP 403 Forbidden với mã lỗi `vip_expired` nếu VIP đã hết hạn.
- Tự động kích hoạt `DemoteExpiredVIP` hạ ngầm role về `user` trong cơ sở dữ liệu khi phát hiện VIP quá hạn tại `/me` hoặc qua middleware.
- Bảo vệ đồng nhất hai endpoint `/ai/inline-complete` và `/api/ai/inline-complete`, đồng thời cấu hình `credentials: "same-origin"` cho client `copilot-client.ts`.
- Bổ sung toàn diện bộ unit/integration tests cho Session Cookie, JWT Token và kiểm tra thời hạn VIP trong cả `api/internal/auth` và `api/internal/ai`.

File chính:
- `api/internal/auth/middleware.go`
- `api/internal/auth/auth.go`
- `api/internal/store/store.go`
- `api/internal/auth/middleware_test.go`
- `api/internal/ai/inline_complete_test.go`
- `web/src/modules/vip/api/copilot-client.ts`

Kết quả kiểm tra:
- `cd api; go test -count=1 ./...`: Toàn bộ 8 package đạt PASS 100% (cmd/server, ai, auth, httpapi, mysql, quota, store).
- `cd web; npm run check`: PASS 100% (0 errors lint, 0 errors typecheck, 858 tests passed vitest).

Kết quả review:
- Reviewer độc lập nghiệm thu PASS 100% ngay từ vòng đầu tiên, không có lỗi phát sinh hay mục needs_validation nào còn lại.

Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết: Task116 (STR083) có thể triển khai nâng cấp động cơ heuristics nhận thức scope cho `GROUP BY` và mở rộng `FK JOIN` mà không bị ảnh hưởng bởi tầng phân quyền backend.
