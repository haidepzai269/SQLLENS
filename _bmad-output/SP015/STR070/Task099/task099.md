# Task099: Quản lý ngữ cảnh hội thoại đa lượt & Rolling Summary

Thuộc: SP015 / STR070
Mục tiêu: Nâng cấp `MentorPanel` hỗ trợ trao đổi đa lượt (Thread view), tóm tắt Rolling Summary 2-3 lượt trước để AI hiểu câu hỏi nối tiếp của người dùng.
Phạm vi:
- `web/src/contracts/mentor.ts`
- `web/src/modules/mentor/ui/mentor-panel.tsx`
- `web/src/modules/mentor/ui/conversation-thread.tsx`
- `web/messages/vi/mentor.json`, `web/messages/en/mentor.json`
- `web/src/modules/mentor/ui/mentor-panel.test.tsx` (hoặc e2e harness liên quan)
Không làm: Không lưu lịch sử vào database Neon (giữ hoàn toàn ở client state/sessionStorage), không cho phép thread kéo dài quá 5 lượt (để kiểm soát token).

Hợp đồng:
- `type ConversationTurn = { id: number; question: string; answerText: string; verified?: VerifiedAnswer; timestamp: number };`
- `MentorRequest` mở rộng:
  ```typescript
  export type MentorRequest = {
    question: string;
    evidence: EvidencePack;
    locale: "vi" | "en";
    contextSummary?: string; // Tóm tắt 1-2 dòng của các câu hỏi trước
  };
  ```

Tiêu chí xong:
- AC1: `MentorPanel` hiển thị danh sách các lượt hỏi đáp trong phiên thành luồng hội thoại liên tục (Thread view), người dùng có thể cuộn lên xem lại câu hỏi và câu trả lời trước đó.
- AC2: Khi người dùng gõ câu hỏi thứ 2 trở đi, frontend tự động trích xuất kết luận của câu hỏi liền trước thành một đoạn tóm tắt ngắn (`contextSummary`), đính kèm vào `MentorRequest`.
- AC3: Trong System Prompt tại Gin hoặc User Prompt, `contextSummary` được định dạng rõ:
  `CONVERSATION CONTEXT: Người dùng trước đó đã hỏi về ... và AI đã giải thích ...`
  Giúp AI hiểu ngay các đại từ thay thế (*"nó"*, *"bảng này"*, *"cột đó"*).
- AC4: Có nút "Hội thoại mới" (New Chat / Reset) để xóa sạch luồng chat hiện tại và bắt đầu lại từ đầu khi người dùng đổi query khác.
- AC5: Đủ bản dịch trong `messages/vi/mentor.json` và `messages/en/mentor.json`.
- AC6: Responsive hoàn hảo trên cả desktop 1440px và mobile 390px.

Ca biên: Hỏi liên tục 5 câu; câu hỏi thứ 2 xóa trắng rồi gửi; đổi engine hoặc chạy lại query khác thì tự động reset thread.
Kiểm tra: `npm run check` trong `web/`.
Góc review thêm: Trải nghiệm người dùng (UX) / Quản lý bộ nhớ client.
Đọc thêm: `_bmad-output/SPEC_RULE_INDEX.md` mục 3.

