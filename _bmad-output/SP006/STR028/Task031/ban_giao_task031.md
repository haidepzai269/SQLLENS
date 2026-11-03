# Bàn giao Task031

Đã làm: `inferSchema(statements, engine)` và `toCreateSql(tables, engine)` cho PostgreSQL và MySQL. AST của hai engine được đưa về một dạng chung nhỏ (`ir.ts`) rồi suy luận một lần. Hỗ trợ alias, JOIN, USING, CTE, subquery (FROM và WHERE), UNION, INSERT, UPDATE, DELETE. Kiểu cột lấy từ literal, nếu không thì từ tên cột, nếu không thì `text`. Gợi ý FK lấy từ phép so sánh `=` với cột `id` và từ tên `x_id`. Tên bảng và cột luôn được quote theo dialect, kiểu cột phải nằm trong danh sách cho phép, ngoài danh sách thì về `text`.
File chính: `web/src/modules/sql-intake/infer/{index,ir}.ts`, test `infer.test.ts`.
Kết quả kiểm tra (trong `web/`):
- `npx vitest run src/modules/sql-intake/infer`: 29/29 đạt, gồm AC6 chạy `toCreateSql` rồi query gốc trên PGlite thật.
- `npm run lint` và `npx tsc --noEmit`: thoát 0.
- `npm run check`: xem báo cáo cuối của phiên, test `result-grid AC2` của task khác từng quá hạn 5 giây khi máy tải.
Kết quả review: 4 lỗi đã sửa (subquery trong WHERE của PG bị mất, JOIN USING, ORDER BY của UNION MySQL sinh cột bịa, kiểu có độ dài như `int(5)` sinh SQL hỏng). Reviewer đã kiểm lại, xác nhận hết. Còn `needs_validation`: hàm trong FROM như `generate_series(...) g` bị bỏ qua nên `g` bị gán cho bảng khác.
Chưa làm được: không sinh `REFERENCES` (FK chỉ là gợi ý, có comment `shortcut:`). Schema khác (`a.t`) bị bỏ phần schema và có cảnh báo `schema-ignored`. Bảng chỉ dùng `SELECT *` trên MySQL được thêm cột giữ chỗ `_sqllens_placeholder`. Phần MySQL chỉ kiểm bằng `parseSql`, chưa chạy MySQL thật.
Phát sinh:
- Cột USING được thêm vào mọi bảng trong cùng SELECT, nên `a JOIN b USING (k) JOIN c ON ...` có cột thừa `c.k` (chỉ thừa, query vẫn chạy).
- Hàm trong FROM (`generate_series`) chưa được hiểu.
- Warning key mới Task033 cần có bản dịch: `star`, `insert-without-columns`, `ambiguous-column`, `type-conflict`, `schema-ignored`.
Việc tiếp theo cần biết: `InferredColumn.type` dùng tên trung tính (`integer`, `numeric`, `text`, `boolean`, `date`, `timestamp`), `toCreateSql` đổi sang kiểu từng engine. Kiểu người dùng sửa tay phải qua `toCreateSql` để được kiểm.
