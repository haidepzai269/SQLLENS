# Kết quả Task037: kiểm tra bảo mật sandbox MySQL

Chạy ngày 2026-11-03 trên máy Azure thật (Linux, kernel 7.0, Docker 29.1.3, RAM 836 MiB, hai vCPU), chỉ qua SSH, chỉ vào phiên do chính cuộc kiểm tra tạo, gọi API agent từ trong máy (`127.0.0.1:8081`). Không động tới Render, Neon, Upstash, NSG, `ufw`, SSH. Nhãn: **Thật** (số đo từ lần chạy vừa rồi). Số dòng ở cột File là của commit gốc `9ba4639`.

Phạm vi kiểm: agent (xác thực, id, body, thời gian, cạn tài nguyên, đồng thời, log), `session.sh`, `seed.sh`, container, quyền của `sqllens_user`, cấu hình máy. Mã nguồn `api/**` chỉ đọc. Chưa có thành phần HTTPS nên chưa kiểm được lớp đó.

## Danh sách lỗi

| # | Mức | Tình trạng | Tóm tắt |
|---|---|---|---|
| F1 | Trung bình | Đã sửa | `KILL QUERY` không dừng được mọi câu, agent không có điểm dừng thứ hai |
| F2 | Trung bình | Đã sửa | Một dòng kết quả 60 MB làm agent chiếm 279 MB RAM |
| F3 | Thấp | Đã sửa | Người dùng tự đổi mật khẩu `sqllens_user`, khóa chính phiên của mình |
| F4 | Thấp | Đã sửa | `ORDER BY RAND()` trên tích Descartes làm mysqld chết vì hết RAM trong khoảng 1 giây |
| F5 | Thấp | Đã sửa một phần | SQL người dùng đẩy RAM chung của máy xuống 61 MiB trống |
| F6 | Thấp | Đã sửa | Script chạy bằng root nằm trong thư mục thuộc `azureuser` |
| F7 | Thông tin | Chưa sửa | `init.sql` (mật khẩu root phiên) vẫn đọc được trong container |
| F8 | Thấp | Chưa sửa, cần Gin | Người có token giữ được cả hai chỗ và đốt CPU liên tục |
| F9 | Thấp | `needs_validation` | Không giới hạn kết nối và không giới hạn tần suất cho yêu cầu chưa có token |
| F10 | Thông tin | Chưa sửa | Lô hàng trăm nghìn câu trả `connection_lost` (lỗi chức năng, không phải bảo mật) |

Mức độ theo mốc của skill: không có lỗi nghiêm trọng hay cao. Mọi thứ cần token thì ảnh hưởng nằm trong sandbox hoặc là từ chối dịch vụ.

### F1. `KILL QUERY` không dừng được mọi câu (Trung bình, đã sửa)

- **File:** `sandbox/agent/query.go:132` (timer chỉ gọi `m.kill`, dòng 169, một lần).
- **Tái hiện (trước khi sửa):** tạo thủ tục `spin2` có bốn `CONTINUE HANDLER` (cho 1317, SQLSTATE `70100`, `NOT FOUND`, `SQLWARNING`) và vòng `REPEAT SELECT SHA2(RAND(),256) INTO @x; UNTIL 0 END REPEAT`, rồi `CALL spin2()`. Agent gửi `KILL QUERY` sau 15 giây nhưng câu chạy tiếp: yêu cầu curl 40 giây không có phản hồi, `docker stats` cho mysqld 110% CPU, kết nối `a` báo 409 `connection_busy`. Không tái hiện được mọi lần: thủ tục không có hai handler cuối bị dừng bình thường, và hai trong bốn lần chạy lại với bản đầy đủ thì câu vẫn kẹt.
- **Tác động:** người dùng có token giữ trọn một vCPU của phiên mình mãi (trần `--cpus 1` mỗi phiên, hai phiên là cả máy) cho đến khi phiên hết hạn 15 phút hoặc bị xóa. Giới hạn 15 giây mà tài liệu Task035 hứa không đúng với trường hợp này. Chặn phiên khác nhận CPU của máy dùng chung.
- **Sửa:** `query.go` thêm `escalate`: sau `KILL QUERY` chờ `KillGrace` (5 giây), câu chưa trả về thì `Remove(s.id, "query_stuck")` (xóa container). Test `TestEscalateStuckQuery`.
- **Kiểm sau sửa (Thật):** bốn lần chạy `spin2`: hai lần dừng sau `KILL`, hai lần kẹt thì sau 20,1 giây yêu cầu trả `query_timeout`, log `event=query_stuck`, phiên bị hủy (lần gọi sau trả 404), không còn container.

### F2. Một dòng lớn làm agent phình RAM (Trung bình, đã sửa)

- **File:** `sandbox/agent/query.go:194` (chỉ kiểm cỡ **trước** khi đọc dòng kế), `sandbox/mysql-seed/my.cnf` (không đặt `max_allowed_packet`, mặc định 64 MiB). Đây là mục M6 `needs_validation` của Task035, nay đã chứng minh.
- **Tái hiện:** `SELECT REPEAT('a', 60000000)`. Agent từ RSS 12 MB lên đỉnh 279 MB (`VmHWM`), mất 10,5 giây, RAM trống của máy từ 357 xuống 184 MiB. Hai cột 33 MB mất 13 giây, đỉnh 305 MB.
- **Tác động:** một yêu cầu dùng 1/3 RAM máy. Chưa chạy bốn yêu cầu song song (hai phiên, hai kết nối) vì có thể làm hết RAM máy; suy ra bốn yêu cầu vượt 836 MiB là **chưa chạy thật**.
- **Sửa:** `my.cnf` đặt `max_allowed_packet=4M`. Biến này chỉ đọc ở mức session, người dùng không nâng lại được (kiểm: `SET SESSION max_allowed_packet=...` trả lỗi 1621).
- **Kiểm sau sửa (Thật):** `SELECT REPEAT('a', 5000000)` trả `NULL`, `REPEAT('a', 3000000)` trả đủ, đỉnh RSS agent 21,9 MB. `lowpriv.sh edge` in `max_allowed_packet=4194304`.

### F3. Người dùng tự đổi mật khẩu (Thấp, đã sửa)

- **File:** `sandbox/mysql-seed/session.sh:52`.
- **Tái hiện:** `SET PASSWORD = 'x'` chạy được. Kết nối hiện có vẫn dùng được, nhưng mọi kết nối mới (kết nối `b` chưa mở, hoặc mở lại sau `connection_lost`) bị từ chối vì `user.pw` không còn khớp.
- **Tác động:** chỉ phá phiên của chính người dùng. Không vượt ranh giới.
- **Sửa:** `CREATE USER ... PASSWORD REQUIRE CURRENT`; người dùng không biết mật khẩu hiện tại nên không đổi được. Kiểm sau sửa: lỗi 3892; `lowpriv.sh edge` có dòng deny mới.

### F4. `ORDER BY RAND()` trên tích Descartes giết mysqld (Thấp, đã sửa)

- **File:** `sandbox/mysql-seed/my.cnf` (không đặt `temptable_max_ram`, mặc định 1 GiB), `session.sh:65` (`--tmpfs /tmp` không có `size`).
- **Tái hiện:** bảng 2000 dòng, `SELECT * FROM n a, n b ORDER BY RAND()`: sau 1 giây `connection_lost`, mọi câu sau cũng lỗi (`dmesg`: `Memory cgroup out of memory: Killed process (mysqld)`).
- **Tác động:** chỉ phiên của người dùng chết, phiên còn lại giữ chỗ đến hết 15 phút.
- **Sửa:** `temptable_max_ram=2M`, `temptable_max_mmap=0`, `--tmpfs /tmp:size=64m`. Sau sửa: cùng câu trả lỗi 28 (`No space left on device`), mysqld sống, câu `SELECT 1` kế tiếp chạy.

### F5. SQL người dùng đẩy RAM chung xuống thấp (Thấp, đã sửa một phần)

- **File:** `session.sh:65` (`--memory 384m` mỗi phiên, hai phiên cộng phần máy dùng lớn hơn 836 MiB).
- **Tái hiện:** hai phiên, `SET SESSION max_heap_table_size=2000000000` rồi nạp bảng `MEMORY` từng bước 15 MB. RAM trống từ 173 xuống 61 MiB, một câu `INSERT` mất 26,6 giây (swap), rồi kernel giết chính mysqld của phiên đó vì vượt `--memory` (`CONSTRAINT_MEMCG`). Phiên nạn nhân sống sót. Tức là **chưa tái hiện được** việc kernel giết phiên của người khác.
- **Tác động đã chứng minh:** làm chậm cả máy (26 giây một câu) và tự giết phiên mình. Tác động giữa hai người dùng (hết RAM toàn máy, kernel chọn nạn nhân) là `needs_validation`, vì cần cả hai phiên cùng đẩy tới giới hạn.
- **Đã làm:** F4 bỏ hai đường đốt RAM không cần người dùng chỉnh biến. **Chưa sửa** phần còn lại vì bản chất là kích thước máy: `--memory` của các phiên cộng phần máy dùng (khoảng 230 MiB) vượt RAM. Chỉ cần ghi lại quy tắc (đã ghi ở `sandbox/agent/README.md`) và chọn `MEM` khi đổi sang B2als v2.

### F6. Script chạy bằng root nằm trong thư mục thuộc `azureuser` (Thấp, đã sửa)

- **File:** máy Azure `/opt/sqllens/mysql-seed/*` thuộc `azureuser:azureuser`, agent root gọi `session.sh` từ đó.
- **Tái hiện:** `ls -l /opt/sqllens/mysql-seed`.
- **Tác động:** `azureuser` đã có `sudo` không mật khẩu, nên không thêm ranh giới thật; chỉ là phòng thủ nhiều lớp (mất khóa SSH thì mất root, đằng nào cũng vậy).
- **Sửa:** `chown -R root:root /opt/sqllens` và cài file bằng `install -o root`. Ghi vào README của agent.

### F7. `init.sql` còn trong container (Thông tin, chưa sửa)

- **File:** `session.sh:66`, `:75` (`rm -f` trên máy chủ, nhưng bind mount giữ inode).
- **Tái hiện:** `docker exec <container> ls -l /init.sql` cho `-rw------- 35596 445 byte`, chứa `ALTER USER 'root'@'localhost' IDENTIFIED BY '<mật khẩu root>'`.
- **Tác động:** chỉ uid của mysqld đọc được, và `sqllens_user` không có `FILE`, `LOAD_FILE('/init.sql')` trả `NULL`. Nếu ai thoát được khỏi mysqld thì đã có cả socket nên lộ mật khẩu root không làm tệ hơn. Không sửa vì để `--init-file` đọc được thì mysqld phải đọc được file.

### F8. Giữ chỗ và đốt CPU liên tục bằng token (Thấp, chưa sửa, cần Gin)

- **File:** `sandbox/agent/manager.go:149` (mọi yêu cầu gia hạn `lastActive`), `server.go` (không có hạn mức theo người gọi).
- **Tác động:** người có token tạo đủ hai phiên rồi gọi lệnh mỗi vài phút để giữ vĩnh viễn, và mỗi câu được chạy 15 giây liên tục ở 100% một vCPU. B2ats v2 là máy burstable nên tín dụng CPU cạn thì bị hạ xuống mức nền. Đây là thiết kế (agent tin Gin). **Gin phải** giới hạn số phiên, thời gian sống và tần suất theo người dùng. Chưa chạy thật phần cạn tín dụng CPU.

### F9. Yêu cầu chưa có token (Thấp, `needs_validation`)

- **File:** `server.go:52` trả 401 trước khi đọc body; `main.go:192` có `ReadHeaderTimeout` và `ReadTimeout`; không có giới hạn kết nối đồng thời, không giới hạn tần suất, không khóa theo IP.
- **Đã chạy thật (Thật):** token 46 ký tự chữ-số; thiếu token, token sai, `bearer` thường, token trong query, `Basic`, đường dẫn `//healthz`, body 5 MB không token: đều 401 (chỉ `/healthz` trả 200). 3000 yêu cầu không token trong 12 giây (song song 100): agent giữ RSS khoảng 12 MB, 6 fd, vẫn trả `/healthz` 200. So sánh token bằng SHA-256 và `ConstantTimeCompare`. Một yêu cầu 401 ghi một dòng log, nhưng log không có SQL, token hay IP.
- **Chưa chạy được:** tải thật qua HTTPS (bắt tay TLS tốn CPU trên máy 2 vCPU burstable), vì lớp HTTPS chưa có.

### F10. Lô nhiều câu trả `connection_lost` (Thông tin, chưa sửa)

- 190.000 câu `DO 1;` hoặc 100.000 câu `SELECT 1;` (dưới 1 MiB) trả 502 `connection_lost` sau 0,1 đến 0,8 giây. Không ảnh hưởng bảo mật, nhưng làm mất kết nối (và transaction đang mở). Chưa tìm nguyên nhân (nghi driver hoặc `max_allowed_packet`). Đưa vào Phát sinh.

## Đã kiểm và không có lỗi

- **Xác thực:** xem F9. Mọi route khác `/healthz` cần token; đường dẫn lạ cũng 401 khi không token; id sai dạng và id lạ cùng 404.
- **Body:** 1 MiB + 1 byte trả 413 (`maxBody`); trường lạ hoặc `connection` ngoài `a|b` trả 400.
- **Trần phiên:** 12 yêu cầu tạo phiên đồng thời cho 2 lần 201 và 10 lần 429, hai container.
- **Thời gian chờ:** `BENCHMARK(1e11,MD5('x'))`, `GET_LOCK` hai kết nối, chờ khóa dòng khi người dùng đặt `innodb_lock_wait_timeout=100000`, CTE đệ quy vô hạn (trúng hạn mức đĩa sau 11,6 giây): đều dừng đúng hạn hoặc bị hủy.
- **Đĩa:** nhân đôi bảng bằng `INSERT ... SELECT` đến khi phiên bị hủy: đỉnh 521 MiB, trả `session_disk_quota`, thư mục và container biến mất.
- **Rò rỉ:** token trong journal, `environ` và `cmdline` của agent: 0 lần khớp. Dấu hiệu `SECRETMARKER` trong câu đúng và câu lỗi: 0 lần trong journal agent, `docker logs`, thư mục phiên, syslog. Mật khẩu phiên trong `docker inspect`, `docker logs`, `ps`: 0 (`lowpriv.sh ac4`). Chỉ có dấu hiệu trong lệnh curl của chính cuộc kiểm (không phải của agent).
- **Quyền file:** `/etc/sqllens-agent/token` 600 root; thư mục phiên 700 root; `root.pw`, `user.pw` 600 root; `sessions` 711.
- **Container:** không privileged, `--cap-drop ALL` (`CapEff=0`, `CapBnd=0`), `NoNewPrivs=1`, `Seccomp=2`, rootfs chỉ đọc, `--network none` (chỉ có `lo`), `--pids-limit 200`, `--cpus 1`, `--memory 384m` không swap, không thiết bị, không cổng publish, mount chỉ có `data` và `init.sql`. Không có `docker.sock` hay thư mục máy chủ nào khác.
- **MySQL:** `INSTALL PLUGIN`, `CREATE FUNCTION ... SONAME`, `INSTALL COMPONENT`, `CREATE TABLE ... DATA DIRECTORY`, `CREATE TABLESPACE`, `FEDERATED`, `SELECT ... INTO DUMPFILE`, `SET GLOBAL`, `SET PERSIST`, `SHUTDOWN`, `CREATE USER`, `FLUSH PRIVILEGES`, `USE mysql`, `SELECT mysql.user`, `performance_schema.threads`, `SHOW ENGINE INNODB STATUS`, `SHOW BINARY LOGS`: đều bị từ chối. Procedure/trigger/view với `DEFINER=root` và `CALL` đọc `mysql.user` bị từ chối (`lowpriv.sh edge`). `SHOW GRANTS` chỉ có `USAGE ON *.*` và quyền trên `app.*`. `LOAD_FILE` trả NULL.
- **Máy:** chỉ nghe ngoài `22` (SSH); `8081` chỉ loopback; `containerd` chỉ loopback. SSH chỉ khóa, không mật khẩu, không root (`sshd -T`), `ufw` mở `22`. `x11forwarding yes` và `allowtcpforwarding yes` là mặc định, chưa đổi vì ngoài phạm vi. `azureuser` không thuộc nhóm `docker`.

## Kết luận: mở cổng cho Render

**Chưa mở ngay. Có thể mở sau khi làm đủ các việc dưới, và chỉ với các giả định ghi rõ.**

Với bản đã sửa trong task này, những gì đã đo cho thấy:

- **Kẻ cùng dải IP Render, không token:** chỉ gọi được `/healthz` (trả `{"status":"ok"}`) và nhận 401 cho mọi thứ khác. Không tạo được phiên, không đọc gì. Có thể làm tốn CPU và log bằng yêu cầu rác. Khả năng đoán token: token 46 ký tự chữ-số, không giới hạn số lần thử nhưng không khả thi nếu token ngẫu nhiên thật (chưa kiểm cách sinh).
- **Nếu lộ token:** kẻ tấn công chạy SQL tùy ý trong sandbox (đúng thiết kế), chiếm hai chỗ và đốt CPU, làm máy chậm, tự giết phiên mình. Không thấy đường ra khỏi container hay sang phiên khác trong những gì đã thử. Không tạo được tài nguyên ngoài hai phiên.

**Phải làm trước khi mở:**

1. Dựng lớp HTTPS (STR019) rồi **kiểm bảo mật lớp đó**: task này chưa có gì để kiểm. Chứng chỉ tự ký phải được Gin ghim; không chấp nhận bỏ qua kiểm tra chứng chỉ.
2. Token mới sinh bằng nguồn ngẫu nhiên mạnh, đã ghi lại cách xoay (đổi token cần khởi động lại agent, mất phiên đang chạy).
3. Gin giới hạn theo người dùng: số phiên, thời gian sống, tần suất yêu cầu (F8). Agent không làm việc này.
4. NSG chỉ cho dải IP Render Singapore (chủ dự án làm, ngoài phạm vi task) và có giới hạn kết nối ở lớp HTTPS (F9).
5. Triển khai lại bản agent đã sửa (đã cài lên máy trong task này).

**Giả định:** Docker, kernel và `mysql:8.4.13` chưa có lỗ hổng thoát container chưa vá; token chỉ nằm ở Render và máy Azure; Gin không ghi SQL.

**Chưa kiểm:** lỗ hổng của kernel, runc, mysqld (0-day); cạn tín dụng CPU của B2ats v2; hai phiên cùng làm nóng RAM đến mức OOM toàn máy; tải thật qua HTTPS; thoát khỏi mysqld sau khi đã có thực thi mã (cần lỗ hổng mysqld); `api/**` chưa gọi agent thật; NSG và cấu hình Azure thật (không được đụng).

## Việc đã kiểm lại sau khi sửa

Trên máy Azure, với agent và script mới: `lowpriv.sh` ac1, ac2, ac3, ac4, ac5, edge đều thoát 0, không dòng FAIL. Qua API: tạo phiên 3,4 giây; kết quả bị cắt đúng 10.000 dòng; chờ khóa giữa `a` và `b` thấy trong `/locks`; khởi động lại agent làm phiên cũ trả 404 và không còn container hay thư mục; ba lần tạo cho 201, 201, 429. Cuối cùng 0 container, 0 thư mục phiên, agent vẫn `active`.

Các lệnh tái hiện nằm trong lịch sử làm việc; để chạy lại cần token và quyền root trên máy Azure, ví dụ F1: tạo phiên, tạo `spin2`, `CALL spin2()`, đo thời gian trả về.
