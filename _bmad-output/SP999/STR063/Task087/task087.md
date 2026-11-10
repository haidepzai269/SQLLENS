# Task087: Hiện thực hóa Signed Session Cookie (HMAC-SHA256) và xác thực tại RAM Gin

Thuộc: SP999 / STR063 (SPEC-AUTH-SHIELD)
Mục tiêu: Cấp phát cookie `sid` có kèm chữ ký HMAC-SHA256. Middleware `requireUser` kiểm tra tính toàn vẹn chữ ký ngay trong bộ nhớ RAM; từ chối `401 Unauthorized` mọi token sai hoặc rác mà không tốn một query nào vào Neon Postgres.

Phạm vi tác động:
- `api/internal/auth/auth.go`
- `api/internal/auth/oauth.go`
- `api/internal/auth/auth_test.go`
- `api/cmd/server/main.go`

Không làm:
- Không thay đổi schema database trên Neon Postgres (bảng `sessions` vẫn chỉ lưu `token_hash bytea = sha256(raw_token)`).
- Không đổi cơ chế lưu trữ phía client (vẫn dùng HttpOnly cookie `sid`).

Quy cách kỹ thuật:
1. Đọc biến môi trường `SESSION_SECRET` (chuỗi bảo mật ngẫu nhiên tối thiểu 32 ký tự).
2. Định dạng token cookie `sid`: `<raw_token_32_bytes>.<hmac_signature_base64url>` (độ dài đúng 87 ký tự).
3. Hàm `signToken(token string, secret []byte) string`:
   ```go
   h := hmac.New(sha256.New, secret)
   h.Write([]byte(token))
   sig := base64.RawURLEncoding.EncodeToString(h.Sum(nil))
   return token + "." + sig
   ```
4. Hàm `verifyToken(signedTok string, secret []byte) (rawToken string, ok bool)`:
   - Tách theo dấu chấm `.`. Bắt buộc đúng 2 phần, mỗi phần 43 ký tự.
   - Tính lại HMAC trên phần 1, so sánh với phần 2 bằng `subtle.ConstantTimeCompare`.
5. Cập nhật `sessionCookie`: ký token trước khi trả cookie về trình duyệt.
6. Cập nhật `requireUser`: verify HMAC trước khi chạm DB. Sai chữ ký -> abort 401 ngay, không gọi `a.store.SessionUser`.

Tiêu chí nghiệm thu (AC):
- AC1: `signToken` và `verifyToken` chạy chính xác theo thuật toán HMAC-SHA256, kiểm tra constant-time chống timing attack.
- AC2: Luồng OAuth callback cấp phát cookie `sid` mang đầy đủ token và chữ ký hợp lệ.
- AC3: Middleware `requireUser` từ chối ngay với mã `401 Unauthorized` (`error.authRequired`) đối với: cookie thiếu chữ ký, cookie sai chữ ký, cookie rác ngẫu nhiên. Số query vào Neon Postgres = 0.
- AC4: Request mang cookie hợp lệ tra cứu session và user bình thường từ Neon Postgres.
- AC5: Unit test trong `api/internal/auth/auth_test.go` đạt 100% pass cho tất cả các kịch bản token.

Kiểm tra: `cd api && go test -v -run TestAuth_CookieHMAC ./internal/auth/...`
Đọc thêm: `_bmad-output/SPEC_AUTH_SHIELD.md`.

