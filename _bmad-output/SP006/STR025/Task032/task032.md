# Task032: Đưa ô soạn SQL vào màn hình chính

Thuộc: SP006 / STR025
Điều kiện bắt đầu: Task024, Task028, Task029 đã merge.
Mục tiêu: Cột SQL dùng CodeMirror thật, báo lỗi đúng dòng ngay khi soạn, liệt kê câu đã tách, không bao giờ chặn việc chạy vì lỗi parse.
Phạm vi: `web/src/modules/lab/**`, `web/messages/*/lab.json`, `web/e2e/lab.spec.ts`.
Không làm: suy ra schema (Task033), sửa `sql-editor` hay `parser`.

Hợp đồng:
- `LabWorkspace` vẫn giữ trạng thái `sql`, nên đổi qua mốc 900 px không mất dữ liệu.
- Parse theo debounce 300 ms. Kết quả parse cũ không được đè kết quả mới.
- Vùng rỗng theo `EXPERIENCE.md`: "Dán SQL để bắt đầu" kèm nút nạp câu mẫu.

Tiêu chí xong:
- AC1: Gõ `SELEC 1`: ô soạn tô đúng chữ lỗi, hiện thông báo. Sửa xong thì hết.
- AC2: Lỗi parse không vô hiệu nút Chạy. Bấm Chạy với câu parser không đọc được thì vẫn gửi cho engine, và lỗi thật của engine vẫn hiện.
- AC3: Dán 3 câu: danh sách câu hiện đúng 3 dòng với loại câu. Dòng đang chọn có đường `lamp`, theo `EXPERIENCE.md`.
- AC4: Lỗi khi chạy từ engine có `position`: tô đúng chỗ trong ô soạn, không lệch khi có nhiều câu.
- AC5: Parser không tải được: chỉ mất phần báo lỗi khi soạn, vẫn chạy được, có một dòng báo rõ.
- AC6: Đổi engine giữ nguyên SQL và đổi dialect. Nạp câu mẫu khi ô đã có chữ thì không xóa ngầm SQL đang soạn.
- AC7: Các test hiện có trong `lab.spec.ts` chỉ sửa cách điền SQL, không bỏ tiêu chí nào. Chạy ở `vi` và `en`, chụp ảnh 390 px và 1440 px lưu vào thư mục task.
- AC8: `npm run check`, `npm run build`, `npx playwright test` đều đạt.

Ca biên: bấm Chạy liên tục không tạo thêm adapter; nội dung SQL không xuất hiện trong `console` hay nhật ký.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: giao diện, chạy thử thật, không ghi log SQL.
Đọc thêm: bàn giao Task020, Task024, Task028, Task029; `EXPERIENCE.md` mục 2.
