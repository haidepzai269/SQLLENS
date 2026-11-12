# Task111: Backend Gin Proxy /ai/inline-complete: Nén context 20 dòng, gọi model Qwen 3.8-27B (0.19s) và kiểm tra Role VIP

Thuộc: SP016 / STR079
Mục tiêu: Xây dựng endpoint backend `POST /api/ai/inline-complete` (hoặc `/ai/inline-complete`) tại Gin; tích hợp middleware `RequireVip()`; tối ưu hóa prompt nén (chỉ lấy 15-20 dòng SQL gần con trỏ + danh sách bảng rút gọn); kết nối model `qwen/qwen3.8-27b` với tốc độ phản hồi 0.19s, sinh mã SQL chuẩn xác.

Phạm vi:
- `api/internal/ai/inline_complete.go`
- `api/internal/ai/inline_complete_test.go`
- `api/internal/ai/ai.go`
- `api/internal/server/server.go`

Không làm: Không lưu trữ SQL người dùng vào log (tuân thủ Nguyên tắc cốt lõi 7); không cho phép người dùng thường hoặc khách gọi endpoint này; không sinh code lan man quá giới hạn 128 tokens.

Hợp đồng:
- Request: `POST /ai/inline-complete`
  ```json
  {
    "prefix": "string (tối đa 20 dòng trước con trỏ)",
    "suffix": "string (tối đa 5 dòng sau con trỏ)",
    "engine": "postgres" | "mysql",
    "schemaSnippet": "string (danh sách tên bảng và cột chính)"
  }
  ```
- Response (HTTP 200):
  ```json
  {
    "completion": "string (đoạn mã SQL đề xuất)",
    "finishReason": "stop" | "length"
  }
  ```
- Response (HTTP 403):
  ```json
  {
    "error": "vip_required",
    "message": "Tính năng AI Copilot yêu cầu tài khoản VIP"
  }
  ```

Tiêu chí xong:
- AC1: Endpoint được bảo vệ bằng middleware `RequireVip()`. Nếu request không có token hợp lệ hoặc tài khoản không phải VIP, trả về HTTP 403 `vip_required`.
- AC2: Thuật toán nén Prompt tại Go:
  - System prompt súc tích (< 100 tokens), đóng vai trò SQL Autocomplete Engine.
  - Ngăn chặn triệt để prompt injection: Không thực thi chỉ dẫn ngoài phạm vi SQL completion.
  - Thiết lập `max_tokens = 128`, `temperature = 0.1`, `stop_sequences = [";\n", "\n\n\n"]`.
- AC3: Tích hợp với model `qwen/qwen3.8-27b` qua Groq SDK / HTTP client:
  - Tốc độ hoàn thành phản hồi < 400ms (First token đạt ngưỡng 0.19s).
  - Bóc tách làm sạch kết quả: Chỉ trả về chuỗi SQL thô, loại bỏ các ký tự Markdown ```sql hoặc lời giải thích dư thừa.
- AC4: Bộ đệm chống spam (Rate limit / Debounce per user) tại Redis: Giới hạn tối đa 30 requests/phút đối với tài khoản VIP để chống lạm dụng tự động.
- AC5: Đầy đủ Unit test Go cho endpoint, mock HTTP Groq và kiểm tra logic bóc tách mã đạt 100%.

Ca biên: Prefix rỗng; prefix kết thúc bằng dấu chấm phẩy (đã xong câu, không cần sinh thêm); model Groq bị timeout hoặc lỗi 429 (fallback an toàn trả về chuỗi rỗng thay vì làm crash editor).
Kiểm tra: `cd api && go test ./internal/ai/...`.
Góc review thêm: Thời gian phản hồi mạng / Tính an toàn bảo vệ API VIP.
Đọc thêm: `_bmad-output/SPEC_SMART_EDITOR.md` mục 3 (STR079) & `MUC_TIEU_TRUOC_MAT.md` mục 7.

