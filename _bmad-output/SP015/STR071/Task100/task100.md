# Task100: Giao diện minh bạch khi verify lỗi & Cầu nối sandbox MySQL

Thuộc: SP015 / STR071
Mục tiêu: Chấm dứt tình trạng câu trả lời bị cụt lủn khi khối SQL của AI bị lỗi verify; hiển thị cảnh báo minh bạch; kết nối xác thực SQL cho MySQL qua Sandbox Agent.
Phạm vi:
- `web/src/modules/mentor/verify/index.ts`
- `web/src/modules/mentor/ui/verified-block.tsx`
- `web/src/modules/mentor/ui/mentor-panel.tsx`
- `web/messages/vi/mentorVerify.json`, `web/messages/en/mentorVerify.json`
- `web/src/modules/mentor/verify/index.test.ts`
Không làm: Không bỏ qua bước kiểm tra an toàn; không tự ý thực thi các câu lệnh phá hoại (`DROP DATABASE`, `ALTER SYSTEM`).

Hợp đồng:
- `VerifiedPart` mở rộng:
  ```typescript
  export type VerifiedPart =
    | { kind: "text"; text: string }
    | { kind: "sql"; sql: string; outcome: Conclusion<Plan | TryChangeResult> }
    | { kind: "unverified"; sql: string; reasonKey: string };
  ```
  (Thay thế hoàn toàn loại `hidden` gây cụt lủn).

Tiêu chí xong:
- AC1: Khi một khối SQL do AI đề xuất không vượt qua kiểm thử trong database:
  - Khối SQL **vẫn được hiển thị** trong giao diện người dùng.
  - Được bao bọc bởi khung cảnh báo viền màu hổ phách (Amber/Yellow) với biểu tượng cảnh báo.
  - Hiển thị badge: *"Chưa qua kiểm thử sandbox: [Lý do ngắn gọn]"* (ví dụ: Lỗi cú pháp, Bảng hoặc cột không tồn tại, Quá thời gian timeout).
  - Không có nút "Áp dụng thử" đối với khối SQL unverified này.
- AC2: Khi khối SQL vượt qua kiểm thử:
  - Hiển thị khung viền xanh lục (Success) với nhãn `Thật`.
  - Hiển thị đầy đủ nút "Áp dụng thử" (What-if Compare) để người dùng so sánh Plan trước và sau.
- AC3: Với engine MySQL:
  - Thay vì tự động đánh dấu lỗi không mô phỏng (`if (adapter.engine !== "postgres") parts.push(hidden("notSimulated"))`), adapter MySQL nếu đang kết nối với Sandbox Agent sẽ gửi lệnh `EXPLAIN` chạy thử nghiệm an toàn (dry-run).
  - Nếu kết nối MySQL chưa sẵn sàng hoặc là tài khoản khách (chưa đăng nhập): Hiển thị khối SQL với badge `unverified` kèm lý do `"Cần kết nối MySQL sandbox để kiểm thử"`.
- AC4: Đầy đủ chuỗi dịch trong `mentorVerify.json` cho cả tiếng Việt và tiếng Anh.
- AC5: Đầy đủ Unit Test kiểm thử `VerifiedPart` mới trong `index.test.ts`, `npm run check` pass 100%.

Ca biên: AI đề xuất 3 khối SQL (1 đúng, 2 sai cú pháp); SQL chứa lệnh nguy hiểm bị từ chối; mạng chập chờn khi gọi sandbox MySQL.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/mentor/verify/index.test.ts`.
Góc review thêm: Trải nghiệm người dùng (UX) / Nguyên tắc minh bạch nhãn kết luận của SQLLens.
Đọc thêm: `_bmad-output/SPEC_RULE_INDEX.md` mục 2 & 3.

