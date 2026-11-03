# Bàn giao Task023

Đã làm: lõi sinh dữ liệu. `SCHEMA_QUERY`, `parseSchema`, `planData` đúng hợp đồng. SQL dùng `generate_series` cộng `hashint8extended` có seed; faker chỉ tạo tập mẫu tối đa 1.000 giá trị cho cột đoán theo tên (email, name, phone, status, country, city). Khóa chính và unique sinh theo chỉ số nên không trùng. Khóa ngoại lấy giá trị đã có ở bảng cha. Cột `distinct` được phủ đủ ở các dòng đầu nên `count(DISTINCT)` đúng. `zipf` dùng lũy thừa nên giá trị đầu chiếm phần lớn.
File chính: `web/src/modules/data-lab/generate/plan-data.ts`, `plan-data.test.ts`.
Kết quả kiểm tra: `cd web && npm run check` thoát 0 (i18n, eslint, tsc, vitest 50/50). Test chạy batch trên PGlite thật trong Node: schema customers/orders/order_items có FK, 25k dòng order_items, bảng tên có dấu cách và dấu `"`.
AC5 (100k dòng `orders`, có FK tới customers): 5,1 giây khi đo riêng, 6,7 giây trong lần chạy test lúc máy bận. Chưa đạt mục tiêu 5 giây. Phần SQL của planData chỉ mất 1,4 giây (đo khi bỏ FK); khoảng 3,7 giây còn lại là trigger kiểm FK của PGlite cho từng dòng. Chưa đo lại khi máy rảnh. Test chỉ chặn ở 15 giây để khỏi chập chờn, không phải tiêu chí.
Kết quả review: 5 lỗi báo, sửa 2 (FK bị NULL hóa thừa ngoài chu trình; `nullRatio` làm cột cha có NULL khiến FK con hỏng). Lỗi 3, 4 là hạn chế đã biết, ghi dưới đây. Lỗi 5 (partition con) là needs_validation, chưa chạy thử. Chưa gọi vòng kiểm tra lại của reviewer cho bản sửa; test mới bao hai lỗi đã sửa.
Chưa làm được: FK nhiều cột và UNIQUE nhiều cột (SCHEMA_QUERY chỉ nhận FK một cột, nên INSERT có thể bị FK từ chối lúc chạy). Khóa chính nhiều cột: `planData` báo lỗi rõ tên bảng. Kiểu ngoài danh sách (json, tsvector, enum...): bỏ qua nếu cho phép NULL, báo lỗi nếu NOT NULL.
Cách chọn cho AC6/AC7: vòng FK hoặc tự trỏ thì sinh NULL ở cột FK nullable nằm trên vòng; không có cột nullable thì báo lỗi `cycle`.
Phát sinh (cho SP999):
- PK `GENERATED ALWAYS AS IDENTITY` bị loại khỏi `SCHEMA_QUERY` nên bảng con trỏ vào nó báo lỗi "referenced column not found".
- Cột serial/identity by default không được đặt lại sequence sau khi chèn, INSERT tay sau đó có thể trùng khóa.
- Hỗ trợ khóa nhiều cột; partition con bị liệt kê như bảng riêng.
- Tăng tốc nạp FK: Task024 có thể cân nhắc tắt trigger FK tạm thời, vì giá trị đã đúng theo cấu trúc, nhưng phải được chủ dự án duyệt.
Việc tiếp theo cần biết: Task024 chạy `SCHEMA_QUERY` qua adapter rồi đưa `{columns, rows}` vào `parseSchema`. Chạy từng phần tử `batches` theo thứ tự. `distinct` bị kẹp bằng số dòng; `nullRatio` bị bỏ qua với cột NOT NULL và cột được bảng khác tham chiếu. Test dùng `// @vitest-environment node`.
