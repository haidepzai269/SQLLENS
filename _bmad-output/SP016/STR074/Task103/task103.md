# Task103: Sửa lỗi nút Hỏi AI Mentor tại Terminal, Stream SSE chẩn đoán và 1-Click Fix

Thuộc: SP016 / STR074
Mục tiêu: Khắc phục triệt để sự cố nút "Hỏi AI Mentor về lỗi này" tại Terminal không phản hồi; xây dựng client API SSE kết nối tới `POST /ai/diagnose` tại Gin; hiển thị khối AI Doctor Card ngay dưới thông báo lỗi kèm nút "Áp dụng sửa ngay (1-Click Fix)".

Phạm vi:
- `web/src/modules/mentor/api/diagnose.ts`
- `web/src/components/result-grid/sql-error-view.tsx`
- `web/src/components/result-grid/sql-error-view.test.tsx`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/messages/vi/error.json`, `web/messages/en/error.json`
- `web/messages/vi/result.json`, `web/messages/en/result.json`

Không làm: Không sửa logic backend Gin (Task095 đã có sẵn endpoint `/ai/diagnose`); không lưu trữ nội dung SQL của người dùng theo Nguyên tắc cốt lõi 7; không làm gián đoạn các bộ nút Quick-Fix có sẵn.

Hợp đồng:
- `diagnoseSqlError({ sql, error, engine, locale, question, onDelta, onComplete, onError }): () => void`: Hàm client gọi SSE stream tới `/api/ai/diagnose` (hoặc `/ai/diagnose`), trả về hàm abort hủy request.
- `SqlErrorView`: Nhận thêm prop `onApplyFix?: (fixedSql: string) => void` và đảm bảo prop `onAskAi?: (remediation: string) => void` được truyền đầy đủ từ `lab-workspace.tsx`.

Tiêu chí xong:
- AC1: Tại `lab-workspace.tsx`, thẻ `<SqlErrorView />` được truyền đầy đủ prop `onAskAi` và `onApplyFix`.
- AC2: Khi click nút "Hỏi AI Mentor về lỗi này" (test id `ask-ai-button`):
  - Nút chuyển trạng thái loading spinner mượt mà, vô hiệu hóa để chặn double-click.
  - Gọi stream SSE tới endpoint `/ai/diagnose` với đầy đủ payload câu lệnh lỗi, nội dung lỗi, engine và ngôn ngữ.
- AC3: Phía dưới thẻ lỗi mở rộng khối **AI Doctor Card**:
  - Render nội dung chẩn đoán theo thời gian thực (realtime delta stream) kèm phân tích nguyên nhân gốc rễ.
  - Tự động bóc tách khối mã ```sql ... ``` đề xuất sửa chữa.
- AC4: Nút hành động **"Áp dụng sửa ngay" (1-Click Fix)**:
  - Khi click, gọi `onApplyFix(suggestedSql)` để thay thế câu lệnh lỗi trong SQL Editor và đóng thẻ chẩn đoán hoặc chuyển badge sang "Đã áp dụng".
- AC5: Xử lý lỗi kết nối hoặc hết quota hiển thị thông báo lỗi rõ ràng kèm nút "Thử lại".
- AC6: Bản dịch song ngữ đầy đủ cho `vi` và `en` trong `error.json` và `result.json`.
- AC7: Unit test kiểm thử hành vi mở chẩn đoán, stream dữ liệu và click 1-Click Fix đạt 100%.

Ca biên: Lỗi mất mạng khi đang stream; AI không trả về khối ```sql; người dùng bấm nút Hủy giữa chừng.
Kiểm tra: `npm run check` và `npx vitest run web/src/components/result-grid/sql-error-view.test.tsx`.
Góc review thêm: Trải nghiệm người dùng khi lỗi (không che khuất thông tin lỗi cũ) / Tính an toàn khi thay thế mã SQL.
Đọc thêm: `_bmad-output/SPEC_SMART_EDITOR.md` mục 3 (STR074) & `MUC_TIEU_TRUOC_MAT.md` mục 1.

