# Kết quả Task018: máy Azure sandbox

Đo ngày 2026-11-03. Nhãn: **Thật** cho số đo trên máy này. Thời gian là của máy đo, không phải dự đoán cho production.

## Cấu hình máy

| | |
|---|---|
| Size | `Standard_B2ats_v2`, 2 vCPU, RAM thấy được 836 MiB (docker báo 877.649.920 byte) |
| Region | East Asia (Southeast Asia báo `NotAvailableForSubscription` với size này) |
| HĐH | Ubuntu 24.04.5 LTS, kernel 7.0.0-azure, cgroup v2 |
| Đĩa OS | 29 GB, dùng 1,9 GB trước khi cài, 4,7 GB sau khi kéo image MySQL và chạy đo (còn 24 GB) |
| Docker | `docker.io` của Ubuntu, 29.1.3 |
| Swap | không có sẵn; `setup.sh` thêm 1 GiB `/swapfile` làm lưới an toàn cho máy chủ |
| Image | `mysql:8.4.13`, cấu hình `spikes/mysql-container/my.cnf` truyền bằng tham số mysqld |

Lệnh gốc đã chạy: `setup.sh` qua SSH (`sudo bash -s < setup.sh`), `measure.sh` của Task015 (`IMAGE=mysql:8.4.13 SWEEP="384m 288m"`), `capacity.sh` (mới, ở `spikes/azure-vm/`), và chương trình Go của Task016 biên dịch chéo sang linux/amd64.

## Khóa máy (setup.sh)

- Chạy hai lần liên tiếp: cả hai lần thoát mã 0. Lần hai không thêm dòng `fstab` lặp (đếm `swapfile` trong `/etc/fstab` = 1), swap vẫn 1 file.
- `sshd -T`: `passwordauthentication no`, `permitrootlogin no`. Drop-in đặt tên `00-sqllens.conf` để thắng `60-cloudimg-settings.conf` (sshd lấy giá trị đầu tiên).
- `ufw`: mặc định chặn vào, chỉ `22/tcp` (IPv4 và IPv6). Cho phép 22 trước khi bật. Đã mở kết nối SSH mới sau khi bật, thành công.
- Docker bỏ qua `ufw` với cổng publish (docker tự ghi iptables). Vì vậy container thử chỉ dùng `--network none` hoặc `127.0.0.1:cổng`, không bao giờ `-p` ra mọi địa chỉ.

## AC1: quét cổng từ ngoài

Lệnh (PowerShell, kết nối TCP đồng thời tới 1.035 cổng: 1 đến 1024 cộng 2375, 2376, 3306, 3307, 33060, 33160, 5432, 6379, 8080, 8443, 9000, chờ 6 giây):
`[Net.Sockets.TcpClient]::ConnectAsync(ip, cổng)` cho từng cổng, đếm kết nối thành công.
Kết quả: chỉ cổng 22 mở.

Giới hạn của phép quét: NSG của Azure chỉ cho IP của chủ dự án vào cổng 22, và quét từ chính IP đó. Cổng khác bị NSG chặn trước, nên phép quét không chứng minh được `ufw` hay việc không có dịch vụ nào lắng nghe. Kiểm thêm trên máy:
- `ss -tlnp` sau khi dọn: chỉ có `0.0.0.0:22` và `[::]:22` (sshd) cùng các cổng `127.0.0.x` nội bộ (DNS stub; một cổng `127.0.0.1` ngẫu nhiên chưa xác định tiến trình, chỉ nghe localhost).
- `ufw status`: active, chỉ `22/tcp` cho phép.
Chưa quét từ IP khác nên chưa kiểm được `ufw` chặn thật khi NSG mở rộng.

## AC2: một container, cấu hình Task015 (`--memory 512m`, 5 lần)

| Lần | Ping (ms) | Sẵn sàng (ms) | RAM nhàn rỗi (MiB) | Sau bảng 10k | Sau 2 khóa | `data_lock_waits` |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 11.809 | 17.205 | 258,0 | 273,3 | 283,7 | 1 |
| 2 | 10.045 | 15.737 | 247,6 | 262,2 | 265,4 | 1 |
| 3 | 10.454 | 16.197 | 251,7 | 266,2 | 272,2 | 1 |
| 4 | 10.720 | 16.760 | 277,5 | 293,3 | 300,9 | 1 |
| 5 | 10.242 | 15.816 | 247,5 | 263,2 | 272,6 | 1 |

"Sẵn sàng" là lúc server thật đã mở mạng (`skip_networking=0`), "ping" là lúc `mysqladmin ping` thành công. Trung vị: ping 10,5 giây, sẵn sàng 16,2 giây, RAM sau 2 khóa 272,6 MiB.

Đối chứng không dùng `my.cnf`: sẵn sàng 29.122 ms, RAM 436,7 đến 442,1 MiB. Quét `--memory`: 384m sẵn sàng 16.031 ms, 335,9 MiB sau khóa; 288m sẵn sàng 15.838 ms, 285,6 MiB. Cả hai chạy được, không OOM. So với Task015 trên máy khác (13 đến 19 giây) thời gian khởi động không khác nhiều, nhưng không dùng số đó thay cho số đo ở đây.

## AC3: tăng dần số container chạy cùng lúc

Mỗi container: `my.cnf` tối giản, `--memory 384m --memory-swap 384m` (không dùng swap), `--cpus 1`, `--network none`, bảng 10k dòng, hai connection giữ khóa (B chờ A, `data_lock_waits` = 1) trong lúc đo. Điều kiện dừng: RAM trống dưới 15% (125 MiB), có container OOM hoặc chết, thời gian sẵn sàng gấp đôi lần đầu. Thêm hai lưới an toàn do tôi đặt: swap máy trên 300 MiB, hoặc RAM trống dưới 150 MiB trước khi mở container kế. Hai lưới này không bật trong hai lần đo.

Lần 1:

| n | Sẵn sàng (ms) | RAM trống trước | RAM trống sau | % | Swap máy | Tổng RAM container (docker stats) |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 17.393 | 597 | 321 | 38% | 140 | 288 |
| 2 | 51.808 | 315 | 157 | 18% | 188 | 502 |

Lần 2 (lặp lại): n=1 15.642 ms, 331 MiB trống (39%), tổng 343 MiB; n=2 48.628 ms, 162 MiB trống (19%), tổng 503 MiB, swap 186 MiB.

Kết quả: dừng ở n=2 vì thời gian sẵn sàng gấp 2,9 đến 3,1 lần container đầu (lần 1: 51,8 giây so với 17,4 giây; lần 2: 48,6 giây so với 15,6 giây). Hai container cùng chạy không có OOM, RAM trống còn 18 đến 19%, nhưng container thứ hai phải chờ gần 50 giây mới dùng được. Chưa thử container thứ ba vì điều kiện dừng đã kích hoạt và RAM trống chỉ còn khoảng 160 MiB trong khi mỗi container cần khoảng 270 đến 340 MiB. Con số đo được: **1 phiên chạy trong ngưỡng, 2 phiên chạy được nhưng chậm gấp 3 lần ở phiên thứ hai**.

Lưu ý: máy đã dùng khoảng 140 MiB swap (do đợt cài đặt và nâng cấp) trước khi đo, nên "RAM trống" trên đây tính cả page cache. Thời gian khởi động của container thứ hai tăng chủ yếu vì CPU và đĩa của máy B2ats_v2 (hạng burstable) bị hai container tranh nhau; chưa tách riêng yếu tố CPU credit, cần đo nếu muốn kết luận chắc.

## AC4: kịch bản Task016 trên máy Azure

Chạy chương trình Go của Task016 (biên dịch chéo, không đổi mã) với `mysql:8.4.13` cấu hình mặc định của image, `innodb_lock_wait_timeout=8`. Tóm tắt, mỗi kịch bản 5/5 lần giống nhau:
- Lock wait: B chờ A, thấy `RECORD X,REC_NOT_GAP` trên `lab.acct` index `PRIMARY`. Độ trễ thấy khóa 0,8 đến 30,8 ms (lần đầu 30,8 ms, bốn lần sau dưới 7 ms).
- Deadlock: đúng một bên nhận lỗi 1213, 5/5 lần bên bị hủy là B (trùng với Task016 trên máy khác; Task016 đã lưu ý bên bị hủy không cố định về nguyên tắc).
- Dirty read: `READ UNCOMMITTED` đọc 999, `READ COMMITTED` đọc 100.
- Lost update ở `REPEATABLE READ`: kết quả cuối 120, mất +10 của A.
- Gap lock: A giữ `RECORD X,GAP` tại khóa 20; INSERT 15 của B chờ với `X,GAP,INSERT_INTENTION`.
- User quyền thấp đọc `performance_schema.data_locks`: từ chối, lỗi 1142/1142/1227.
- Timeout: B nhận lỗi 1205 sau 8 giây.
Kết quả giống `_bmad-output/SP002/STR010/Task016/ket_qua.md` ở phần kết luận từng kịch bản.

## AC5: đề xuất trần số phiên cho STR017 (SP004)

Số đo cho phép đề xuất:
- **Trần cứng: 2 phiên cùng lúc** trên B2ats_v2 1 GB. Dưới 2 vẫn chạy; trên 2 chưa đo và RAM không đủ chỗ an toàn.
- **Trần phục vụ nên dùng: 1 phiên đang khởi động tại một thời điểm.** Container thứ hai khởi động trong 49 đến 52 giây khi container đầu đang giữ khóa, nên hàng đợi khởi động phải tuần tự, và người dùng sẽ thấy chờ.
- SP004 cần phương án giảm thời gian chờ: thư mục dữ liệu dựng sẵn hoặc container giữ sẵn (Task015 đã khuyến nghị), đo lại sau đó. Nếu mục tiêu là nhiều hơn 2 phiên thì cần B2als v2 (4 GB), CLAUDE.md đã nêu; số phiên trên máy đó chưa đo, không suy ra từ đây.
- Đặt `--memory 384m` mỗi phiên như Task015 khuyến nghị. 288m chạy được ở một phiên nhưng chưa thử dưới tải đồng thời.

## AC6: dọn dẹp

Sau khi xong: 0 container, 0 volume còn lại (chương trình Task016 để lại một volume ẩn danh vì dùng `docker rm -f` không kèm `-v`, đã `docker volume prune`). Thư mục thử `~/m` trên máy đã xóa. Máy vẫn chạy.

## Chưa làm được hoặc chưa kiểm

- Không đo container thứ ba.
- Chưa kiểm `ufw` từ IP khác NSG cho phép.
- Chưa kiểm B2ats_v2 có nằm trong 750 giờ miễn phí hay không (việc của chủ dự án trên portal).
- CPU credit của B-series chưa theo dõi nên chưa biết khởi động chậm do credit hay do đĩa.
