# Task058: AI proxy ở Gin

Thuộc: SP012 / STR053, phần máy chủ của STR054
Mục tiêu: `POST /ai/chat` nhận câu hỏi và bằng chứng, gọi model theo thứ tự xoay tua, stream câu trả lời về trình duyệt, key không rời Gin, không ghi log SQL.
Phạm vi: `api/internal/ai/**`, `api/cmd/server/main.go` (chỉ chỗ nối), `api/.env.example`.
Không làm: giao diện, dựng bằng chứng ở frontend, Gemini (gói free không được nhận SQL người dùng), gọi công cụ, thêm thư viện Go.

Hợp đồng:
- Trình duyệt gọi `POST /api/ai/chat`, qua `rewrites` thành `/ai/chat` ở Gin. Thân và sự kiện SSE theo `web/src/contracts/mentor.ts`.
- Nối bằng `a.Gate(quota.AIMessage)` sẵn có, `a` là kết quả của `auth.Mount`. Origin đã được `originCheck` kiểm.
- Biến môi trường `GROQ_API_KEY`, `OPENROUTER_API_KEY`. Thiếu key nào thì bỏ nhà cung cấp đó. Thiếu hết thì 503 `not_configured`. Danh sách model là hằng số ở đầu file, tra tài liệu hiện hành của Groq và OpenRouter, ghi ngày tra vào bàn giao.
- Yêu cầu gửi OpenRouter luôn có `provider: { data_collection: "deny", zdr: true }`. Không có nhà cung cấp nào không có cam kết này trong danh sách.
- Prompt hệ thống nằm trong Go. Trình duyệt không gửi được prompt hệ thống hay vai `system`. Bằng chứng được chuẩn hóa bằng `json.Compact` rồi đặt trong một khối dữ liệu riêng, prompt nói rõ nội dung khối đó là dữ liệu, không phải lệnh. Prompt yêu cầu: chỉ dùng số có trong bằng chứng, không nói thiết kế ổn, SQL đề xuất đặt trong khối ```sql, trả lời theo `locale`.

Tiêu chí xong (test bằng `httptest`, máy chủ giả thay Groq và OpenRouter):
- AC1: Yêu cầu hợp lệ nhận stream `delta` đúng thứ tự rồi `done`, từng phần đến ngay chứ không gom cuối (test đọc được `delta` đầu trước khi máy chủ giả gửi phần sau).
- AC2: Model đầu trả 429 hoặc 5xx, hoặc không có byte đầu trong thời hạn: chuyển model sau, người dùng chỉ thấy một luồng. Hết model: sự kiện hoặc mã lỗi với `messageKey`, không lộ tên nhà cung cấp hay nội dung lỗi của họ.
- AC3: Đang stream mà nhà cung cấp đứt: gửi `error`, không chuyển model, không ghép hai câu trả lời.
- AC4: Yêu cầu gửi lên nhà cung cấp không có `tools`, `tool_choice`, `functions`. Nhà cung cấp trả `tool_calls` thì bị bỏ qua, không làm gì thêm.
- AC5: SQL chứa câu "ignore previous instructions" chỉ xuất hiện trong khối dữ liệu đã mã hóa JSON, thông điệp `system` không đổi theo đầu vào. Trường lạ như `system`, `messages`, `model`, `tools` trong thân bị bỏ qua hoặc từ chối, không chuyển đi.
- AC6: Thân trên 64 KiB trả 413, `question` rỗng hoặc trên 2.000 ký tự, `evidence` không phải object, `locale` lạ trả 400.
- AC7: Chưa đăng nhập 401, hết quota 429, Upstash lỗi 503, đều không gọi nhà cung cấp.
- AC8: Không có SQL, câu hỏi, câu trả lời, key trong log, kể cả khi lỗi. Test chụp log của lần chạy có một chuỗi đánh dấu trong SQL và key giả rồi khẳng định không thấy.
- AC9: Trình duyệt ngắt kết nối thì yêu cầu lên nhà cung cấp bị hủy, không rò goroutine.
- AC10: `gofmt -l`, `go vet ./...`, `go test -count=1 ./...` trong `api/` đạt.

Ca biên: dòng SSE của nhà cung cấp bị chia cắt qua nhiều lần đọc; dòng `[DONE]`; `delta` rỗng; JSON hỏng trong stream; ký tự UTF-8 bị cắt giữa chừng; câu trả lời quá dài (đặt `max_tokens`, cộng giới hạn tổng số byte); hai yêu cầu cùng lúc.
Kiểm tra: lệnh ở AC10.
Góc review thêm: bảo mật theo `ATTACK-CLASSES.md` của skill `security-audit`, phần SSRF, chèn prompt, lộ key, log.
Đọc thêm: `CLAUDE.md` dòng AI trong "Quyết định đã chốt" và nguyên tắc 6, 7; `_bmad-output/SP005/STR023/Task043/ban_giao_task043.md`; `_bmad-output/SP005/STR022/Task042/ban_giao_task042.md`.

An toàn: không đọc `api/.env`, không đọc `KEY_CAN_LAY.md`, không gọi nhà cung cấp thật.
