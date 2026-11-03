# Task043: Quota bằng Upstash

Thuộc: SP005 / STR023
Mục tiêu: Gin đếm và giới hạn số lần dùng MySQL và AI theo người dùng, bằng Upstash Redis, không tin dữ liệu từ frontend.
Phạm vi: `api/internal/quota/**`.
Không làm: nối vào `router.go` (Task042), giao diện (Task044), thêm thư viện Go.

Hợp đồng:
- `quota.New(restURL, restToken string, httpClient *http.Client) *Limiter`. Gọi Upstash bằng REST API qua `net/http`, không dùng thư viện Redis.
- `Rule = { Name string; Limit int; Window time.Duration }`. Mặc định: `mysql_session` 20 lần mỗi ngày, `ai_message` 30 lần mỗi ngày. Ghi lý do chọn số và để dễ đổi.
- `(*Limiter).Middleware(rule Rule, key func(*gin.Context) (string, bool)) gin.HandlerFunc`. `key` trả user id; không có thì trả 401 với mã `auth_required`. Vượt hạn mức trả 429 với mã `quota_exceeded`, header `Retry-After`, và thời điểm có lại. Lỗi theo `web/src/contracts/api-error.ts`.
- Mỗi yêu cầu tốn tối đa 2 lệnh Upstash (ví dụ `INCR` cộng `EXPIRE` gộp trong một pipeline), vì gói free chỉ có 500.000 lệnh mỗi tháng. Ghi ước tính số lệnh mỗi tháng vào bàn giao.
- Upstash không trả lời hoặc lỗi: chặn yêu cầu (fail-closed) với 503 và mã `quota_unavailable`, vì MySQL và AI tốn tài nguyên thật. Ghi lý do.
- Không ghi user id đầy đủ, token Upstash hay nội dung yêu cầu vào log.

Tiêu chí xong:
- AC1: Test với Upstash giả bằng `httptest` làm đúng phần REST API cần dùng: yêu cầu thứ `Limit` qua, thứ `Limit + 1` bị 429, sang cửa sổ mới thì qua lại.
- AC2: 50 yêu cầu đồng thời cùng một user với `Limit` 20: đúng 20 qua.
- AC3: Hai user khác nhau đếm riêng. Hai `Rule` khác nhau đếm riêng.
- AC4: Upstash trả lỗi, timeout 2 giây, hoặc trả dữ liệu hỏng: 503 `quota_unavailable`, không panic, không cho qua.
- AC5: Thiếu user trả 401 `auth_required`, không gọi Upstash.
- AC6: Đếm số lệnh gửi tới Upstash giả: không quá 2 cho mỗi yêu cầu.
- AC7: `cd api && go vet ./... && go test ./...` thoát với mã 0.

Ca biên: user id chứa ký tự đặc biệt hoặc rất dài thì khóa Redis vẫn an toàn (băm hoặc escape); đồng hồ máy lệch không làm mất hạn mức.
Kiểm tra: `cd api && go vet ./... && go test ./...`
Góc review thêm: bảo mật (bỏ qua quota, chèn khóa Redis).
Đọc thêm: `_bmad-output/SP005/README.md`; mục Upstash trong `CLAUDE.md`.
