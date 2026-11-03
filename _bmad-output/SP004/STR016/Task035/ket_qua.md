# Kết quả Task035: sandbox agent

Chạy thật trên máy Azure ngày 2026-11-03, `mysql:8.4.13`, RAM 836 MiB. Nhãn: **Thật** (số đo từ máy vừa chạy). Thời gian đo trong sandbox, không phải dự đoán cho production.

## Thiết kế đã chọn

- Agent Go (`sandbox/agent`), chạy root dưới systemd vì cần docker và đọc mật khẩu phiên. Chỉ nghe `127.0.0.1:8081`, từ chối địa chỉ khác lúc khởi động. Không đổi NSG, `ufw`.
- Tạo và hủy phiên gọi `session.sh create|destroy` (không sửa script). SQL người dùng đi qua driver `go-sql-driver/mysql` v1.9.3, không qua client `mysql`.
- Kết nối: container chạy `--network none`, socket nằm trong tmpfs của container. Agent dial `/proc/<pid container>/root/run/mysqld/mysqld.sock` (root ở máy chủ vào được, `docker inspect` lấy pid). Không cần mở mạng hay sửa script.
- Kết nối `a` và `b`: mỗi cái một `sql.Conn` ghim suốt phiên, nên transaction mở dở còn giữa các yêu cầu. Mỗi kết nối chạy một câu một lúc; yêu cầu thứ hai trên cùng kết nối trả 409 `connection_busy`.
- Cắt câu lâu: timer 15 giây gọi `KILL QUERY <id>` bằng root (không dùng context của driver vì nó đóng cả kết nối). Áp cho mọi loại câu. `SLEEP()` bị KILL vẫn trả 1 không lỗi, nên cờ timeout quyết định, không dựa vào lỗi.
- Hạn mức đĩa: **512 MiB mỗi phiên** (đo theo block thật của thư mục phiên, gồm bản mẫu khoảng 117 MiB), janitor kiểm mỗi 1 giây, vượt thì hủy phiên (container, thư mục) và câu đang chạy trả `session_disk_quota`. Hai phiên tối đa khoảng 1 GiB cộng phần vượt trong 1 giây (đĩa 29 GB). Đổi bằng `DISK_LIMIT_MB`.
- AC4 chọn: dọn sạch. Lúc khởi động agent hủy mọi container nhãn `sqllens.session` và mọi thư mục trong `SESS_ROOT`, phiên cũ trả 404. Lý do: kết nối và transaction đã mất khi agent chết, và mật khẩu root không dùng lại được.
- Phiên hết hạn sau 15 phút không dùng (`IDLE_TTL_SEC`), mỗi yêu cầu có hiệu lực gia hạn. Slot chỉ được trả sau khi container biến mất.

## AC

- AC1 đạt. Tạo phiên **2.886 ms** (lần đầu), 3.926 ms và 4.322 ms ở các lần sau. `CREATE TABLE`, `INSERT` (affectedRows 2), `SELECT` trả đúng `[[1,"a"],[2,"b"]]`, rồi `DELETE` 204 (2,2 giây khi đang có câu chạy).
- AC2 đạt. Ba `POST /sessions` cùng lúc: hai 201 (3,9 giây và 16,9 giây, tức khởi động nối tiếp, phiên thứ hai chậm như Task034 đã ghi), một 429 `sandbox_full` sau 22 ms. Yêu cầu thứ tư cũng 429. RAM trống còn 168 MiB với hai phiên, không OOM. Test Go kiểm số lần `create` chạy chồng nhau tối đa là 1.
- AC3 đạt. `IDLE_TTL_SEC=20`: gọi lại ở giây 8 thì gia hạn; sau 23 giây không dùng container và thư mục biến mất, yêu cầu tiếp theo 404.
- AC4 đạt theo cách đã chọn. Restart agent khi có một phiên sống: container và thư mục bị dọn, phiên cũ 404. `kill -9` agent: systemd chạy lại sau dưới 5 giây, phiên sót được dọn.
- AC5 đạt. Thiếu token, sai token, token ngắn hơn: 401, thân giống nhau dù id có thật hay không. Token đúng với id lạ hoặc sai dạng: 404 cùng một thân. `/healthz` không đòi token và không lộ số phiên.
- AC6 đạt. `a`: `START TRANSACTION; UPDATE t ... id=1`; `b` (chạy nền): `UPDATE` cùng dòng bị chặn. `GET /locks` thấy `waits`: `11` chờ `10`, `RECORD X,REC_NOT_GAP` trên `t` index `PRIMARY`; `locks` có `GRANTED` của `a` và `WAITING` của `b`. Sau `COMMIT` ở `a`, `b` xong với affectedRows 1. Cùng kết quả với Task016.
- AC7 đạt. Sau `SET SESSION max_execution_time = 0`: `SELECT SLEEP(100)` bị cắt sau 15 giây với 422 `query_timeout`, kết nối vẫn dùng được. `UPDATE` 524.288 dòng có `WHERE SLEEP(0.01)=0` cũng cắt sau 15 giây, dữ liệu còn nguyên (UPDATE được rollback). `SELECT *` trên 524.288 dòng trả đúng 10.000 dòng và `truncated: true`. Body 1,1 MB: 413 `body_too_large`. Hạn mức đĩa: thử với `DISK_LIMIT_MB=160`, nhân đôi bảng đến lần thứ 17 thì phiên bị hủy (`reason=disk_quota`), câu đang chạy trả 422 `session_disk_quota`, container và thư mục biến mất, đĩa trống về lại như trước.
- AC8 đạt. Log journal của agent (131 dòng, gồm cả các câu chứa `zz_marker_*`, `SELECT`, `CREATE TABLE`, câu lỗi cú pháp): 0 dòng có nội dung SQL. Mỗi dòng chỉ có `event=`, id rút gọn 6 ký tự, mẫu route, mã trả về, ms. `go vet ./...` và `go test ./...` thoát 0.
- AC9 đạt. `systemctl enable --now sqllens-agent`, `Restart=always`, `kill -9` được chạy lại. Cuối cùng 0 container, 0 thư mục phiên, RAM trống 600 MiB, máy vẫn chạy. Agent vẫn đang chạy như service (chỉ loopback), token ở `/etc/sqllens-agent/token` quyền 600.

## Giới hạn đã biết

- Lô nhiều câu: kết quả đầu là `OK` (không có cột) của lô bị driver bỏ qua; `affectedRows` chỉ có cho kết quả cuối khi nó không có cột. Một câu lỗi giữa lô thì trả lỗi, không trả kết quả các câu trước (các câu đó đã chạy).
- Số nguyên quá 2^53 trả dạng chuỗi. Dữ liệu nhị phân không hợp lệ UTF-8 bị thay bằng U+FFFD.
- Agent chạy root. systemd bật `NoNewPrivileges`, `ProtectSystem=strict` (ghi được `/var/lib/sqllens`), `ProtectHome`, `PrivateTmp`.
