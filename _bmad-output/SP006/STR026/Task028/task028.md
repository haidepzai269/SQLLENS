# Task028: Parser hai engine

Thuộc: SP006 / STR026
Điều kiện bắt đầu: Task021 đã merge, để dùng lại cách nạp `libpg-query.wasm` trong `guard.ts`.
Mục tiêu: Một hàm duy nhất tách SQL thành danh sách câu cho cả PostgreSQL và MySQL, không làm treo giao diện, và lỗi parse không bao giờ chặn việc chạy.
Phạm vi: `web/src/modules/sql-intake/parser/**`.
Không làm: giao diện, phân loại đầu vào (Task030), suy ra schema (Task031), sửa `guard.ts`.

Hợp đồng:
- `type StatementKind = "create_table" | "alter_table" | "create_index" | "drop" | "select" | "insert" | "update" | "delete" | "transaction" | "set" | "other"`
- `type ParsedStatement = { index: number; kind: StatementKind; start: number; end: number; tables: string[]; ast: unknown }`. `start` và `end` là vị trí ký tự trong chuỗi JS. `index` đếm từ 0.
- `type ParseError = { message: string; position?: number; line?: number; column?: number }`. `position` đếm từ 0, `line` và `column` đếm từ 1.
- `type ParseOutcome = { ok: true; statements: ParsedStatement[] } | { ok: false; error: ParseError }`
- `parseSql(sql: string, engine: EngineId): Promise<ParseOutcome>`: chạy trong Web Worker riêng, tải parser ở lần gọi đầu. Không bao giờ reject vì SQL sai.
- `disposeParser(): void`: dừng worker.
- Dùng `pgsql-parser` và `node-sql-parser/build/mysql`. Engine nào chưa dùng thì không tải parser của engine đó.

Tiêu chí xong:
- AC1: Mở trang không tải parser. Gọi `parseSql` với `postgres` chỉ tải `pgsql-parser` và `libpg-query.wasm`, với `mysql` chỉ tải parser MySQL. Playwright kiểm trên bản `next build`.
- AC2: Cùng bộ SQL mẫu `CREATE TABLE`, `CREATE INDEX`, `SELECT` có `JOIN`, `INSERT`, `UPDATE`, `DELETE`, `BEGIN`: hai engine trả cùng `kind` và cùng `tables`.
- AC3: `SELEC 1` trên `postgres` trả `ok: false` với `position` 0, `line` 1, `column` 1. Lỗi ở giữa câu thứ hai trên dòng thứ ba cho đúng dòng và cột. Task013 ghi vị trí của `libpg-query` đếm từ 0 nhưng chưa chắc, phải kiểm bằng câu lỗi ở giữa.
- AC4: `SELECT * FROM t FORCE INDEX (i)` trên `mysql`, câu `node-sql-parser` không đọc được, trả `ok: false`, không ném lỗi. Có test nói rõ nơi gọi không được chặn việc gửi cho MySQL thật.
- AC5: SQL có chữ tiếng Việt trong comment và chuỗi: `start`, `end` vẫn đúng, vì `libpg-query` trả vị trí theo byte UTF-8.
- AC6: SQL 1 MB: `requestAnimationFrame` không có khung nào chờ quá 200 ms khi parse. Ghi thời gian parse vào bàn giao.
- AC7: Parser không tải được: trả `ok: false` với lỗi rõ, không treo. Gọi lại thì thử tải lại.
- AC8: Hai lần gọi liên tiếp trả đúng kết quả cho từng lần gọi, kể cả khi lần sau xong trước.
- AC9: `npm run check`, `npm run build`, `npx playwright test` đều đạt.

Ca biên: chuỗi rỗng và chỉ có comment trả `ok: true` với 0 câu; tên bảng có schema (`public.t`) và trong ngoặc kép giữ đúng tên; subquery và CTE không tính CTE là bảng; không ghi SQL vào `console`.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: không ghi log SQL.
Đọc thêm: `_bmad-output/SP002/STR007/Task013/ket_qua.md` mục AC5; `CLAUDE.md` mục "Khác biệt giữa hai engine"; `web/src/engines/postgres/guard.ts`.
