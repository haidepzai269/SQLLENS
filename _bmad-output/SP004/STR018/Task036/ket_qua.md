# Kết quả Task036: tài khoản quyền thấp cho phiên MySQL

Đo ngày 2026-11-03 trên máy Azure `Standard_B2ats_v2` (836 MiB RAM), `mysql:8.4.13`, bản mẫu Task034. Nhãn: **Thật**. Script kiểm: `sandbox/mysql-seed/lowpriv.sh` (mỗi AC một lệnh con).

## Quyền đã cấp cho `sqllens_user`@`localhost`

Không có quyền toàn cục (`GRANT USAGE ON *.*`). Trên `app.*`:

| Quyền | Lý do |
|---|---|
| SELECT, INSERT, UPDATE, DELETE | đọc ghi dữ liệu, `FOR UPDATE`, `EXPLAIN ANALYZE` |
| CREATE, DROP, ALTER, INDEX | bảng, index |
| REFERENCES | khóa ngoại |
| CREATE VIEW, SHOW VIEW | view |
| CREATE TEMPORARY TABLES | bảng tạm |
| LOCK TABLES | `LOCK TABLES` |
| TRIGGER | trigger |
| CREATE ROUTINE, ALTER ROUTINE, EXECUTE | procedure, function |

Không cấp: FILE, PROCESS, SUPER, CONNECTION_ADMIN, SET_ANY_DEFINER, CREATE USER, GRANT OPTION, EVENT (không cần cho người học, event chạy nền ngoài phiên), mọi quyền trên `mysql.*`, `performance_schema.*`. Thêm `MAX_USER_CONNECTIONS 6` để user không dùng hết 20 kết nối (`max_connections=20`) và khóa root ngoài.

## AC1: bị từ chối (mỗi câu chạy thật dưới `sqllens_user`)
- `performance_schema.data_locks`, `data_lock_waits`, `mysql.user`: 1142.
- `SELECT ... INTO OUTFILE`: 1227 (thiếu FILE). `LOAD DATA INFILE`: 1045. `LOAD DATA LOCAL INFILE`: 3948 (`local_infile=OFF`).
- `LOAD_FILE('/etc/passwd')`: **không báo lỗi, trả NULL** (`secure_file_priv=NULL` cộng không có FILE). Đây là cách MySQL từ chối của hàm này.
- `SET GLOBAL`, `SET PERSIST`: 1227. `CREATE USER`: 1227. `GRANT` toàn cục, FILE, trên `mysql.*`: 1045 hoặc 1044.
- `SHOW PROCESSLIST` và `information_schema.processlist`: 0 dòng của root (user chỉ thấy luồng của mình). `KILL` và `KILL QUERY` kết nối root: 1095 "not owner", kết nối root vẫn sống.

## AC2: chạy được
Tất cả 18 mục đều OK: CREATE TABLE (có khóa ngoại), CREATE INDEX, ALTER TABLE, INSERT, UPDATE, DELETE, SELECT JOIN, BEGIN/COMMIT, BEGIN/ROLLBACK, SELECT FOR UPDATE, EXPLAIN, EXPLAIN ANALYZE, SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED, view, bảng tạm, LOCK TABLES, procedure, trigger, DROP.

## AC3: kịch bản Task016 với hai kết nối `sqllens_user`, kết nối đọc `performance_schema` là root
5 lần chạy, 5 lần giống từng byte:
```
lock wait: data_lock_waits=1 | X,REC_NOT_GAP PRIMARY
deadlock: số bên nhận lỗi 1213=1
dirty read: READ UNCOMMITTED=999 READ COMMITTED=100
lost update: kết quả cuối=120
gap lock: giữ=X,GAP  chờ=X,GAP,INSERT_INTENTION
```
Giống Task016. Kịch bản viết lại bằng shell (`docker exec`), không dùng chương trình Go.

## AC4: hai phiên
Mật khẩu root khác nhau, user khác nhau, root và user cùng phiên khác nhau. File quyền 600 chủ root. `sqllens_user` của A vào phiên B: 1045. Mật khẩu xuất hiện 0 lần trong `docker inspect`, `docker logs` và `ps -eo args` lúc client đang chạy.

## AC5: `information_schema`
Dưới `sqllens_user`, `SHOW DATABASES` và `information_schema.schemata` chỉ hiện `app`, `information_schema`, `performance_schema`. Vẫn thấy: `information_schema` (78 bảng, nội dung lọc theo quyền), tên 8 bảng trong `performance_schema` (không đọc được nội dung các bảng nhạy cảm; chưa thử đọc từng bảng còn lại). Không thấy `mysql`, `sys`. `SHOW GRANTS` đúng bảng quyền ở trên; quyền toàn cục chỉ `USAGE`.

## AC6: thời gian khởi động (một phiên, 5 lần)
2.920, 2.862, 2.914, 2.685, 2.558 ms, trung vị 2,86 giây. Task034: 2,87 giây. Không tăng.

## AC7
`seed.sh verify`: "bản mẫu đúng". Dọn máy: xem cuối file.

## Ca biên
- `CREATE PROCEDURE ... SQL SECURITY DEFINER` được tạo (definer là chính user), `CALL` đọc `mysql.user` vẫn 1142: không lên quyền.
- `CREATE DEFINER='root'@'localhost'` cho procedure và trigger: 1227 (cần SET_ANY_DEFINER). View với definer root: 1142.
- `CREATE EVENT`: 1044.
- `max_execution_time`: đặt `--max-execution-time=30000` (30 giây) làm mặc định máy chủ. `SELECT SLEEP(40)` bị ngắt sau 30 giây. Giới hạn chưa phải rào chắn: (1) user chạy `SET SESSION max_execution_time=0` được; (2) chỉ áp cho `SELECT` chỉ đọc, `UPDATE`/`INSERT ... SELECT` chạy lâu không bị giới hạn. Sandbox agent (Task035) phải tự hủy bằng root (`KILL QUERY`) khi quá hạn.
- 7 kết nối đồng thời của user: kết nối thứ 7 bị 1226.

## Chưa làm hoặc chưa kiểm
- `sqllens_user` chỉ có `@localhost` (kết nối qua `docker exec` trong container). Task035 quyết định cách đi vào container; nếu qua TCP phải tạo thêm host và mở mạng.
- Không có giới hạn CPU/bộ nhớ theo câu, chỉ giới hạn cả container (`--memory 384m --cpus 1`).
- Chưa thử các bảng `performance_schema` ngoài `data_locks`, `data_lock_waits`.
