# Task061: Màn hình AI Mentor

Thuộc: SP012 / STR056
Điều kiện bắt đầu: Task044, Task056, Task058, Task059, Task060 đã merge.
Mục tiêu: Người dùng hỏi về SQL của mình, thấy câu trả lời chạy dần, SQL đề xuất chỉ hiện sau khi chạy thử, bấm áp dụng thì sang màn hình so sánh.
Phạm vi: `web/src/modules/mentor/ui/**`, `web/src/app/[locale]/e2e-mentor/**`, `web/messages/{vi,en}/mentor.json`, `web/messages/{vi,en}/error.json`, `web/src/modules/auth/login-dialog.tsx`, `web/e2e/mentor.spec.ts`.
Thêm khóa `error.badRequest`, `error.aiUnavailable`, `error.aiTooLong` vào `web/messages/{vi,en}/error.json` vì Task058 đã trả các khóa này. Cổng đăng nhập cho AI: thêm lý do mới ở `LoginDialog`, hiện chỉ có `mysql` và `manual`.
Không làm: gắn vào vùng `stage` của màn hình chính (task riêng), AI Chaos Generator, lưu lịch sử hội thoại trên máy chủ.

Hợp đồng: `<MentorPanel adapter={...} evidence={EvidencePack} probe?={string} />`. Dùng cổng đăng nhập của Task044, `checkAnswer`, `verifyAnswer`, `WhatIfCompare`.

Tiêu chí xong (test dùng route giả cho `/api/ai/chat`, không gọi model thật):
- AC1: Chưa đăng nhập: được mời đăng nhập, quay lại không mất câu hỏi đang gõ, theo cách Task044 đã làm.
- AC2: Câu trả lời hiện dần theo `delta`. Khối SQL khi đang stream chỉ hiện là đang chờ kiểm tra, chưa hiện nội dung. Hết stream, chạy `verifyAnswer`, chỉ khối đạt mới hiện, kèm nhãn Thật và số trang. Khối `hidden` hiện lý do, không hiện SQL.
- AC3: `checkAnswer` báo `unknownNumbers` hoặc `bannedClaims` thì hiện cảnh báo rõ ngay tại câu trả lời, nói rằng số này không có trong bằng chứng.
- AC4: Bấm Áp dụng trên một đề xuất đạt: mở `WhatIfCompare` với SQL đó, không tự commit gì vào dữ liệu.
- AC5: Nội dung AI được hiển thị dạng văn bản: chuỗi `<img src=x onerror=...>` hay liên kết trong câu trả lời không chạy và không gọi mạng. Có test.
- AC6: Lỗi 401, 429 có `Retry-After`, 503, đứt giữa stream, sự kiện `error` đều có màn hình riêng, phần đã nhận ghi rõ là chưa hoàn tất. Nút dừng hủy được yêu cầu và cả bước chạy thử.
- AC7: `npm run check`, `npm run build` thoát 0, `web/e2e/mentor.spec.ts` đạt với `--workers=1`.

Giao diện: trạng thái trống, đang gửi, đang stream, đang chạy thử, lỗi. Luôn thấy câu cho biết AI chỉ nhận bằng chứng và câu trả lời có thể sai. Đủ tiếng Việt và tiếng Anh. Ở 390 px không cuộn ngang, ô nhập không bị bàn phím che. Có bàn phím, `aria-live` cho câu trả lời. Tự mở ảnh chụp 1440 và 390 ở cả hai ngôn ngữ để nhìn.
Ca biên: gửi hai câu liên tiếp, câu cũ không ghi đè câu mới; câu trả lời rỗng; tải lại trang giữa chừng; câu hỏi trên 2.000 ký tự.
Kiểm tra: `cd web && npm run check`; `E2E_PORT=3161 npx playwright test e2e/mentor.spec.ts --workers=1`.
Góc review thêm: bảo mật (XSS, nội dung AI không đáng tin), giao diện, nhãn kết luận.
Đọc thêm: các file bàn giao của Task044, Task056, Task058, Task059, Task060; `CLAUDE.md` nguyên tắc 2 và 6.
