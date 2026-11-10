# Task088: Hiện thực hóa Redis Atomic Abuse Gatekeeper bằng Lua Script trên Upstash

Thuộc: SP999 / STR063 (SPEC-AUTH-SHIELD)
Mục tiêu: Phát hiện hành vi lạm dụng (gửi sid sai HMAC liên tục hoặc gửi sid tra DB ra Not Found) theo từng Client IP. Sử dụng Lua script nguyên tử trên Upstash Redis để tự động tạm khóa (Ban 15 phút) khi vi phạm quá ngưỡng, chặn đứng request bằng mã `429 Too Many Requests`.

Phạm vi tác động:
- `api/internal/auth/abuse.go` (tạo mới)
- `api/internal/auth/abuse_test.go` (tạo mới)
- `api/internal/auth/auth.go`
- `api/cmd/server/main.go`

Không làm:
- Không tạo thêm kết nối TCP Redis trực tiếp (tiếp tục sử dụng Upstash REST API qua HTTP Client hiện có).
- Không chặn nhầm người dùng bình thường (ngưỡng 10 lần sai / 60 giây).

Quy cách kỹ thuật:
1. Helper `clientIP(c *gin.Context) string` trích xuất Client IP an toàn từ `X-Forwarded-For` (lấy IP đầu tiên), fallback về `c.ClientIP()`.
2. Lua script nguyên tử trên Upstash:
   ```lua
   local is_banned = redis.call('EXISTS', KEYS[2])
   if is_banned == 1 then
       local ttl = redis.call('TTL', KEYS[2])
       return {1, ttl}
   end
   local current = redis.call('INCR', KEYS[1])
   if current == 1 then
       redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
   end
   if current > tonumber(ARGV[1]) then
       redis.call('SET', KEYS[2], '1', 'EX', tonumber(ARGV[3]))
       redis.call('DEL', KEYS[1])
       return {1, tonumber(ARGV[3])}
   end
   local ttl = redis.call('TTL', KEYS[1])
   return {0, current, ttl}
   ```
3. Cấu hình: limit = 10, window = 60s, block_duration = 900s (15 phút).
4. Middleware `AbuseGate`: nếu IP đang bị ban -> trả về `429 Too Many Requests` (`error.rateLimited`) kèm header `Retry-After: <ttl_giay>`.
5. Tích hợp `RecordAbuse` khi token sai HMAC hoặc DB trả về `store.ErrNotFound`.

Tiêu chí nghiệm thu (AC):
- AC1: Lua script chạy nguyên tử trên Upstash Redis qua REST client hiện có, server-side TTL tự động.
- AC2: Khi IP vi phạm từ 1 đến 10 lần trong 60 giây, request nhận mã lỗi thông thường (401).
- AC3: Ở lần vi phạm thứ 11, IP tự động chuyển sang trạng thái Banned trong 15 phút; request nhận ngay mã `429 Too Many Requests` kèm header `Retry-After`.
- AC4: Mọi request tiếp theo từ IP đang bị ban đều bị từ chối với mã 429 trước khi vào handler.
- AC5: Sau 15 phút, trạng thái ban tự động hết hạn, IP được phục hồi quyền truy cập bình thường.
- AC6: Unit/Integration test trong `api/internal/auth/abuse_test.go` đạt 100% pass.

Kiểm tra: `cd api && go test -v -run TestAbuseGate ./internal/auth/...`
Đọc thêm: `_bmad-output/SPEC_AUTH_SHIELD.md`.

