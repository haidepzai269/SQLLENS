# Bàn giao Task089: Local Fast-Path Ban Cache trong RAM, Graceful Session Transition & Load Benchmark

Đã làm:
- Hiện thực hóa module `LocalBanCache` trong RAM Gin bằng `sync.RWMutex`, hỗ trợ `IsBanned` trong 0ms, tự động clamp TTL tối đa 60 giây và goroutine dọn dẹp định kỳ 30 giây chống rò rỉ RAM.
- Tích hợp Tầng 0 Fast-Path vào `AbuseGatekeeper.CheckBan`, chặn đứng 100% request từ IP bị ban ngay tại RAM với 0 HTTP request gọi sang Upstash REST.
- Hiện thực hóa cơ chế Graceful Session Transition qua hàm `isLegacyToken`, từ chối 401 êm dịu các phiên cũ chưa ký (32 bytes raw token hợp lệ) mà không tính vào abuse counter.
- Xây dựng bộ test tải và benchmark trong `auth_bench_test.go` chứng minh 2.000 req/s spam sid rác hoàn tất với latency 23.3 µs/req và 0 connection vào Neon Postgres.
- Xác nhận các thông báo i18n cho mã lỗi `rateLimited` và `authRequired` đã có đầy đủ ở cả tiếng Việt và tiếng Anh trong `web/messages/*/error.json`.

File chính:
- `api/internal/auth/cache.go`: Bộ nhớ đệm cục bộ `LocalBanCache` quản lý IP bị ban thread-safe.
- `api/internal/auth/cache_test.go`: Unit test kiểm thử cơ chế TTL, dọn dẹp và đa luồng của cache.
- `api/internal/auth/abuse.go`: Tích hợp Tầng 0 Fast-Path vào `AbuseGatekeeper`.
- `api/internal/auth/abuse_test.go`: Bổ sung kiểm thử Fast-Path 0 Upstash calls và Graceful Transition.
- `api/internal/auth/auth.go`: Thêm `isLegacyToken` và logic xử lý chuyển tiếp phiên êm dịu trong `requireUser`.
- `api/internal/auth/auth_bench_test.go`: Benchmark tải 2.000 req/s và đo lường hiệu năng Tầng 0/Tầng 1.

Kết quả kiểm tra:
- `go test -v -count=1 -run TestLocalBan ./internal/auth/...`: PASS (100%).
- `go test -v -count=1 -run TestGracefulSessionTransition ./internal/auth/...`: PASS (100%).
- `go test -v -run Benchmark ./internal/auth/... -bench=. -benchtime=1s`: PASS (2.000 requests trong 46.6ms, latency 23.3 µs/req, 0 query vào DB).
- `cd api && go test ./...`: PASS 100% toàn bộ package.
- `cd web && npm run check`: PASS 100% (51 test files, 572 tests passed, i18n, lint, typecheck).

Kết quả review:
- Reviewer độc lập đánh giá PASS 100% ngay từ vòng 1 (thỏa mãn trọn vẹn AC1 - AC5, 0 lỗi, 0 needs_validation).

Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết:
- Hoàn tất 100% chuỗi Epic SP999/STR063 (Auth Shield: Task087, Task088, Task089).
- Hệ thống phòng thủ 3 tầng (RAM Ban Cache 0ms -> Signed Session Cookie < 0.1ms -> Redis Lua Gatekeeper) đã kiên cố hóa hoàn toàn tầng Auth, sẵn sàng phát hành Release V1.
