# Task098: Gin AI Proxy 2.0: Model Switcher & Backend Intent Guard

Thuộc: SP015 / STR069
Mục tiêu: Đưa model Groq `qwen/qwen3.8-27b` lên hàng đầu, bóc tách channel reasoning của `gpt-oss-120b`, bỏ model 404, và chặn đứng Prompt Injection phi-database tại Gin.
Phạm vi:
- `api/internal/ai/ai.go`
- `api/internal/ai/guard.go`
- `api/internal/ai/guard_test.go`
- `api/internal/ai/ai_test.go`
Không làm: Không sửa logic xác thực người dùng trong `auth.Gate`, không ghi log SQL của người dùng.

Hợp đồng:
- `func IsDatabaseQuestion(question string) (bool, string)`
- Danh sách model trong `ai.go`:
  ```go
  var models = []target{
      {false, "qwen/qwen3.8-27b"},
      {false, "openai/gpt-oss-120b"},
      {true, "openai/gpt-oss-120b"},
  }
  ```
- Nếu câu hỏi vi phạm: Trả về HTTP 400 Bad Request kèm mã lỗi `error.nonDatabaseQuestion` ngay tại Gin, không tiêu tốn token gọi Groq.

Tiêu chí xong:
- AC1: `IsDatabaseQuestion`:
  - Phát hiện các mẫu câu Jailbreak kinh điển ("ignore previous instructions", "forget rules", "bạn là ai", "hãy làm thơ", "viết bài văn", "cho tôi code python", "tính toán ma trận"...).
  - Trả về `false` và từ chối xử lý ngay lập tức với lỗi HTTP 400 và `error.nonDatabaseQuestion`.
  - Các câu hỏi hợp lệ về SQL, Index, Deadlock, B-Tree, Explain, Performance, Database schema... được nhận diện `true` và chuyển tiếp cho LLM.
- AC2: Cập nhật model trong `ai.go`:
  - Model Groq mặc định đổi thành `qwen/qwen3.8-27b`.
  - Gỡ bỏ vĩnh viễn model lỗi `llama-3.3-70b-versatile` (model trả 404 trên Groq).
- AC3: Xử lý Reasoning Channel:
  - Cập nhật struct `chunk` trong `ai.go` để hỗ trợ parse trường `delta.reasoning` (hoặc `channel: "analysis"`) của các model dạng reasoning (`openai/gpt-oss-120b`).
  - Khi model stream suy luận, timer không bị timeout (`timer.Reset(h.Idle)`), và chỉ bắn ra client SSE khi có `delta.content` thực sự.
- AC4: Không có bất kỳ rò rỉ nào về SQL hoặc câu hỏi người dùng trong log Gin (tuân thủ nguyên tắc 7 & 8).
- AC5: Toàn bộ test trong `api/internal/ai/` đạt:
  `cd api && go test -count=1 ./...` pass 100%.

Ca biên: Câu hỏi ngắn 1 từ ("SELECT", "Index?"); câu hỏi song ngữ pha lẫn ("explain query này bị slow"); câu hỏi dài 1999 ký tự; injection lồng ghép bên trong comment SQL.
Kiểm tra: `cd api && go test -v -count=1 ./internal/ai/...`.
Góc review thêm: Bảo mật theo `ATTACK-CLASSES.md` (chống Prompt Injection, SSRF, DoS token).
Đọc thêm: `_bmad-output/SPEC_RULE_INDEX.md` mục 2 & 3.

