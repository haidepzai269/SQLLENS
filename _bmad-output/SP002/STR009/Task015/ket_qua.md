# Task015: kết quả đo container MySQL

Đo ngày 2026-11-02. Số liệu thô: `ket_qua_tho.txt`, `ket_qua_tho_tinh_chinh.txt`. Lệnh: `cd spikes/mysql-container && ./measure.sh`.

## Máy đo và image

- Windows 11, Docker Desktop 27.5.1 (amd64), 12 CPU, 5,8 GiB RAM cấp cho Docker.
- Trong lúc đo có Task016 (MySQL khác) và task Playwright chạy song song trên cùng máy. Thời gian khởi động dao động 6,5 đến 10,7 giây giữa các lượt vì tải máy, nên chỉ đọc là thứ tự độ lớn.
- Image: `mysql:8.4.6` (MySQL 8.4 LTS), id `sha256:869218921e61`. Kiểm arm64 bằng `docker buildx imagetools inspect mysql:8.4.6`: manifest list có `linux/amd64` và `linux/arm64/v8` (`sha256:6752fee1...`). Chưa chạy thử trên ARM.
- Container: `--memory N --memory-swap N --cpus 1 --pids-limit 200 --network none --read-only --tmpfs /tmp --tmpfs /run/mysqld --security-opt no-new-privileges --cap-drop ALL` cộng 5 capability `CHOWN SETUID SETGID DAC_OVERRIDE FOWNER`.
  - Thử `--cap-drop ALL` không thêm gì: lỗi `setgid: Operation not permitted`, entrypoint không chuyển được sang user `mysql`. Chưa thử bớt từng capability trong 5 cái (xem Phát sinh).
  - `--network none` vẫn dùng được: client chạy bằng `docker exec` qua unix socket. Không cần mạng thay thế. Vì vậy không có cổng 33150 nào được mở. Nếu agent SP004 cần TCP từ host thì dùng network `--internal` và không publish cổng.
- `my.cnf` được đổi thành tham số dòng lệnh `mysqld` trong `measure.sh`. Lý do: bind mount từ Windows cho file quyền 0777 và mysqld in `World-writable config file ... is ignored`, cấu hình bị bỏ im lặng (lần đo đầu cho RAM giống hệt mặc định, 432,7 MiB, nhờ đó mới phát hiện). Trên Linux có thể mount file `:ro` như thường.

## AC1: thời gian khởi động (5 lần, `my.cnf`, `--memory 512m`)

"ping" là từ `docker run` đến khi `mysqladmin ping` thành công (đúng AC). Server tạm của entrypoint cũng trả lời ping nhưng chạy `skip_networking=1`, nên có thêm cột "ready" là lúc server thật đã nhận kết nối (`@@skip_networking=0`). Phiên thật phải chờ "ready". Thời gian gồm khởi tạo thư mục dữ liệu mới, đây là khởi động lạnh. Bước thăm dò là `docker exec` mỗi 0,2 giây nên sai số khoảng 0,3 giây.

| Lần | ping (ms) | ready (ms) |
|---:|---:|---:|
| 1 | 10662 | 18932 |
| 2 | 10374 | 17600 |
| 3 | 10672 | 17904 |
| 4 | 9377 | 17128 |
| 5 | 8474 | 15421 |
| Trung vị | 10374 | 17600 |
| Lớn nhất | 10672 | 18932 |

Lượt phụ (AC3, AC4 ở `--memory` đủ) chạy sau, nhanh hơn: ping 6,6 đến 8,3 giây, ready 12,8 đến 14,7 giây. Khả năng cao do tải máy giảm, chưa kiểm chứng. Con số an toàn để lập kế hoạch: khoảng 20 giây tới "ready" khi khởi động lạnh. Nếu SP004 cần nhanh hơn, hướng là tạo sẵn thư mục dữ liệu đã khởi tạo, ngoài phạm vi task này.

## AC2: RAM (`docker stats`, MiB, `--memory 512m`, `my.cnf`)

Đo 5 lần. Chờ 5 giây sau "ready" mới đo nhàn rỗi.

| Mốc | Khoảng 5 lần | Lượt đại diện (lần 1) |
|---|---:|---:|
| Nhàn rỗi | 238,7 đến 244,7 | 244,2 |
| Sau bảng 10.000 dòng có index | 253,1 đến 259,1 | 255,5 |
| Sau 2 connection cùng giữ khóa | 255,9 đến 261,9 | 258,8 |

Lượt giữ khóa: connection A khóa dòng `id=1`, connection B khóa `id=2` rồi chờ `id=1`. `performance_schema.data_lock_waits` có 1 dòng ở cả 5 lượt, nên `performance_schema` hoạt động, cấu hình đủ cho Task016. PID trong container: 27.

Lưu ý: `docker stats` trên Docker Desktop có thể gồm cả page cache của file, nên con số là cận trên của RAM thật của mysqld. Chưa tách được (cgroup trong container không đọc được `memory.stat`).

## AC3: mặc định so với `my.cnf` tối giản (`--memory 512m`)

| Mốc | Mặc định | `my.cnf` | Tiết kiệm |
|---|---:|---:|---:|
| Nhàn rỗi | 432,6 | 244,2 | 188 MiB (43%) |
| Sau bảng 10k | 445,4 | 255,5 | 190 MiB |
| Sau 2 khóa | 448,4 | 258,8 | 190 MiB |
| PID | 41 | 27 | 14 |

Chỉ một lượt cho cấu hình mặc định. Không đo xem tham số nào đóng góp bao nhiêu.

## AC4: `--memory` thấp nhất mà AC2 còn chạy

Mỗi mức chạy một lần, `my.cnf`, cùng cờ cô lập.

| `--memory` | Kết quả | Lỗi |
|---:|---|---|
| 512m, 384m, 320m, 288m | chạy hết AC2 | không |
| 256m | không lên (thử 2 lần) | `oom=true`; lần 1 `ERROR 2013 Lost connection to MySQL server during query` (entrypoint nạp timezone), lần 2 exit 137 `Killed` ở `mysql --defaults-extra-file=...` |
| 192m, 160m, 128m | không lên | `oom=true exit=1`, `[ERROR] [Entrypoint]: Unable to start server.` |
| 96m | không lên | `oom=true exit=137`, `Killed ... --initialize-insecure` |

Giới hạn thấp nhất đã chạy được: 288m (mỗi mức chỉ 1 lần, chưa lặp). Khuyến nghị 384m cho có chỗ trống, vì dùng thật khoảng 260 MiB và các truy vấn lớn hơn của người dùng cần thêm. Phần lớn mức tối thiểu nằm ở bước khởi tạo thư mục dữ liệu của entrypoint, không ở lúc chạy.

## AC5: ước tính số phiên trên máy Oracle

Giả định máy Oracle Always Free A1 là 2 OCPU và 12 GB RAM (theo https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm, do điều phối viên cung cấp, task này không tự kiểm). Số dưới đây là **ước tính từ máy amd64**; Task018 sẽ đo lại trên ARM, nơi RAM và thời gian có thể khác.

- 12 GB = 12.288 MiB. Dành 2.000 MiB cho hệ điều hành, Docker daemon và sandbox agent. Còn khoảng 10.000 MiB.
- Theo mức dùng thật (khoảng 260 MiB): 10.000 / 260 = 38 phiên.
- Theo giới hạn khuyến nghị `--memory 384m` (an toàn hơn, vì tổng giới hạn không vượt RAM): 10.000 / 384 = 26 phiên.
- CPU là điểm nghẽn có thể đến trước: mỗi container khởi động lạnh dùng tới 1 CPU trong khoảng 15 đến 20 giây, nên với 2 OCPU chỉ khoảng 2 phiên khởi động cùng lúc mà không chậm đi. Phiên đang chạy rỗi gần như không tốn CPU.
- Kết luận để lập kế hoạch: khoảng 20 đến 25 phiên đang tồn tại cùng lúc, tối đa 2 phiên khởi động đồng thời. Con số này chưa kiểm cho ARM, chưa kiểm khi nhiều phiên cùng chạy truy vấn.

## Bảo mật cấu hình

- Mật khẩu root trong script là hằng cho thử nghiệm, container không có mạng nên không truy cập được từ ngoài. SP004 phải sinh ngẫu nhiên cho mỗi phiên.
- `my.cnf` có `local_infile=OFF` và `secure_file_priv=NULL` để SQL người dùng không đọc ghi file. Đã kiểm: `SELECT 1 INTO OUTFILE '/tmp/x.txt'` bị chặn với lỗi 1290, và `@@innodb_buffer_pool_size=33554432`, `@@max_connections=20` xác nhận cấu hình được áp.
- Chưa làm: role MySQL quyền thấp cho SQL người dùng (nguyên tắc 8), thuộc SP004. Script hiện chạy bằng root.
- `docker exec` dùng `MYSQL_PWD` trong biến môi trường của tiến trình exec, không đưa mật khẩu lên dòng lệnh `mysql`. Dòng lệnh `mysqladmin -p"$PW"` thì có, chỉ nhìn thấy được bên trong container.
