# Bàn giao Task053

Đã làm: `checkQueries(statements, engine, sql?)` trả `RuleHit[]` cho bốn luật `function-on-indexed-column`, `leading-wildcard`, `composite-prefix`, `implicit-cast`, cả PostgreSQL và MySQL. Index và kiểu cột lấy từ `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE ADD` trong đầu vào; không có thì luật cần chúng không báo. Hàm thuần, bỏ qua câu có `ast` không đọc được. `messageKey` là `findings.query.<ruleId>`. Kiểm cả `SELECT`, `UPDATE`, `DELETE`, subquery, CTE, UNION.
File chính: `web/src/modules/findings/query-rules/{index,pg,mysql,types}.ts`, test `index.test.ts`.
Kết quả kiểm tra (trong `web/`):
- `npx vitest run src/modules/findings/query-rules`: 21/21 đạt.
- `npm run check` trên d20c377: lint, typecheck, i18n đạt; test 228/229, trượt duy nhất `plan-data.test.ts` AC5 100k orders (ngưỡng 15 giây, đo 16,7 đến 19,7 giây khi máy quá tải, kèm lỗi fork worker) nên lệnh thoát mã 1. Chạy riêng `plan-data.test.ts` và `src/modules/findings`: 30/30 đạt. AC8 chưa thoát 0 trọn vẹn do test thời gian của task khác.
Kết quả review: 2 lỗi đã sửa (UNION trên PostgreSQL không bị kiểm vì hai nhánh là SelectStmt trần; test AC5 cuối không kiểm gì). 2 mục hạn chế đã thêm comment `shortcut:` (xem dưới). Reviewer kiểm lại, không còn lỗi.
needs_validation còn lại: `composite-prefix` chưa tính skip scan của PostgreSQL 18 và MySQL 8, nên có thể báo quá tay khi cột đầu ít giá trị riêng; chưa kiểm trên engine thật.
Chưa làm được:
- `NOT (...)` bị bỏ qua nên `NOT (lower(x)='a')` không báo.
- MySQL `ast` không có vị trí nên `start`/`end` là cả câu. PostgreSQL tô đúng biểu thức chỉ khi truyền `sql` (tham số tùy chọn thứ ba, vì vị trí trong `ast` là byte); không truyền thì tô cả câu.
- `implicit-cast` chỉ xét cột so với literal, không xét cột với cột (join khác kiểu). FK ngầm của MySQL không tính là index (chỉ làm luật ít báo hơn).
- Khớp bảng theo tên, bỏ qua schema.
Phát sinh:
- STR041 phải truyền `sql` vào `checkQueries` nếu muốn tô đúng ở PostgreSQL.
- `values.effect` của `implicit-cast` là `literal-cast`, `column-cast` (index không dùng được, MySQL) hoặc `error` (PostgreSQL cột chữ so với số). Câu dịch phải phân biệt ba loại.
- Mảng rỗng chỉ có nghĩa luật chưa thấy gì, vì các hạn chế trên: STR041 không được dịch thành "query ổn".
- Phần trùng với Task052 (đọc `CREATE TABLE` và index từ AST) chưa dùng chung; nên gộp sau.
Việc tiếp theo cần biết: test `plan-data.test.ts` (task khác, AC5 100k orders) trượt ngưỡng 15 giây khi máy tải (16,7 giây), không liên quan Task053.
