# Task022: Lưới kết quả và hiển thị lỗi

Thuộc: SP003 / STR013
Mục tiêu: Component hiện kết quả SQL đúng với mọi kiểu dữ liệu, chịu được bảng lớn, và hiện lỗi PostgreSQL kèm vị trí.
Phạm vi: `web/src/components/result-grid/**`, `web/messages/*/result.json`.
Không làm: gắn vào màn hình (Task020), gọi engine.

Hợp đồng:
- `ResultGrid({ results }: { results: QueryResult[] })`: hiện từng kết quả theo thứ tự câu. Kiểu `QueryResult` lấy từ `web/src/contracts/engine.ts`, không đổi kiểu đó.
- `SqlErrorView({ message, position, sql }: { message: string; position?: number; sql: string })`: hiện thông báo lỗi, và nếu có `position` thì hiện dòng SQL có lỗi kèm dấu chỉ đúng cột.
- `formatCell(value: unknown): { text: string; kind: "null" | "number" | "text" | "date" | "bytes" | "json" | "bool" }`: hàm thuần, có test.
- Dùng component `table` của shadcn/ui và token trong `globals.css`, theo `DESIGN.md`.

Tiêu chí xong:
- AC1: `formatCell` hiện đúng: `null` thành chữ `NULL` có kiểu khác chữ thường; số giữ nguyên độ chính xác của `numeric` (chuỗi); `Date` hợp lệ hiện ISO; `Date` không hợp lệ hiện `Invalid date`, không phải `null`; `Uint8Array` hiện `\x` cộng hex, tối đa 64 byte kèm số byte còn lại; object và mảng hiện JSON; `true` và `false` hiện như PostgreSQL (`t`, `f`). Giá trị `infinity` của timestamptz không làm sập. Mỗi trường hợp có test.
- AC2: Kết quả trên 500 dòng: chỉ render 500 dòng đầu, hiện tổng số dòng và câu báo đã cắt. Kết quả 0 dòng: hiện trạng thái rỗng kèm tên cột. Câu không trả dòng như `CREATE TABLE`: hiện số dòng bị ảnh hưởng nếu có.
- AC3: Nhiều kết quả: mỗi kết quả có tiêu đề "Câu N". Kết quả của câu cuối mở sẵn, các câu trước thu gọn được.
- AC4: `SqlErrorView` với `SELEC 1` và `position` 1 chỉ đúng chữ `SELEC`. SQL nhiều dòng thì tính đúng dòng và cột.
- AC5: Bảng rộng hơn khung cuộn ngang bên trong component, trang không cuộn ngang ở 390 px.
- AC6: Đủ tiếng Việt và tiếng Anh. Không có chuỗi cứng.
- AC7: Có trang thử hoặc test render bằng Testing Library cho AC2, AC3, AC4. `npm run check` thoát với mã 0.

Ca biên: tên cột trùng nhau (`SELECT 1 a, 2 a`) vẫn hiện đủ hai cột; chuỗi chứa HTML hiện dạng chữ, không chạy.
Kiểm tra: `cd web && npm run check`
Góc review thêm: giao diện, bảo mật (chuỗi HTML).
Đọc thêm: `DESIGN.md`, `EXPERIENCE.md`; `web/src/modules/lab/lab-client.tsx` (cách hiện kết quả hiện tại, các lỗi đã sửa ở Task011).
