# Task112: Tích hợp AI Copilot Multi-line Ghost Text vào CodeMirror 6: Smart trigger (Comment / Debounce 600ms / Ctrl+Space)

Thuộc: SP016 / STR079
Mục tiêu: Xây dựng extension AI Copilot cho CodeMirror 6 dành riêng cho tài khoản VIP; kích hoạt thông minh (Smart Trigger) khi gõ comment ý đồ, dừng gõ quá 600ms hoặc bấm `Ctrl+Space`; hiển thị gợi ý đa dòng (Multi-line Ghost Text) mượt mà; hỗ trợ phím `Tab` để nhận và popover mời nâng cấp tinh tế cho người dùng Free.

Phạm vi:
- `web/src/components/sql-editor/extensions/ai-copilot.ts`
- `web/src/components/sql-editor/extensions/ai-copilot.test.ts`
- `web/src/components/sql-editor/sql-editor-impl.tsx`
- `web/src/modules/vip/upgrade-modal.tsx`
- `web/src/modules/vip/api/copilot-client.ts`

Không làm: Không kích hoạt AI liên tục khi đang gõ chữ dở dang (gây tốn token và lag); không chặn luồng gõ của người dùng khi request AI đang chạy trong nền; không bắt buộc người dùng Free phải thấy popover liên tục.

Hợp đồng:
- `createAiCopilotExtension({ enabled, isVip, engine, onRequireUpgrade }): Extension`: Tạo extension AI Copilot cho CodeMirror 6.
- Trigger Conditions:
  1. **Comment Trigger:** Dòng vừa gõ bắt đầu bằng `-- ` và kết thúc bằng phím `Enter` (xuống dòng mới).
  2. **Debounce Trigger:** Dừng gõ phím quá **600ms** tại cuối một câu truy vấn chưa hoàn thành.
  3. **Manual Trigger:** Nhấn tổ hợp phím `Ctrl + Space` (hoặc `Cmd + I`).

Tiêu chí xong:
- AC1: Mặc định trong Cài đặt, `aiCopilotEnabled === false` (TẮT). Chỉ kích hoạt khi bật VÀ tài khoản có quyền VIP (`isVip === true`).
- AC2: Khi người dùng Free nhấn phím tắt `Ctrl + Space` để gọi Copilot:
  - Hiển thị popover gợi ý nhỏ gọn tinh tế ngay dưới con trỏ: *"AI Copilot là đặc quyền dành riêng cho VIP. [Nâng cấp ngay]"*.
  - Bấm vào mở `UpgradeModal`.
- AC3: Đối với tài khoản VIP:
  - Khi thỏa mãn điều kiện trigger, gọi API client `POST /ai/inline-complete` với 20 dòng mã gần nhất.
  - Hiển thị khối mã gợi ý nhiều dòng (Multi-line Ghost Text) màu xám mờ nối tiếp con trỏ.
- AC4: Xử lý phím tắt:
  - Phím `Tab`: Chấp nhận (Accept) toàn bộ khối mã gợi ý, đưa con trỏ về cuối khối mã vừa chèn.
  - Phím `Escape`: Hủy bỏ (Dismiss) khối gợi ý.
  - Tiếp tục gõ ký tự bất kỳ: Tự động hủy gợi ý AI cũ để tránh xung đột mã.
- AC5: Đảm bảo không nghẽn giao diện (Non-blocking): Quá trình gọi AI diễn ra hoàn toàn bất đồng bộ trong background. Nếu người dùng tiếp tục gõ khi request chưa về, tự động hủy bỏ (abort) request đó.
- AC6: Unit test và Interaction test cho extension AI Copilot đạt 100%.

Ca biên: Mất mạng khi đang gọi AI; token VIP hết hạn giữa phiên làm việc; gợi ý AI trả về chuỗi rỗng; file SQL có hơn 1.000 dòng (chỉ cắt đúng lát cắt 20 dòng quanh con trỏ).
Kiểm tra: `npm run check` và `npx vitest run web/src/components/sql-editor/extensions/ai-copilot.test.ts`.
Góc review thêm: Trải nghiệm không giật lag / Độ chuẩn xác khi chèn khối multi-line.
Đọc thêm: `_bmad-output/SPEC_SMART_EDITOR.md` mục 3 (STR079) & `MUC_TIEU_TRUOC_MAT.md` mục 7.

