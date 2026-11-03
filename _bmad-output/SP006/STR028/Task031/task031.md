# Task031: Lõi suy ra schema từ query

Thuộc: SP006 / STR028
Điều kiện bắt đầu: Task028 đã merge.
Mục tiêu: Khi người dùng chỉ dán query, đưa ra một bản nháp schema đủ để chạy, nói rõ phần nào là đoán, để người dùng sửa và xác nhận.
Phạm vi: `web/src/modules/sql-intake/infer/**`.
Không làm: giao diện (Task033), tự chạy schema đã suy ra.

Hợp đồng:
- `type InferredColumn = { name: string; type: string; reason: "literal" | "name" | "default"; primaryKeyGuess: boolean }`
- `type InferredTable = { name: string; columns: InferredColumn[]; foreignKeyGuesses: { column: string; table: string; refColumn: string }[]; incomplete: boolean }`
- `inferSchema(statements: ParsedStatement[], engine: EngineId): { tables: InferredTable[]; warnings: { key: string; table?: string }[] }`
- `toCreateSql(tables: InferredTable[], engine: EngineId): string`: sinh `CREATE TABLE` đúng dialect, tên luôn được quote an toàn.
- Hàm thuần. Kết quả là bản nháp, không phải kết luận, nên không gắn nhãn Thật, Mô phỏng hay Ước lượng.

Tiêu chí xong:
- AC1: `SELECT o.id, c.email FROM orders o JOIN customers c ON o.customer_id = c.id WHERE o.total > 100`: có đủ hai bảng và các cột, alias được giải đúng, có gợi ý FK `orders.customer_id` tới `customers.id`, `total` có kiểu số vì so với số.
- AC2: `SELECT * FROM t`: bảng `t` có `incomplete: true` và một cảnh báo, không tự chế cột.
- AC3: Cột không có alias khi có nhiều bảng trong `FROM`: không gán bừa vào một bảng, có cảnh báo.
- AC4: CTE và subquery không sinh thành bảng. Cột lấy từ CTE vẫn truy về đúng bảng gốc khi rõ ràng.
- AC5: `INSERT INTO t (a, b) VALUES (1, 'x')` và `UPDATE t SET a = 1 WHERE b = 'x'` lấy được cột và kiểu từ literal.
- AC6: Chạy `toCreateSql` rồi chạy query gốc của AC1 và AC5 trên PGlite thật không lỗi. Phần MySQL kiểm bằng `parseSql`, chưa chạy MySQL thật.
- AC7: Tên có chữ hoa, dấu cách, dấu `"` hoặc backtick được quote đúng, không sinh SQL hỏng hoặc chèn được lệnh.
- AC8: `npm run check` thoát với mã 0.

Ca biên: hai query dùng một cột với kiểu mâu thuẫn thì chọn `text` và cảnh báo; hàm bọc cột như `lower(email)` vẫn nhận ra cột `email`; không có bảng nào thì trả mảng rỗng.
Kiểm tra: `cd web && npm run check`
Góc review thêm: bảo mật (quote tên).
Đọc thêm: bàn giao Task028; `CLAUDE.md` dòng "Khi chỉ dán query" và nguyên tắc 4.
