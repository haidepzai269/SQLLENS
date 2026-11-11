# Bàn giao Task098

Đã làm:
- Nâng cấp Gin AI Proxy 2.0 với danh sách model ưu tiên `qwen/qwen3.8-27b`, cấu hình fallback `openai/gpt-oss-120b`, và loại bỏ vĩnh viễn model lỗi 404 `llama-3.3-70b-versatile`.
- Bóc tách reasoning channel cho các model suy luận, reset idle timer tránh timeout ngầm và chỉ stream nội dung thật sự ra client SSE.
- Triển khai Backend Intent Guard `IsDatabaseQuestion` chặn đứng prompt injection, jailbreak và câu hỏi phi-database ngay tại Gin bằng mã lỗi `error.nonDatabaseQuestion`.
- Xử lý triệt để chuẩn hóa khoảng trắng/newline, bóc tách SQL comments và phân biệt vai trò kỹ thuật database của "act as" tránh false positive.
- Đồng bộ thông báo lỗi i18n song ngữ (vi/en) và cập nhật `ERROR_KEYS` trên giao diện `MentorPanel`.

File chính:
- `api/internal/ai/guard.go`: Hàm `IsDatabaseQuestion`, chuẩn hóa khoảng trắng và bộ lọc intent database.
- `api/internal/ai/guard_test.go`: Unit test kiểm thử toàn diện các tình huống hợp lệ, injection và ca biên.
- `api/internal/ai/ai.go`: Cập nhật cấu hình model switcher, xử lý reasoning channel và tích hợp guard vào `parse()`.
- `api/internal/ai/ai_test.go`: Bộ test mô phỏng model switcher, stream reasoning và từ chối prompt injection.
- `web/messages/vi/error.json` & `web/messages/en/error.json`: Bản dịch song ngữ cho mã lỗi `nonDatabaseQuestion`.
- `web/src/modules/mentor/ui/mentor-panel.tsx`: Bổ sung `nonDatabaseQuestion` vào danh sách khóa lỗi hợp lệ.

Kết quả kiểm tra:
- `cd api && go test -v -count=1 ./internal/ai/...`: 24 bài test PASS 100% trong 1.8s.
- `cd api && go test -count=1 ./...`: Toàn bộ test suite backend Go PASS 100%.
- `cd web && npm run check`: PASS 100% (check-i18n, eslint 0 lỗi, typecheck 0 lỗi, vitest 59 test files / 645 tests pass).
- Bảo mật: Không ghi bất kỳ log nào chứa SQL hay câu hỏi của người dùng (tuân thủ nguyên tắc 7 và 8).

Kết quả review:
- Đã sửa 3 lỗi do reviewer chỉ ra ở vòng 1: tinh chỉnh "act as" cho vai trò database, cho phép câu hỏi "ma trận tương thích khóa", chuẩn hóa khoảng trắng và bóc tách SQL comments.
- Reviewer độc lập thẩm định vòng 2 xác nhận PASS 100%, không còn mục needs_validation nào.

Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết:
- Gin AI Proxy đã sẵn sàng tiếp nhận requests với model Qwen 3.8 siêu tốc và bảo vệ bằng Intent Guard.
- Task097 (Evidence Compactor) và Task099/Task100 có thể an tâm sử dụng payload chuẩn qua Gin proxy.
