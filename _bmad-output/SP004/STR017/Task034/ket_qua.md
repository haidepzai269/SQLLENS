# Kết quả Task034: thư mục dữ liệu MySQL dựng sẵn

Đo ngày 2026-11-03 trên máy Azure `Standard_B2ats_v2` (836 MiB RAM, đĩa 29 GB, 1 GiB swap), image `mysql:8.4.13`, cấu hình `my.cnf` của Task015 truyền bằng tham số mysqld. Nhãn: **Thật**, số đo của máy này. Thời gian là của máy đo, không phải dự đoán cho production.

## Cách làm và lý do

Chọn **thư mục mẫu được sao chép cho mỗi phiên**, không dùng image riêng.
- Image riêng đặt dữ liệu vào lớp ghi của Docker, khó cho mỗi phiên một thư mục và một uid riêng. Thư mục mẫu cho phép bind mount một thư mục riêng, quyền 700, uid riêng.
- `seed.sh build` chạy `mysqld --initialize-insecure` một lần (container không mạng, không capability). Root không mật khẩu chỉ tồn tại trong bản mẫu và chỉ vào được qua socket trong container. Xóa `auto.cnf` để mỗi phiên tự sinh `server_uuid`. Sau đó bản mẫu thuộc root, bỏ quyền ghi, kèm `SHA256SUMS`.
- `session.sh create`: kiểm bản mẫu bằng SHA256 (từ chối nếu thiếu, thừa hoặc sai file), kiểm đĩa, `cp -a` bản mẫu, chọn uid ngẫu nhiên từ 20000 đến 59999, sinh mật khẩu 24 byte ngẫu nhiên, ghi `init.sql` (`ALTER USER root@localhost`) mount chỉ đọc, chạy `mysqld --init-file`, chờ nhận kết nối rồi xóa `init.sql`. Mật khẩu chỉ nằm trong file `pw` (quyền 600, root, ngoài thư mục dữ liệu). Client dùng `--defaults-extra-file=/dev/stdin`, không qua biến môi trường hay dòng lệnh.
- Container: `--entrypoint mysqld --user <uid>`, `--network none --read-only --cap-drop ALL`, không thêm capability nào (Task015 thêm 5 cái cho entrypoint, ở đây không cần vì bỏ entrypoint), `--security-opt no-new-privileges`, `--memory 384m --memory-swap 384m --cpus 1 --pids-limit 200`.

## Dung lượng (AC5)

| | MiB |
|---|---:|
| Bản mẫu (168 file) | 103 |
| Phiên mới ngay sau khởi động | 117 (thêm khoảng 14 so với mẫu: redo log, undo, ibtmp, log) |
| Phiên sau bảng 10k dòng có index | 126 |

Mỗi phiên cần chỗ trống ít nhất gấp đôi bản mẫu cộng 1 GiB (`session.sh` từ chối nếu thiếu). Sao chép là `cp -a`, ext4 không có reflink nên mỗi phiên tốn trọn 103 MiB.

## AC1: thời gian từ lúc tạo phiên đến khi nhận kết nối

"Sẵn sàng" tính từ lúc script bắt đầu (gồm kiểm SHA256 bản mẫu và sao chép) đến lúc `SELECT @@skip_networking` trả 0, cùng tiêu chí với Task018.

Một phiên, 5 lần: 2.872, 3.127, 2.752, 2.738, 3.233 ms. Trung vị **2,87 giây** (phần chuẩn bị gồm kiểm và sao chép: trung vị 0,56 giây). Ba lần đo ở lượt chạy khác: 4.194, 3.049, 2.893 ms.

Hai phiên khởi động cùng lúc, 5 lần:

| Lần | Phiên 1 (ms) | Phiên 2 (ms) |
|---:|---:|---:|
| 1 | 20.004 | 20.006 |
| 2 | 16.441 | 13.981 |
| 3 | 14.082 | 14.088 |
| 4 | 11.224 | 11.226 |
| 5 | 12.335 | 12.329 |

Trung vị của 10 số: 14,0 giây. Lần 1 chậm nhất, chạy ngay sau lượt đo một phiên khi cache còn nguội (chưa kiểm là nguyên nhân).

So với Task018:

| | Task018 (khởi tạo lúc chạy) | Task034 (bản mẫu) |
|---|---:|---:|
| 1 phiên, trung vị | 16,2 giây | 2,87 giây |
| Phiên thứ hai | 48,6 đến 51,8 giây | 11,2 đến 20,0 giây (hai phiên khởi động cùng lúc) |

Hai ô phiên thứ hai không cùng kịch bản: Task018 khởi động phiên 2 khi phiên 1 đang giữ khóa, dòng này đo hai phiên khởi động cùng lúc trên máy rảnh. Số đo cùng kịch bản nằm ở AC2.

## AC2: tăng dần số phiên, mỗi phiên giữ khóa

Cùng cách và cùng điều kiện dừng với Task018 AC3 (bảng 10k dòng, hai connection, B chờ A, `data_lock_waits` = 1 ở mọi phiên).

| Lần đo | n | Sẵn sàng (ms) | RAM trống sau | Swap máy (MiB) | Tổng RAM container (MiB) |
|---|---:|---:|---|---:|---:|
| 1 | 1 | 2.678 | 329 MiB (39%) | 141 | 273 |
| 1 | 2 | 14.266 | 150 MiB (17%) | 193 | 519 |
| 2 | 1 | 4.457 | 336 MiB (40%) | 143 | 271 |
| 2 | 2 | 11.874 | 145 MiB (17%) | 195 | 512 |
| 3 (bỏ điều kiện thời gian) | 1 | 4.186 | 370 MiB (44%) | 155 | 285 |
| 3 | 2 | 11.881 | 155 MiB (18%) | 199 | 512 |

- Hai lần đầu dừng ở n=2 vì thời gian sẵn sàng gấp 2,6 đến 3,2 lần phiên đầu. Không có OOM.
- Lần 3 đặt `IGNORE_TIME=1` để xem giới hạn RAM. Script dừng **trước** n=3 vì lưới an toàn do tôi đặt (RAM trống 149 MiB, dưới 150 MiB). **Phiên thứ ba chưa được thử**, nên không biết nó chạy được hay không. Sau phiên 2, RAM trống 17 đến 18% vẫn trên ngưỡng 15% của Task018, còn mỗi phiên dùng khoảng 250 đến 290 MiB (tổng RAM container ở bảng chia hai).
- **Số phiên tối đa theo điều kiện dừng: 2**, bằng Task018. Phiên đầu nhanh gấp 4 đến 6 lần, phiên thứ hai chờ 11 đến 14 giây thay vì 49 đến 52 giây. Chưa tách nguyên nhân phiên thứ hai chậm (RAM bị ép sang swap, page cache hay CPU credit).

## AC3: cô lập giữa các phiên

Hai phiên x, y từ cùng bản mẫu:
- Mật khẩu root khác nhau. Mật khẩu của y bị x từ chối (`ERROR 1045`), mật khẩu rỗng cũng bị từ chối.
- `docker inspect` của cả hai: 0 lần chứa mật khẩu. `docker logs`: 0 lần. Dòng lệnh tiến trình trên máy lúc `session.sh exec` đang chạy: 0 lần.
- Sau khởi động `init.sql` bị xóa, thư mục phiên chỉ còn `data` và `pw`.
- Tạo database `dx` ở x: x thấy, y không thấy. `seed.sh verify` vẫn đúng sau đó, và phiên mới z cũng không thấy `dx`.
- Hai thư mục dữ liệu có uid khác nhau (ví dụ 30515 và 38712), quyền 700.

## AC4: kịch bản Task016 trên phiên từ bản mẫu

Chương trình Go của Task016 chạy với cờ mới `-attach` vào một phiên tạo bằng `NET=loopback PORT=33161 session.sh create s --innodb-lock-wait-timeout=8` (bind `127.0.0.1`, thêm user `root` từ mọi host với cùng mật khẩu ngẫu nhiên; chỉ dùng cho phép thử này). Thoát mã 0, mỗi kịch bản **5/5 lần giống nhau**, giống kết luận của Task018 AC4:
- Lock wait: B chờ A, `RECORD X,REC_NOT_GAP` trên `lab.acct` index `PRIMARY`.
- Deadlock: đúng một bên nhận lỗi 1213.
- Dirty read: `READ UNCOMMITTED` đọc 999, `READ COMMITTED` đọc 100.
- Lost update ở `REPEATABLE READ`: kết quả cuối 120.
- Gap lock: `X,GAP` tại khóa 20, INSERT 15 chờ với `X,GAP,INSERT_INTENTION`.
- User quyền thấp đọc `performance_schema`: từ chối 1142/1142/1227.
- Timeout: lỗi 1205 sau 8 giây.

## Ca biên

- Sửa 1 byte `ibdata1` của bản mẫu: `seed.sh verify` thoát 1, `session.sh create` thoát 1 và không để lại container hay thư mục. `REBUILD=1 seed.sh build` dựng lại, verify đúng.
- Đĩa còn 500 MiB: `create` thoát 3 với thông báo, không để lại gì.
- `destroy` sau 2,5 giây khi `create` đang khởi động: `create` thoát 1 ("container chết lúc khởi động"), 0 container, 0 thư mục.
- Tên trùng thoát 2, tên có `../` thoát 2, `destroy` chạy hai lần không lỗi, `seed.sh build` chạy ba lần liên tiếp không lỗi (hai lần sau bỏ qua).
- Khi dựng bản mẫu MySQL cảnh báo redo log 16M nhỏ (`innodb_redo_log_capacity`), không ảnh hưởng kết quả.

## AC6: đề xuất cho SP004

- **Trần phiên cùng lúc trên máy 1 GB: 2.** Giữ nguyên Task018, vì phiên 3 chưa được thử và RAM trống chỉ còn 17 đến 18% sau phiên 2. Muốn nhiều hơn thì đổi B2als v2 (4 GB) rồi chạy lại `bench.sh capacity`.
- **Khởi động tuần tự, mỗi lần một phiên.** Phiên đầu sẵn sàng sau khoảng 3 giây. Khi đã có phiên khác chạy, phiên mới chờ khoảng 11 đến 14 giây.
- **Không cần giữ sẵn container chờ.** Phiên đầu chỉ mất 3 giây, còn một container chờ tốn khoảng 250 MiB, tức một nửa trần 2 phiên trên máy này. Container chờ chỉ đáng xem lại nếu 11 đến 14 giây của phiên thứ hai là không chấp nhận được, hoặc trên máy 4 GB.
- Sandbox agent phải tự giữ mật khẩu phiên (bộ nhớ hoặc file quyền 600) vì script không in ra.

## AC7: dọn dẹp

Đã xóa hết container, `/var/lib/sqllens` (bản mẫu và phiên) và thư mục thử. Kiểm lại: 0 container, 0 volume, máy vẫn chạy. Image `mysql:8.4.13` còn trên máy.

## Chưa làm hoặc chưa kiểm

- Phiên thứ ba chưa thử trên máy 1 GB.
- Chưa tách nguyên nhân phiên thứ hai chậm.
- Chưa kiểm hai lệnh `create` cùng tên chạy đồng thời (không có khóa).
- Cô lập giữa phiên chỉ kiểm bằng uid, quyền thư mục và `--network none`. Chưa thử tấn công từ SQL (role quyền thấp là việc của STR018).
