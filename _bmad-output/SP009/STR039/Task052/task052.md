# Task052: Luật kiểm tra schema

Thuộc: SP009 / STR039
Mục tiêu: Từ schema, tìm các rủi ro thiết kế phổ biến, cho cả PostgreSQL và MySQL.
Phạm vi: `web/src/modules/findings/schema-rules/**`.
Không làm: gắn bằng chứng và nhãn (STR041), giao diện, câu dịch, sửa `web/src/contracts/finding.ts`.

Hợp đồng:
- `checkSchema(statements: ParsedStatement[], engine: EngineId): RuleHit[]`, đọc `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX` từ `ast` của `parseSql` (Task028). Hai engine có `ast` khác hình dạng nên phải rẽ theo `engine`.
- Hàm thuần. Mỗi luật có `ruleId` cố định và `messageKey` dạng `findings.schema.<ruleId>`.
- Tính cả trạng thái sau nhiều câu, ví dụ `CREATE TABLE` rồi `CREATE INDEX` ở câu sau, hoặc `ALTER TABLE ADD PRIMARY KEY`.

Tiêu chí xong:
- AC1: `missing-pk`: bảng không có khóa chính báo một mục. Có PK thì không báo, kể cả PK khai ở `ALTER TABLE` sau đó.
- AC2: `fk-no-index`: cột FK không có index báo một mục. Không báo khi cột là cột đầu của một index. Vẫn báo khi cột chỉ đứng sau trong index nhiều cột. Trên MySQL, InnoDB tự tạo index cho FK nên phải xử lý đúng và ghi lý do.
- AC3: `float-money`: cột tên `price`, `amount`, `total`, `cost`, `balance` có kiểu `float`, `real`, `double` báo một mục. `numeric` và `decimal` không báo. Cột `float` tên khác không báo.
- AC4: `varchar-too-large`: `varchar` trên ngưỡng báo một mục. Ghi ngưỡng và lý do. `text` không báo.
- AC5: Mỗi mục có `table`, `column` khi áp dụng được, `statementIndex`, và `start`, `end` đúng vị trí trong SQL nếu `ast` cho phép.
- AC6: Có test cho mọi luật ở cả hai engine, gồm ca báo và ca không báo. Không báo trùng một mục hai lần.
- AC7: Không có luật nào trả kết quả mang nghĩa "ổn". Không có rủi ro thì trả mảng rỗng.
- AC8: `npm run check` thoát với mã 0.

Ca biên: tên có schema `public.t` và tên trong ngoặc kép; bảng bị `DROP` sau đó; câu parser không đọc được thì bỏ qua câu đó, không ném lỗi.
Kiểm tra: `cd web && npm run check`
Góc review thêm: nhãn kết luận (không hàm ý thiết kế ổn).
Đọc thêm: bàn giao Task028, Task031 (cách đọc `ast`); `CLAUDE.md` nguyên tắc 2, 4.
