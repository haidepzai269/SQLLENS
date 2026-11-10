# Bàn giao Task087

Đã làm: Hiện thực hóa cơ chế Signed Session Cookie (HMAC-SHA256) tại tầng RAM Gin. Đọc biến môi trường `SESSION_SECRET` (tối thiểu 32 ký tự, tự sinh khóa ngẫu nhiên an toàn trong bộ nhớ khi chạy môi trường dev/test). Cấp phát cookie `sid` theo định dạng `<raw_token>.<hmac_signature_base64url>` có độ dài đúng 87 ký tự. Hàm `signToken` và `verifyToken` dùng `crypto/hmac` và `subtle.ConstantTimeCompare` chống timing attack. Cập nhật middleware `requireUser` kiểm tra tính toàn vẹn chữ ký ngay tại bộ nhớ RAM Gin, từ chối ngay lập tức `401 Unauthorized` (`error.authRequired`) đối với mọi cookie thiếu chữ ký, sai chữ ký, hoặc chuỗi rác ngẫu nhiên mà không tốn bất kỳ truy vấn nào vào Neon Postgres (0 DB query). Cookie hợp lệ được trích xuất `rawToken` nguyên bản truyền vào `store.SessionUser`. Hàm `logout` xác thực chữ ký trước khi xóa session trong Postgres.
File chính: `api/internal/auth/auth.go`, `api/cmd/server/main.go`, `api/internal/auth/auth_test.go`, `api/.env.example`.
Kết quả kiểm tra: `cd api && go test -v -count=1 -run TestAuth_CookieHMAC ./internal/auth/...` đạt 100% PASS cho toàn bộ tiêu chí AC1-AC5. Chạy toàn diện `cd api && go test ./...` đạt PASS ở tất cả các package (`cmd/server`, `internal/ai`, `internal/auth`, `internal/httpapi`, `internal/mysql`, `internal/quota`, `internal/store`).
Kết quả review: Task-reviewer độc lập thẩm định và chấm PASS 100% (AC1-AC5 đạt đầy đủ, 0 lỗi, 0 mục needs_validation).
Chưa làm được: Không.
Phát sinh: Không.
Việc tiếp theo cần biết: Task088 (STR063.2) sẽ hiện thực hóa Redis Atomic Abuse Gatekeeper bằng Lua script trên Upstash Redis, tiếp nhận các sự kiện token sai chữ ký hoặc DB Not Found từ `requireUser` để tự động cách ly IP spam vi phạm quá ngưỡng (10 lần / 60 giây cấm 15 phút).
