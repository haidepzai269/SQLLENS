# Task020: Phòng thử trên màn hình chính

Thuộc: SP003 / STR012
Điều kiện bắt đầu: Task019 và Task022 đã merge.
Mục tiêu: Màn hình chính `/[locale]` thành nơi làm việc thật: dán SQL ở cột trái, chạy, xem kết quả ở panel terminal, xem kết luận ở cột phải. Thay trang `/lab` riêng lẻ.
Phạm vi: `web/src/app/[locale]/page.tsx`, `web/src/app/[locale]/lab/**`, `web/src/modules/lab/**`, `web/messages/*/lab.json`, `web/e2e/lab.spec.ts`.
Không làm: sửa `web/src/engines/postgres/worker.ts` (Task021 đang sửa), CodeMirror (SP006), sinh dữ liệu (Task024), MySQL.

Hợp đồng:
- `/[locale]` dùng `WorkspaceLayout` với bốn vùng: `sql` là ô nhập SQL (tạm dùng `textarea` của shadcn/ui) và nút Chạy; `terminal` là `ResultGrid` hoặc `SqlErrorView` của Task022 cộng nhật ký chạy; `findings` là kết luận gắn nhãn; `stage` giữ chỗ như hiện tại.
- `/[locale]/lab` chuyển hướng về `/[locale]` và giữ query.
- Trạng thái phiên (SQL đang soạn, adapter, kết quả) nằm trên cấp `WorkspaceLayout`, để đổi qua lại mốc 900 px không mất dữ liệu. Đây là phát sinh của Task006.
- Tab engine ở thanh trên: chọn PostgreSQL thì dùng adapter này. Chọn MySQL thì vùng `terminal` báo "MySQL cần đăng nhập, sẽ có ở SP004", không gọi gì.
- Nhật ký chạy chỉ ghi loại sự kiện và số liệu (đã tải, đã chạy N câu, lỗi ở câu N). Không ghi nội dung SQL vào `console` hay bất kỳ log nào.

Tiêu chí xong:
- AC1: Mở `/vi` không tải WASM. Bấm Chạy lần đầu: vùng `terminal` hiện thanh tiến trình theo `onProgress` của Task019, có số MB đã tải nếu có.
- AC2: Tải thất bại: hiện lỗi kèm nút Thử lại, bấm thì tải lại được.
- AC3: Chạy câu của AC1 Task011: `terminal` hiện bảng 2 dòng, `findings` hiện kết luận nhãn Thật đúng câu chữ Task011.
- AC4: Câu chạy lâu: có nút Hủy. Bấm Hủy hoặc gặp timeout thì báo rõ dữ liệu đã mất, kèm nút Dựng lại để chạy lại các câu thành công trước đó.
- AC5: Thu nhỏ cửa sổ qua mốc 900 px rồi phóng lại: SQL đang soạn và kết quả vẫn còn.
- AC6: Không có câu nào hàm ý "thiết kế ổn".
- AC7: `/vi/lab?x=1` chuyển về `/vi?x=1`.
- AC8: Playwright: sửa `lab.spec.ts` sang `/[locale]`, phủ AC1 đến AC5 ở `vi` và `en`, lọc phần tử đang hiển thị. Chụp ảnh 390 px và 1440 px ở hai ngôn ngữ, lưu vào thư mục task.
- AC9: `npm run check`, `npm run build`, `npx playwright test` đều đạt.

Ca biên: bấm Chạy liên tục nhiều lần không tạo nhiều adapter; SQL trống thì nút Chạy bị vô hiệu.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: giao diện, nhãn kết luận, không ghi log SQL.
Đọc thêm: `EXPERIENCE.md`; bàn giao Task006, Task011, Task019, Task022.
