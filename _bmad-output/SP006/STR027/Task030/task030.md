# Task030: Phân loại đầu vào

Thuộc: SP006 / STR027
Điều kiện bắt đầu: Task028 đã merge.
Mục tiêu: Từ SQL đã dán, biết đó là schema, query hay cả hai, kể cả file dump dài của `pg_dump` và `mysqldump`.
Phạm vi: `web/src/modules/sql-intake/classify/**`.
Không làm: giao diện, suy ra schema.

Hợp đồng:
- `type InputKind = "empty" | "schema" | "query" | "both" | "unknown"`
- `classifyInput(outcome: ParseOutcome): { kind: InputKind; schemaStatements: number[]; queryStatements: number[]; otherStatements: number[] }`. Các mảng chứa `index` của câu.
- `prepareDump(sql: string, engine: EngineId): { sql: string; removed: { copyBlocks: number; lockStatements: number } }`: bỏ phần `parseSql` không đọc được, như khối dữ liệu `COPY ... FROM stdin` đến `\.`, lệnh `\connect` của `psql`, `LOCK TABLES`. Không đổi nội dung còn lại.
- Hàm thuần, không phụ thuộc trình duyệt.

Tiêu chí xong:
- AC1: Chỉ `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE` cho `schema`. Chỉ `SELECT`, `UPDATE`, `DELETE` cho `query`. Có cả hai nhóm cho `both`.
- AC2: `INSERT` đi cùng `CREATE TABLE` không biến thành `both`, vì đó là dữ liệu mẫu. `INSERT` đứng một mình cho `query`.
- AC3: Parse lỗi cho `unknown`, không ném lỗi. Chuỗi rỗng cho `empty`.
- AC4: Dump dạng `pg_dump`, có `COPY ... FROM stdin`, `SET`, `SELECT pg_catalog.set_config(...)`: sau `prepareDump` thì parse được và cho `schema`, không vì câu `SELECT set_config` đó mà thành `both`.
- AC5: Dump dạng `mysqldump`, có `/*!40101 SET ... */`, `LOCK TABLES`, `INSERT`: parse được và cho `schema`.
- AC6: Chuỗi trong câu `INSERT` có chữ `\.` hoặc `COPY` không bị cắt nhầm.
- AC7: Dump 5 MB chạy `prepareDump` dưới 1 giây trong Node. Ghi số đo vào bàn giao.
- AC8: `npm run check` thoát với mã 0.

Ca biên: file CRLF; `COPY` có cột; `COPY ... FROM stdin` thiếu dòng `\.` ở cuối thì giữ an toàn, không xóa phần sau nó mà báo qua `removed`.
Kiểm tra: `cd web && npm run check`
Góc review thêm: không có.
Đọc thêm: bàn giao Task028.
