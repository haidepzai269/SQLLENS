# Task015: Đo container MySQL

Thuộc: SP002 / STR009
Mục tiêu: Đo RAM và thời gian khởi động của một container MySQL cấu hình cho sandbox, để ước tính số phiên chạy cùng lúc trên máy Oracle.
Phạm vi: `spikes/mysql-container/**`, `_bmad-output/SP002/STR009/Task015/**`.
Không làm: sandbox agent (SP004), cài đặt máy Oracle (Task018).

Hợp đồng:
- `spikes/mysql-container/my.cnf`: cấu hình tối giản cho sandbox. `performance_schema=ON` vì Task016 cần `data_lock_waits`. Thu nhỏ `innodb_buffer_pool_size`, `innodb_log_buffer_size`, `max_connections` và các bộ đệm khác. Mỗi giá trị có comment một dòng ghi lý do.
- `spikes/mysql-container/measure.sh` hoặc chương trình Go chạy được trên Git Bash và Linux, in bảng kết quả.
- Image MySQL ghim bản cụ thể, có bản arm64 vì máy Oracle là ARM. Ghi rõ đã kiểm image có arm64 bằng cách nào.
- Container tên `t015-*`, cổng từ 33150. Xóa hết khi xong.

Tiêu chí xong:
- AC1: Thời gian từ `docker run` đến khi `mysqladmin ping` thành công, đo 5 lần, ghi trung vị và lớn nhất.
- AC2: RAM bằng `docker stats` lúc nhàn rỗi, sau khi tạo bảng 10k dòng có index, và sau khi chạy 2 connection cùng giữ khóa. Ghi cả ba.
- AC3: So sánh cấu hình mặc định với `my.cnf` tối giản, để biết tiết kiệm được bao nhiêu.
- AC4: Container chạy với `--memory`, `--cpus`, `--pids-limit`, `--network none` cộng một cổng nội bộ, không mạng ra ngoài. Tìm giới hạn `--memory` thấp nhất mà AC2 vẫn chạy được, và ghi lỗi gặp khi thấp hơn.
- AC5: `ket_qua.md` có bảng số, cấu hình máy đo, lệnh đã chạy, và ước tính số phiên trên máy 24 GB RAM. Ghi rõ đây là ước tính từ máy amd64, Task018 sẽ đo lại trên ARM.

Ca biên: nếu `--network none` làm không kết nối được từ host thì ghi cách cô lập mạng thay thế, ví dụ network nội bộ `--internal`.
Kiểm tra: `cd spikes/mysql-container && ./measure.sh`
Góc review thêm: bảo mật của cấu hình container.
Đọc thêm: `CLAUDE.md` mục "Kiến trúc", "Chưa kiểm chứng", nguyên tắc 8.
