# Task118: Bảo Vệ Hạ Tầng AI Copilot Bằng Upstash Redis Token Bucket

Thuộc: SP017 / STR085
Mục tiêu: Khắc phục triệt để lỗ hổng Rate Limiter lưu trong RAM trên hạ tầng Render Free (BUG-SP016-06):
1. Chuyển cơ chế Rate Limit của VIP Inline Complete sang Upstash Redis token bucket / counter, bảo toàn trạng thái quota qua các lần restart của container Render Free.
2. Thiết lập 2 tầng hạn mức bảo vệ tài nguyên:
   - Tầng 1: Tối đa 60 requests/phút cho mỗi tài khoản VIP.
   - Tầng 2: Trần tối đa 1.000 requests/ngày cho mỗi tài khoản VIP (Daily Ceiling chống bot/spam cạn kiệt key upstream).
3. Cơ chế Fallback an toàn (Graceful Degradation): Khi Upstash Redis gặp sự cố mạng hoặc timeout, tự động chuyển về in-memory limiter trong RAM thay vì chặn đứng người dùng hoặc văng 500/503.

Phạm vi:
- `api/internal/quota/quota.go`: Export phương thức `Hit` (hoặc cung cấp helper check quota) để package `ai` có thể gọi trực tiếp.
- `api/internal/ai/ai.go`: Cập nhật `Config` và struct `chat` để nhận `Limiter *quota.Limiter`.
- `api/internal/ai/inline_complete.go`: Tích hợp kiểm tra hạn mức Upstash Redis (60 req/phút, 1000 req/ngày), fallback an toàn về in-memory limiter khi Redis lỗi.
- `api/cmd/server/main.go`: Nạp `d.Limiter` vào `ai.Config` khi khởi tạo server.
- `api/internal/ai/inline_complete_test.go`: Bổ sung kiểm thử mock Redis limit 60/phút, daily limit 1000/ngày, mã lỗi 429 Retry-After, và fallback an toàn khi Redis lỗi.

Không làm:
- Không thay đổi hành vi frontend hay API schema (request/response format giữ nguyên).
- Không phá vỡ Core Rule 7 (không log SQL, không log prompt, không log token).

Hợp đồng:
- `quota.VipInlineMinute`: `Rule{Name: "vip_inline_min", Limit: 60, Window: time.Minute}`
- `quota.VipInlineDay`: `Rule{Name: "vip_inline_day", Limit: 1000, Window: 24 * time.Hour}`
- Khi vượt hạn mức: Trả về HTTP 429 Too Many Requests (`code: "rate_limited"`, `messageKey: "error.rateLimited"` hoặc `code: "quota_exceeded"`, `messageKey: "error.quotaExceeded"`), kèm header `Retry-After: <seconds>`.
- Khi Redis offline hoặc trả về lỗi: Ghi nhận log cảnh báo nội bộ (không chứa bí mật) và fallback sang in-memory rate limiter, tiếp tục phục vụ người dùng VIP.

Tiêu chí xong:
- AC1: Kết nối Upstash Redis: `POST /ai/inline-complete` (và `/api/ai/inline-complete`) kiểm tra hạn mức qua Upstash Redis khi có cấu hình `d.Limiter`.
- AC2: Hạn mức phút: Chặn ở request thứ 61 trong vòng 1 phút của cùng một user, trả về HTTP 429 kèm `Retry-After`.
- AC3: Hạn mức ngày: Chặn ở request thứ 1001 trong vòng 24 giờ của cùng một user, trả về HTTP 429 kèm `Retry-After`.
- AC4: Fallback an toàn: Khi server Upstash Redis trả về lỗi (500 hoặc timeout), hệ thống tự động fallback về in-memory limiter, request hợp lệ vẫn nhận HTTP 200 từ AI.
- AC5: Local Development: Khi không có cấu hình Upstash Redis (`Limiter == nil`), hệ thống chạy hoàn toàn bằng in-memory limiter với limit 60 req/phút.
- AC6: Toàn bộ unit tests trong `api/internal/ai` và `api/...` PASS 100%, không phát sinh lỗi biên dịch hay race condition (`go test -race ./...`).

Kiểm tra: `cd api; go test ./...` và `cd web; npm run check`.
Góc review thêm: Kiểm tra tính nguyên tử (atomic) của Redis Lua script / Khả năng phục hồi khi Redis timeout.
Đọc thêm: `_bmad-output/SPEC_VA_LOI_SP016.md` mục 2 (BUG-SP016-06) và mục 3 (STR085).
