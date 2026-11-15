# Bàn giao Task125

Đã làm: Hiện thực hóa hoàn chỉnh thanh tab `<TabBar />` đọc/ghi trực tiếp từ `useWorkspaceStore` với các tính năng: thêm tab mới ở cuối và tự động chọn tab (`+`), đóng tab có bảo vệ tab cuối cùng (`tab.lastTabLocked`) và tự động chuyển sang tab lân cận, nháy đúp đổi tên tại chỗ với phím Enter/Esc và chống tên rỗng, kéo thả sắp xếp thứ tự tab với HTML5 Drag & Drop và lưu vị trí `position` 0..n-1, hỗ trợ cuộn ngang mượt mà cho 100 tab mà không mount editor, hỗ trợ đầy đủ song ngữ vi/en và co giãn an toàn trên màn hình nhỏ 390px.
File chính:
- `web/src/modules/workspace/components/tab-bar.tsx`
- `web/src/modules/workspace/components/tab-bar.test.tsx`
- `web/messages/vi/workspace.json`
- `web/messages/en/workspace.json`
Kết quả kiểm tra:
- `npx vitest run src/modules/workspace/components/tab-bar.test.tsx`: 10/10 tests PASS (bao phủ 100% AC1 đến AC6 cùng các ca biên 20 tabs, tên 80 ký tự, Unicode, kéo thả cùng chỗ và kéo ra ngoài).
- `npm run check:i18n`: PASS 100% (không thiếu key, không rỗng, không lệch biến).
- `npm run check`: PASS 100% (i18n PASS, eslint 0 error, tsc typecheck PASS, 88 test files / 991 tests PASS).
Kết quả review: 0 lỗi từ reviewer độc lập (đạt chuẩn 100% AC1–AC6, PASS ngay vòng đầu).
Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết: Component `<TabBar />` đã sẵn sàng và export độc lập tại `@/modules/workspace/components/tab-bar`; Task 126 có thể tích hợp trực tiếp `<TabBar />` vào `lab-workspace.tsx` và xây dựng runtime chuyển tab CodeMirror không dựng lại sandbox.
