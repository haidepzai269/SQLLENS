# Task036: Role quyền thấp cho phiên MySQL

Thuộc: SP004 / STR018
Mục tiêu: Mỗi phiên MySQL có một tài khoản quyền thấp để chạy SQL người dùng. Tài khoản này không đọc được thông tin hệ thống, không đọc ghi được file, không ảnh hưởng được tới phiên khác. Root chỉ để thành phần quản trị dùng.
Phạm vi: `sandbox/mysql-seed/**`, `_bmad-output/SP004/STR018/Task036/**`.
Không làm: sandbox agent (Task035), mạng từ Render tới máy Azure, sửa NSG, `ufw` hay SSH.

Hợp đồng (Task035 dựa vào):
- `session.sh create TÊN` tạo thêm database `app` và tài khoản `sqllens_user`, mật khẩu ngẫu nhiên riêng cho từng phiên.
- Mật khẩu của root và của `sqllens_user` nằm trong hai file quyền 600 thuộc root, trong thư mục riêng của phiên: `root.pw` và `user.pw`. Không truyền qua biến môi trường, không có trong `docker inspect`, log hay danh sách tiến trình.
- `session.sh exec TÊN --as user|root [tham số mysql]` chạy client với đúng tài khoản. Mặc định là `user`.
- Quyền của `sqllens_user` chỉ trên `app.*`, đủ cho các câu người học hay dùng: tạo, sửa, xóa bảng, index, view, khóa ngoại, đọc ghi dữ liệu, transaction, `LOCK TABLES`, bảng tạm. Không có quyền toàn cục nào. Ghi danh sách quyền đã cấp và lý do vào `ket_qua.md`.

Tiêu chí xong:
- AC1: Dưới `sqllens_user`, các câu sau đều bị từ chối: đọc `performance_schema.data_locks`, `performance_schema.data_lock_waits`, `mysql.user`; `SELECT ... INTO OUTFILE`; `LOAD_FILE()`; `LOAD DATA INFILE`; `SET GLOBAL`; `CREATE USER`; `GRANT`; `SHOW PROCESSLIST` thấy kết nối của root; `KILL` kết nối của root. Kiểm từng câu trên máy Azure, ghi kết quả.
- AC2: Dưới `sqllens_user`, các câu `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, `INSERT`, `UPDATE`, `DELETE`, `SELECT ... JOIN`, `BEGIN`, `COMMIT`, `ROLLBACK`, `SELECT ... FOR UPDATE`, `EXPLAIN`, `EXPLAIN ANALYZE`, `SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED` đều chạy được.
- AC3: Kịch bản AC1 của Task016 chạy với hai kết nối là `sqllens_user`, còn kết nối đọc `performance_schema` là root. Kết quả 5/5 lần giống Task016.
- AC4: Hai phiên khác nhau: mật khẩu khác nhau, `sqllens_user` của phiên A không đăng nhập được phiên B.
- AC5: `information_schema` dưới `sqllens_user` chỉ thấy `app` và các schema hệ thống mặc định mà MySQL luôn cho thấy. Ghi rõ những gì vẫn thấy.
- AC6: Thời gian khởi động phiên không tăng quá 1 giây so với Task034. Đo 5 lần.
- AC7: Bản mẫu vẫn kiểm được bằng `seed.sh verify`. Dọn hết container thử khi xong, máy vẫn chạy.

Ca biên: `sqllens_user` tạo procedure hoặc trigger `SQL SECURITY DEFINER` không được lên quyền root; câu chạy lâu bị giới hạn bằng `max_execution_time` hoặc cách tương đương, ghi giá trị đã chọn.
Kiểm tra: AC1 đến AC7 trên máy Azure.
Góc review thêm: bảo mật, leo quyền trong MySQL.
Đọc thêm: `_bmad-output/SP004/STR017/Task034/ket_qua.md` và `ban_giao_task034.md`; `ket_qua.md` của Task016; `CLAUDE.md` nguyên tắc 7 và 8.
