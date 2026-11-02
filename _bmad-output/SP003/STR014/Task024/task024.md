# Task024: Giao diện sinh dữ liệu

Thuộc: SP003 / STR014
Điều kiện bắt đầu: Task020, Task021 và Task023 đã merge.
Mục tiêu: Sau khi tạo bảng, người dùng chọn số dòng, chỉnh độ lệch của cột, rồi sinh dữ liệu có tiến trình và hủy được.
Phạm vi: `web/src/modules/data-lab/ui/**`, `web/src/modules/lab/**` (chỉ thêm chỗ gắn nút mở `data-lab`), `web/messages/*/data-lab.json`, `web/e2e/data-lab.spec.ts`.
Không làm: sửa lõi sinh dữ liệu (Task023), sửa engine.

Hợp đồng:
- Nút "Sinh dữ liệu" ở vùng `sql`, bật khi có ít nhất một bảng. Mở một `Dialog` của shadcn/ui.
- Dialog đọc schema bằng `SCHEMA_QUERY` của Task023 qua adapter, liệt kê các bảng, mỗi bảng chọn số dòng: 10k, 100k (mặc định), 500k.
- Chọn 500k thì hiện cảnh báo: cần khoảng 600 MB RAM cho tab, máy yếu có thể mất gần một phút. Số lấy từ `CLAUDE.md`, ghi rõ là số đo trên một máy.
- Không có lựa chọn trên 500k. Nếu người dùng muốn quy mô lớn hơn, hiện câu dẫn đến Capacity Advisor (SP010) với nhãn Ước lượng.
- Mỗi cột chỉnh được: số giá trị khác nhau, tỷ lệ `NULL` nếu cột cho phép, kiểu phân bố đều hoặc lệch.
- Chạy: thực thi `batches` của `planData` trong một transaction, báo tiến trình sau mỗi batch. Hủy: dừng giữa hai batch rồi `ROLLBACK`, dữ liệu trở về như trước. Nếu bị timeout của Task019 thì báo theo cách của Task020.

Tiêu chí xong:
- AC1: Tạo ba bảng có FK, sinh 10k mỗi bảng: xong không lỗi, `terminal` ghi số dòng từng bảng và thời gian.
- AC2: Bấm Hủy giữa chừng khi sinh 500k: dữ liệu về trạng thái trước, `SELECT count(*)` trả số cũ.
- AC3: Đặt `status` có 3 giá trị khác nhau: sau khi sinh, `SELECT count(DISTINCT status)` trả 3.
- AC4: Cảnh báo 500k hiện đủ hai ngôn ngữ, không có lựa chọn trên 500k.
- AC5: Dùng được bằng bàn phím, có focus nhìn thấy. Ở 390 px dialog không tràn ngang.
- AC6: Playwright phủ AC1 đến AC4 ở `vi` và `en`. Chụp ảnh dialog ở 390 px và 1440 px.
- AC7: `npm run check`, `npm run build`, `npx playwright test` đều đạt.

Ca biên: chưa có bảng nào thì nút bị vô hiệu kèm giải thích; schema có kiểu không hỗ trợ thì hiện lỗi rõ của Task023, không sinh nửa chừng.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: giao diện.
Đọc thêm: `EXPERIENCE.md`; bàn giao Task020, Task021, Task023.
