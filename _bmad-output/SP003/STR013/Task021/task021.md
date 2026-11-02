# Task021: Role quyền thấp và kênh quản trị

Thuộc: SP003 / STR013
Điều kiện bắt đầu: Task019 đã merge.
Mục tiêu: SQL người dùng chạy bằng role quyền thấp và không thoát được ra superuser. Các phần đọc thông tin hệ thống, như `pageinspect` cho cây B-Tree, đi qua một kênh quản trị riêng mà SQL người dùng không chạm tới.
Phạm vi: `web/src/engines/postgres/guard*`, `web/src/engines/postgres/roles*`, `web/src/engines/postgres/worker.ts`, `web/messages/*/guard.json`.
Không làm: đọc cây B-Tree (SP008), giao diện ngoài một thông báo lỗi.

Bối cảnh: Task013 chứng minh trong PGlite `session_user` là superuser, nên SQL chạy dưới role quyền thấp vẫn gọi được `RESET ROLE` hay `SET ROLE postgres`. Chặn bằng parser là chưa đủ, vì còn `set_config('role', ...)` và `EXECUTE` trong khối `DO`. Vì vậy cần hai lớp: chặn trước bằng parser, và kiểm sau mỗi lần chạy.

Hợp đồng:
- Khởi tạo: worker tạo role `sqllens_user` không có quyền superuser, sở hữu schema `public`. Mọi `execute` của người dùng chạy sau `SET ROLE sqllens_user`.
- `checkUserSql(sql: string): { ok: true } | { ok: false; reasonKey: string; statementIndex: number }` trong `guard.ts`: dùng `pgsql-parser` để từ chối `SET ROLE`, `RESET ROLE`, `RESET ALL`, `SET SESSION AUTHORIZATION`, `CREATE EXTENSION`, `LOAD`, `COPY ... PROGRAM`, `CREATE ROLE`, `ALTER ROLE`, `GRANT`, `REVOKE`, và mọi lời gọi hàm `set_config` có tham số đầu là `role` hoặc `session_authorization`.
- Lớp hai: sau mỗi lần chạy, worker đọc `current_user` và `session_user` qua kênh quản trị. Nếu `current_user` khác `sqllens_user`, worker bị dừng và dựng lại từ `history()`, kết quả của lần chạy đó bị bỏ, và trả lỗi `code: "sql"` với thông báo từ `guard.json`.
- `adminQuery(sql: string)`: chỉ dùng trong code của engine, không xuất ra cho module giao diện. Chạy dưới superuser rồi trả về `sqllens_user`.
- Lỗi parse của `pgsql-parser` không chặn câu hợp lệ của PostgreSQL. Câu parser không đọc được thì vẫn gửi cho PGlite, và lớp hai vẫn kiểm.

Tiêu chí xong:
- AC1: Test với PGlite thật trong Node: mỗi câu trong danh sách từ chối đều bị `checkUserSql` chặn, kể cả viết hoa, có comment, hay nằm giữa nhiều câu.
- AC2: `DO $$ BEGIN EXECUTE 'SET ROLE postgres'; END $$;` và `SELECT set_config('role', 'postgres', false);` không làm phiên ở lại superuser: lớp một hoặc lớp hai bắt được, và câu kế tiếp vẫn chạy dưới `sqllens_user`.
- AC3: Dưới `sqllens_user`, gọi `bt_metap` trả lỗi quyền. Qua `adminQuery` thì đọc được.
- AC4: Câu thường của người dùng (`CREATE TABLE`, `CREATE INDEX`, `INSERT`, `SELECT`, `EXPLAIN ANALYZE`, `BEGIN`, `COMMIT`) vẫn chạy đúng.
- AC5: Thông báo từ chối đủ hai ngôn ngữ, nói rõ câu thứ mấy bị chặn và lý do.
- AC6: `npm run check` và `npm run build` thoát với mã 0. Playwright hiện có vẫn đạt.

Ca biên: `SET search_path` và `SET statement_timeout` vẫn được phép. Ghi rõ trong bàn giao những câu `SET` nào được phép.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: bảo mật, đọc kỹ theo `ATTACK-CLASSES.md` của skill `security-audit` phần liên quan đến leo quyền.
Đọc thêm: `_bmad-output/SP002/STR007/Task013/ket_qua.md` mục AC4; `CLAUDE.md` nguyên tắc 8 và mục "Đã kiểm chứng"; bàn giao Task019.
