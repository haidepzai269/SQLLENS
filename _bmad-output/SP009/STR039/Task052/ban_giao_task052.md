# Bàn giao Task052

Đã làm: `checkSchema(statements, engine): RuleHit[]` với bốn luật `missing-pk`, `fk-no-index`, `float-money`, `varchar-too-large` (`messageKey` dạng `findings.schema.<ruleId>`). Mỗi câu `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `DROP TABLE` được đổi từ AST của từng engine sang một dạng sự kiện chung (`events.ts`), rồi áp lên trạng thái schema theo thứ tự câu, nên PK khai ở `ALTER`, index tạo sau, bảng bị `DROP` đều được tính. Hit chỉ trả rủi ro, không có hit mang nghĩa "ổn".
File chính: `web/src/modules/findings/schema-rules/{index,events,postgres,mysql}.ts`, test `schema-rules.test.ts`.
Kết quả kiểm tra (trong `web/`):
- `npx vitest run src/modules/findings/schema-rules`: 32/32 đạt, test chạy trên `pgsql-parser` và `node-sql-parser` thật, không qua Worker.
- `npm run check`: xem báo cáo cuối của phiên. Lần chạy đầu, `check:i18n`, lint và typecheck đạt; chỉ `plan-data.test.ts` AC5 (task khác, đo thời gian 100k dòng) trượt vì máy tải (17,7 giây so với ngưỡng 15 giây).
Kết quả review: 4 lỗi đã sửa (`CREATE TABLE IF NOT EXISTS` ghi đè bảng cũ, bỏ PK không xóa index của PK, `ADD COLUMN IF NOT EXISTS` ghi đè kiểu cột, FK trùng báo hai lần) cộng 1 lỗi nhẹ do bản sửa gây ra (các sự kiện PK của câu `IF NOT EXISTS` vẫn áp lên bảng cũ), đã sửa. Reviewer kiểm lại vòng 1 xác nhận 4 lỗi đầu; lỗi thứ 5 sửa sau vòng đó, kèm test, chưa qua reviewer lần nữa. Không còn `needs_validation` nào mở.
Chưa làm được:
- `start`/`end` là vị trí cả câu lệnh, không phải từng cột, vì `ParsedStatement` không mang vị trí cột và MySQL AST không có vị trí.
- Không theo dõi `RENAME`, `DROP INDEX`, `DROP CONSTRAINT` khác khóa chính (ghi `shortcut:` trong `index.ts`). Hệ quả là false negative, không bao giờ thành kết luận "ổn".
- MySQL không bao giờ báo `fk-no-index`: InnoDB tự tạo index cho cột FK nếu chưa có, nên báo sẽ sai. Lý do nằm ở comment trong `index.ts`, test có ca không báo.
- Ngưỡng `varchar-too-large` là 255 (`VARCHAR_THRESHOLD`, đưa vào `values.threshold`): MySQL cần thêm byte độ dài và bảng tạm cấp đủ độ dài khai báo; PostgreSQL không tốn thêm nên chỉ là dấu hiệu chưa chọn giới hạn thật. STR041 nên viết câu giải thích khác nhau theo engine.
Phát sinh:
- `node-sql-parser` MySQL không đọc `real` và `double precision`; `parseMysql` từ chối cả đoạn SQL thay vì bỏ riêng câu đó (thuộc Task028).
- Phần dựng trạng thái schema (bảng, cột, index, FK theo thứ tự câu) có thể trùng với nhu cầu của Task053; hiện không dùng chung code, cân nhắc gom sau.
- Index `hash` và index một phần trên cột FK: hiện index một phần và không phải btree không tính là che FK (chọn thiết kế, cần chủ dự án xác nhận).
Việc tiếp theo cần biết: `RuleHit.values` có `columns` (fk-no-index, cột ghép nối bằng dấu phẩy), `type` (float-money), `length` và `threshold` (varchar-too-large). Bảng ngoài schema `public` của PostgreSQL có `table` dạng `schema.bảng`. STR041 cần thêm bản dịch cho 4 khóa `findings.schema.*`.
