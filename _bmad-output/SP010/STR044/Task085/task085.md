# Task085: Thử sửa What-if trên MySQL bằng Bảng Shadow

## 1. Mục tiêu & Bối cảnh
- **Story:** SP010 / STR044 (Thử sửa MySQL trên bảng clone tạm).
- **Bối cảnh:**
  - Ở PostgreSQL, câu lệnh DDL (`CREATE INDEX`) chạy trong transaction và `ROLLBACK` được, giúp dữ liệu nguyên trạng sau khi đo.
  - Ở MySQL, bất kỳ câu lệnh DDL nào đều gây ra **Implicit Commit**, làm kết thúc transaction và áp dụng vĩnh viễn vào CSDL. Do đó không thể dùng `ROLLBACK`.
- **Mục tiêu của Task085:** 
  - Hiện thực hóa cơ chế thử sửa What-if an toàn trên MySQL bằng cách nhân bản bảng tạm Shadow (`CREATE TABLE __whatif_xxx LIKE xxx;`), nạp dữ liệu mẫu (tối đa 10.000 dòng), áp dụng DDL đề xuất, đo đạc kế hoạch `EXPLAIN FORMAT=JSON` trước và sau, rồi tự động `DROP TABLE` dọn dẹp sạch sẽ trong khối `finally`.
  - Hiển thị bảng đối chiếu trước và sau trên tab Thử sửa mang nhãn `Thật` (vì đo từ `EXPLAIN` thật trên container MySQL).

## 2. Tiêu chí nghiệm thu (Acceptance Criteria)
- **AC1 (Cơ chế Shadow Table tự động):**
  - Khi người dùng nhập câu lệnh thử sửa (ví dụ: `CREATE INDEX idx_orders_created_at ON orders(created_at);`):
  - Hệ thống tự động nhận diện bảng mục tiêu `orders`, tạo bảng shadow `__whatif_orders` với cấu trúc tương tự.
  - Sao chép tối đa 10.000 dòng từ bảng gốc sang bảng shadow: `INSERT INTO __whatif_orders SELECT * FROM orders LIMIT 10000;`.
  - Áp dụng thay đổi trên bảng shadow: đổi tên bảng mục tiêu trong câu lệnh DDL sang `__whatif_orders`.
- **AC2 (Đo đạc & So sánh Trước / Sau):**
  - Chạy `EXPLAIN FORMAT=JSON` trước khi sửa trên câu query gốc và sau khi sửa trên câu query trỏ vào bảng shadow.
  - So sánh chi phí (`query_cost`), kiểu quét (`access_type`: từ `ALL` sang `ref` hoặc `range`), và số dòng ước tính phải duyệt (`rows_examined_per_scan`).
  - Kết quả đối chiếu hiển thị rõ ràng trên giao diện chia đôi Trước / Sau mang nhãn **`Thật`**.
- **AC3 (Dọn dẹp tuyệt đối trong `finally`):**
  - Câu lệnh `DROP TABLE IF EXISTS __whatif_...;` luôn được đảm bảo thực thi ngay sau khi đo xong, kể cả khi câu lệnh DDL thử nghiệm bị lỗi cú pháp.
- **AC4 (Bảo vệ tài nguyên & Disk Quota):**
  - Kiểm tra dung lượng và số dòng trước khi clone. Nếu bảng quá lớn, chỉ lấy mẫu 10.000 dòng để không làm đầy 50MB disk quota của container MySQL.
- **AC5 (Chất lượng code & Test):**
  - Unit tests cho module What-if MySQL xử lý đúng các trường hợp câu DDL đơn, câu có alias, câu lỗi.
  - E2E Playwright test kiểm tra luồng What-if trên MySQL hoạt động trơn tru trên cả Desktop 1440px và Mobile 390px, song ngữ `/vi` và `/en`.
  - `npm run check` (typecheck + lint + unit tests) đạt 100%.

## 3. File tác động & Tạo mới
- Tạo mới: `web/src/engines/mysql/whatif-shadow.ts` & `web/src/engines/mysql/whatif-shadow.test.ts`.
- Cập nhật: `web/src/engines/mysql/adapter.ts` (thay thế `no("whatif")` bằng `tryChange` trên shadow table).
- Cập nhật: `web/src/modules/lab/stage/stage-data.ts`.
- E2E test: `web/e2e/mysql-whatif.spec.ts`.
