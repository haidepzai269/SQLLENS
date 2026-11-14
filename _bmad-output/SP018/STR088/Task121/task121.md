# Task121: UI Smart Controls, Action Chips & Rào Chắn MySQL Sandbox

Thuộc: SP018 / STR088
Mục tiêu: Xây dựng giao diện hiển thị trạng thái bằng chứng Plan (`PlanEvidencePill`), cụm 3 nút bấm gợi ý thông minh (`QuickActionChips`) trong khung chat AI Mentor, và thiết lập rào chắn Engine Guard tuyệt đối ngăn chặn trigger EXPLAIN tự động ngầm trên MySQL Sandbox.

Phạm vi:
- `web/src/components/mentor/plan-evidence-pill.tsx`
- `web/src/components/mentor/plan-evidence-pill.test.tsx`
- `web/src/components/mentor/quick-action-chips.tsx`
- `web/src/components/mentor/quick-action-chips.test.tsx`
- `web/src/components/mentor/chat-drawer.tsx`
- `web/src/engines/mysql/guard.ts`
- `web/messages/vi/mentor.json`, `web/messages/en/mentor.json`

Không làm:
- Không sửa logic nén Plan (đã có ở Task119).
- Không sửa backend Prompt (đã có ở Task120).

Hợp đồng:
- `<PlanEvidencePill isAttached={boolean} isMeasuring={boolean} onToggle={(enabled) => void} engine={"postgres"|"mysql"} />`
- `<QuickActionChips onTrigger={(prompt: string) => void} isPlanReady={boolean} />`
- `canRunExplain(engine: EngineType, isExplicitUserAction: boolean): boolean`: Trả về false nếu engine là MySQL và `isExplicitUserAction` là false.

Tiêu chí xong:
- AC1: Linh kiện `PlanEvidencePill` xuất hiện thanh lịch góc trên ô soạn thảo chat của AI Mentor:
  - Khi engine là PostgreSQL và có câu SQL hợp lệ: sáng đèn xanh ngọc `⚡ Kèm Plan (~40 tokens)`.
  - Có thể click để tắt (chuyển sang màu xám mờ `Plan: Tắt`), trạng thái lưu vào `localStorage`.
  - Khi đang đo đạc trong Web Worker (3-5ms): hiển thị icon spinner nhẹ `Đang đo lường...`.
- AC2: Cụm 3 nút bấm **Quick-Action Chips** xuất hiện khi câu query trong editor có dấu hiệu quét lớn hoặc vừa chạy xong:
  - Chip 1: `[⚡ Vì sao câu này chạy chậm?]`
  - Chip 2: `[🔍 Optimizer có dùng Index không?]`
  - Chip 3: `[📊 Đọc bao nhiêu trang bộ nhớ?]`
  Khi click vào bất kỳ chip nào, câu hỏi lập tức được gửi vào khung chat kèm `evidence_plan` tự động.
- AC3: **Rào Chắn MySQL Engine Guard:**
  - Nếu engine hiện tại là `MySQL`, badge hiển thị: `[MySQL: Bấm nút để phân tích]`.
  - Tuyệt đối KHÔNG tự động gửi lệnh `EXPLAIN` ngầm lên Azure VM Docker container khi người dùng chat tự do.
  - Chỉ gửi lệnh EXPLAIN lên MySQL Sandbox Agent khi người dùng bấm trực tiếp vào một trong các Quick-Action Chips hoặc nút phân tích tường minh.
- AC4: Đầy đủ bản dịch song ngữ `vi` và `en` trong `mentor.json`, không hardcode chuỗi hiển thị.
- AC5: Đảm bảo responsive trên cả giao diện Desktop và Mobile (Drawer co giãn mượt mà, không bị tràn thanh công cụ).
- AC6: Unit test cho `PlanEvidencePill`, `QuickActionChips` và `canRunExplain` đạt 100% PASS.

Ca biên: Người dùng chuyển đổi qua lại liên tục giữa PostgreSQL và MySQL; click spam liên tục vào chips khi request trước chưa stream xong; toggle tắt bật Pill liên tục.
Kiểm tra: `npm run check` và `npx vitest run web/src/components/mentor/plan-evidence-pill.test.tsx web/src/components/mentor/quick-action-chips.test.tsx`.
Đọc thêm: `_bmad-output/SPEC_AI_PLAN_EVIDENCE.md` mục 4.4 và 4.5.
