# Bàn giao Task095

Đã làm:
1. Bổ sung route `POST /ai/diagnose` trong Gin backend (`api/internal/ai/ai.go`):
   - Nằm cùng nhóm `/ai` sau middleware gate auth/quota (`quota.AIMessage`).
   - Định nghĩa `DiagnoseRequest` và parser `parseDiagnose` với đầy đủ ràng buộc validation:
     + Chặn payload > 64 KB (413 Payload Too Large).
     + Từ chối unknown fields (`dec.DisallowUnknownFields()`, 400 Bad Request).
     + `locale` chỉ nhận `"vi"` hoặc `"en"`.
     + `sql` và `error` không được rỗng và phải là UTF-8 hợp lệ.
     + `engine` chỉ chấp nhận `"postgres"` hoặc `"mysql"`.
     + `question` (optional) không quá 2000 runes.
2. System Prompt chuyên dụng cho Error Doctor:
   - Phân tích SQL và Error ngắn gọn, rõ ràng theo đúng `locale` chỉ định.
   - Cung cấp đoạn SQL sửa đề xuất trong fenced block ```sql ... ```.
   - Không bịa đặt số liệu hay thời gian chạy.
   - Streaming SSE (`data: ...\n\n`) tương thích với client.
   - Bảo mật (Nguyên tắc 7): Tuyệt đối không log SQL, câu hỏi hay error message ra stdout/stderr/file.
3. Unit test Go (`api/internal/ai/ai_test.go`):
   - 10 test suites bao quát 100% cho endpoint `/ai/diagnose`: stream SSE, system prompt tiếng Việt/tiếng Anh, nhận diện engine, 17 ca biên validation, fallback Groq -> OpenRouter, quota gate, không log secret, client disconnect cancel.

File chính:
- `api/internal/ai/ai.go`
- `api/internal/ai/ai_test.go`
- `_bmad-output/SP014/STR066/Task095/task095.md`

Kết quả kiểm tra:
- `cd api && go test -v ./...`: 100% packages pass (cmd/server, internal/ai, internal/auth, internal/httpapi, internal/mysql, internal/quota, internal/store).
