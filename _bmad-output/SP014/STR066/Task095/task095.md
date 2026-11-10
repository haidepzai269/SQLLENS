# Task095: Gin AI Error Diagnosis Endpoint & Testing

## Bối cảnh & Mục tiêu
Khi người dùng gặp các lỗi SQL phức tạp hoặc muốn hiểu sâu nguyên nhân kỹ thuật, họ có thể bấm nút "Hỏi AI Mentor về lỗi này" trên `SmartErrorCard`.
Task095 xây dựng endpoint chẩn đoán lỗi trong Gin backend (`api/internal/ai/`):
1. Bổ sung route `POST /ai/diagnose` (hoặc mở rộng `POST /ai/chat` nhận `mode: "diagnose"` / `evidence` chứa context lỗi SQL).
2. Xây dựng System Prompt chuyên biệt cho chẩn đoán lỗi:
   - Giải thích ngắn gọn, dễ hiểu nguyên nhân gốc rễ.
   - Luôn cung cấp đoạn SQL sửa đề xuất trong khối markdown ` ```sql ... ``` `.
   - Không bịa đặt số liệu (Nguyên tắc 1), không nói thiết kế ổn (Nguyên tắc 2).
   - Tuyệt đối không ghi log SQL hoặc câu hỏi/lỗi ra console hay file (Nguyên tắc 7).
3. Đảm bảo an toàn: Chạy sau middleware xác thực & quota (`a.Gate(quota.AIMessage)`).
4. Viết unit tests kiểm thử 100% trong `api/internal/ai/ai_test.go`.

## Tiêu chí chấp nhận (AC)
- **AC1 (Route & Request Payload):**
  - Hỗ trợ endpoint nhận request `{ question?: string, error: string, sql: string, engine: string, locale: string }` hoặc qua `POST /ai/chat` với `evidence` chứa `{ type: "sql_error", sql: "...", error: "...", engine: "..." }`.
  - Validate payload: locale chỉ nhận `"vi"` hoặc `"en"`, `sql` và `error` không được rỗng, kích thước tối đa 64 KB.
- **AC2 (Prompt chẩn đoán & SSE Stream):**
  - System prompt chuyên dụng cho Error Doctor:
    - Giải thích nguyên nhân gốc rễ bằng ngôn ngữ tự nhiên theo `locale`.
    - Cung cấp câu lệnh sửa mẫu trong khối ` ```sql ... ``` `.
  - Response stream SSE (`data: ...\n\n`) tương thích 100% với streaming client của frontend.
- **AC3 (Bảo mật & Không log):**
  - Không in SQL hoặc chuỗi lỗi ra stdout/stderr (Nguyên tắc 7).
  - Quota deduct 1 lượt AI message (`quota.AIMessage`).
- **AC4 (Kiểm tra bằng máy):**
  - Viết unit test Go trong `api/internal/ai/ai_test.go` bao quát endpoint chẩn đoán lỗi: request validation, stream response, locale check, quota gate.
  - `cd api && go test ./...` thoát 0.
