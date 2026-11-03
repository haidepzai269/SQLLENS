# Task053: Luật kiểm tra query

Thuộc: SP009 / STR040
Mục tiêu: Từ query và schema, tìm các cách viết làm index không dùng được, cho cả PostgreSQL và MySQL.
Phạm vi: `web/src/modules/findings/query-rules/**`.
Không làm: gắn bằng chứng và nhãn (STR041), giao diện, câu dịch, sửa `web/src/contracts/finding.ts`.

Hợp đồng:
- `checkQueries(statements: ParsedStatement[], engine: EngineId): RuleHit[]`, đọc `ast` của `parseSql` (Task028). Index lấy từ chính các câu `CREATE TABLE`, `CREATE INDEX` trong đầu vào. Không có thông tin index thì luật cần index không báo, không đoán.
- Hàm thuần. `messageKey` dạng `findings.query.<ruleId>`.

Tiêu chí xong:
- AC1: `function-on-indexed-column`: `WHERE lower(email) = 'x'` với index trên `email` báo một mục. Có expression index `lower(email)` thì không báo. Không có index thì không báo.
- AC2: `leading-wildcard`: `LIKE '%x'` và `LIKE '%x%'` trên cột có index báo. `LIKE 'x%'` không báo. Tham số không phải literal thì không báo.
- AC3: `composite-prefix`: index `(a, b, c)`: `WHERE b = 1` báo, `WHERE a = 1 AND b = 1` không báo, `WHERE b = 1 AND a = 1` không báo.
- AC4: `implicit-cast`: cột số so với chuỗi hoặc cột chữ so với số, khi kiểu cột biết được từ `CREATE TABLE`, báo một mục. Kiểu trùng thì không báo. Ghi rõ khác biệt giữa hai engine.
- AC5: Có alias và `JOIN`: gán đúng cột cho đúng bảng. Không chắc cột thuộc bảng nào thì không báo.
- AC6: Mỗi mục có `table`, `column`, `statementIndex`, và `start`, `end` đúng vị trí nếu `ast` cho phép.
- AC7: Có test cho mọi luật ở cả hai engine, gồm ca báo và ca không báo. Không có rủi ro thì trả mảng rỗng, không có kết quả mang nghĩa "ổn".
- AC8: `npm run check` thoát với mã 0.

Ca biên: subquery và CTE; `UPDATE`, `DELETE` có `WHERE` cũng kiểm; câu parser không đọc được thì bỏ qua câu đó, không ném lỗi.
Kiểm tra: `cd web && npm run check`
Góc review thêm: nhãn kết luận.
Đọc thêm: bàn giao Task028, Task031; `CLAUDE.md` nguyên tắc 2, 4.
