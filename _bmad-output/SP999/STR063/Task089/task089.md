# Task089: Local Fast-Path Ban Cache trong RAM, Graceful Session Transition & Load Benchmark

Thuộc: SP999 / STR063 (SPEC-AUTH-SHIELD)
Mục tiêu: Xây dựng bộ nhớ đệm cục bộ trong RAM của Gin để chặn IP bị ban mà không tốn lệnh Upstash; xử lý chuyển tiếp mượt mà cho người dùng có phiên cũ; viết kịch bản benchmark tải chứng minh Neon Postgres không chịu bất kỳ áp lực nào khi bị spam tải.

Phạm vi tác động:
- `api/internal/auth/cache.go` (tạo mới)
- `api/internal/auth/auth_bench_test.go` (tạo mới)
- `api/internal/auth/auth.go`
- `web/messages/vi.json`
- `web/messages/en.json`

Không làm:
- Không thay đổi hành vi frontend khi người dùng hợp lệ (cookie vẫn tự động gửi).
- Không để cache trong RAM phình to gây rò rỉ bộ nhớ (có cơ chế dọn dẹp TTL).

Quy cách kỹ thuật:
1. Module `LocalBanCache`:
   ```go
   type LocalBanCache struct {
       mu    sync.RWMutex
       items map[string]time.Time // ip -> expiry time
   }
   ```
   - Chặn nhanh tại Tầng 0: `IsBanned(ip)` trả về true -> abort `429 Too Many Requests` trong 0ms, không gọi sang Upstash REST API.
   - Cache TTL tối đa 60 giây để định kỳ đồng bộ lại trạng thái từ Upstash.
2. Graceful Session Transition:
   - Nếu cookie `sid` là token cũ (32 byte hợp lệ trước đây nhưng chưa có HMAC), từ chối êm đẹp với `401 Unauthorized` (`error.authRequired`) và không tính vào abuse counter.
   - Frontend kích hoạt `markAnon()`, giữ nguyên câu SQL đang soạn và hiển thị dialog đăng nhập lại.
   - Bổ sung thông báo i18n trong `web/messages/vi.json` và `en.json` cho trường hợp lỗi 429.
3. Benchmark tải (`api/internal/auth/auth_bench_test.go`):
   - Sử dụng `httptest.Server` mô phỏng 2.000 req/s spam `sid` rác liên tục.
   - Đo đạc số kết nối hoạt động trên Neon Postgres giữ nguyên = 0.

Tiêu chí nghiệm thu (AC):
- AC1: Khi IP bị ban tiếp tục spam 1.000 request, 100% bị chặn tại RAM (Tầng 0), số lượng HTTP request gọi sang Upstash REST tăng thêm = 0.
- AC2: Người dùng mang session cũ chưa ký được chuyển hướng đăng nhập lại mượt mà, không gặp lỗi crash hay trắng màn hình.
- AC3: Giao diện frontend hiển thị thông báo thân thiện bằng tiếng Việt và tiếng Anh khi nhận mã 429 hoặc khi phiên hết hạn.
- AC4: Benchmark tải 2.000 req/s đạt kết quả:
  - 100% request rác bị chặn với mã 401 hoặc 429.
  - Số lượng connection hoạt động trên Neon Postgres giữ nguyên bằng 0.
  - Latency trung bình cho request rác < 0.2ms.
- AC5: Toàn bộ test suite `api` và `web` chạy qua 100%: `go test ./...` và `npm run check` thoát mã 0.

Kiểm tra:
- Backend: `cd api && go test -v -bench=. ./internal/auth/...`
- Frontend: `cd web && npm run check`
Đọc thêm: `_bmad-output/SPEC_AUTH_SHIELD.md`.

