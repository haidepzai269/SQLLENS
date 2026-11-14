# Task120: Upfront Evidence Injection, System Prompt Engineering & Live Review Verification

Thuộc: SP018 / STR087
Mục tiêu: Mở rộng Gin Backend API tiếp nhận trường `evidence_plan`, tinh chỉnh System Prompt của AI Mentor với cơ chế phân nhánh ngữ cảnh tự động, và **thực thi quy trình kiểm thử thật (Live Model Testing) trong khâu nghiệm thu của Agent Reviewer**.

Phạm vi:
- `api/internal/ai/prompt.go` (hoặc tập tin cấu hình system prompt trong `api/`)
- `api/internal/ai/handler.go` (payload schema `POST /ai/chat` và `POST /ai/diagnose`)
- `web/src/modules/mentor/api/chat.ts` (truyền `evidence_plan` từ client lên backend)
- `api/internal/ai/prompt_test.go` (unit test kiểm tra formatting)
- `web/src/modules/mentor/verify/live-plan-evidence.test.ts` (test script chạy thật với model AI)

Không làm:
- Không sửa frontend UI component (Pill và Chips nằm ở Task121).
- Không cấp quyền Tool Calling cho AI theo đúng Nguyên tắc cốt lõi số 6.

Hợp đồng:
- Request Payload:
  ```json
  {
    "message": "string",
    "active_sql": "string",
    "evidence_plan": "string (tùy chọn, chuỗi nén 40 tokens)",
    "engine": "postgres | mysql",
    "locale": "vi | en"
  }
  ```
- System Prompt bổ sung thẻ:
  ```markdown
  <QUERY_PLAN_EVIDENCE>
  {{.EvidencePlan}}
  </QUERY_PLAN_EVIDENCE>
  
  QUY TẮC XỬ LÝ KẾ HOẠCH THỰC THI (QUERY PLAN):
  - Thẻ <QUERY_PLAN_EVIDENCE> là số liệu đo đạc THẬT từ sandbox của người dùng.
  - NẾU người dùng hỏi về hiệu năng, tốc độ, tối ưu hóa, chỉ mục (index), cách database xử lý hoặc chi phí I/O:
    BẮT BUỘC sử dụng số liệu trong thẻ này làm BẰNG CHỨNG THỰC TẾ (Nhãn THẬT) để giải thích cặn kẽ nguyên nhân.
  - NẾU người dùng chỉ hỏi về cú pháp SQL, chào hỏi, hoặc hỏi khái niệm lý thuyết không liên quan đến hiệu năng:
    HÃY BỎ QUA hoàn toàn thẻ <QUERY_PLAN_EVIDENCE> và trả lời trực tiếp câu hỏi, không lan man.
  ```

Tiêu chí xong:
- AC1: API Gin tiếp nhận `evidence_plan` an toàn, validate độ dài tối đa không quá 200 ký tự (chống payload phình to bất thường).
- AC2: System Prompt tiêm chính xác khối `<QUERY_PLAN_EVIDENCE>` vào ngữ cảnh trước khi gọi Groq API (Qwen 3.8-27B / DeepSeek V3).
- AC3: Phân nhánh thông minh: Nếu `evidence_plan` rỗng, prompt tự động lược bỏ khối thẻ này, không để lại placeholder thừa.
- AC4: Client API (`chat.ts`) gửi kèm `evidence_plan` lấy từ hook `useActiveQueryPlan` khi gửi request.
- **AC5 (QUY TRÌNH REVIEW BẮT BUỘC TỪ CHỦ DỰ ÁN - LIVE AGENT VERIFICATION):**
  Khi Amelia hoàn thành code, **Agent Reviewer độc lập bắt buộc phải chạy thử thật (Live Model Call)** kiểm chứng phản hồi thực tế của AI Mentor với 2 kịch bản:
  - *Kịch bản 1 (Hỏi hiệu năng):* Query `SELECT * FROM users WHERE age > 20` có index nhưng bảng chỉ có 5 dòng -> Evidence: `[PLAN_EVIDENCE: Seq Scan on users | Actual Rows: 5 | Buffers: 3 hit]`.
    *Kỳ vọng:* AI Mentor phải chỉ rõ: CSDL chọn `Seq Scan` và đọc 3 buffers vì bảng quá nhỏ (5 dòng), việc không dùng Index là tối ưu chứ không phải lỗi.
  - *Kịch bản 2 (Hỏi lý thuyết/cú pháp):* User hỏi *"Lệnh SELECT này nghĩa là gì?"* kèm cùng evidence trên.
    *Kỳ vọng:* AI Mentor chỉ giải thích ý nghĩa câu lệnh, hoàn toàn bỏ qua không nhắc đến `Seq Scan` hay `Buffers`.
  - Reviewer chỉ ký duyệt PASS khi cả 2 kịch bản chạy thật đều đạt chuẩn độ chính xác và không bị ảo giác!

Ca biên: Payload `evidence_plan` chứa ký tự đặc biệt hoặc thẻ HTML; mất mạng khi stream SSE; user hỏi câu hỏi song ngữ (Anh lẫn Việt).
Kiểm tra: `npm run check`, `go test ./...` trong `api/` và test kịch bản chạy thật Live AI Verification.
Đọc thêm: `_bmad-output/SPEC_AI_PLAN_EVIDENCE.md` mục 4.3 & chỉ thị từ Chủ dự án.
