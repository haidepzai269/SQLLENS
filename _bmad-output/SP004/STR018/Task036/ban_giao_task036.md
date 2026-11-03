# Bàn giao Task036

Đã làm: Mỗi phiên MySQL có thêm database `app` và tài khoản `sqllens_user` quyền thấp (chỉ trên `app.*`, tối đa 6 kết nối), mật khẩu ngẫu nhiên riêng, nằm ở `root.pw` và `user.pw` (quyền 600) trong thư mục phiên. `session.sh exec TÊN --as user|root` (mặc định user). Mặc định `max_execution_time` 30 giây.
File chính: `sandbox/mysql-seed/session.sh`, `lowpriv.sh`, `bench.sh` (đổi sang `--as root`), `README.md`, `_bmad-output/SP004/STR018/Task036/ket_qua.md`.
Kết quả kiểm tra: chạy thật trên máy Azure. AC1 mọi câu bị từ chối (LOAD_FILE trả NULL thay vì báo lỗi). AC2 18/18 chạy được. AC3 5/5 lần giống nhau và giống Task016. AC4 mật khẩu khác nhau, user A không vào phiên B, mật khẩu không có trong inspect, log, ps. AC5 chỉ thấy `app`, `information_schema`, `performance_schema`. AC6 trung vị 2,86 giây (Task034: 2,87). AC7 `seed.sh verify` đúng, máy đã dọn, vẫn chạy. Chi tiết và danh sách quyền ở `ket_qua.md`.
Kết quả review: 1 lỗi confirmed đã sửa (lệnh `\!` phía client chạy shell), 1 thiếu tài liệu đã bổ sung. needs_validation còn lại: không có hạn mức đĩa theo phiên; `SQL SECURITY INVOKER` nếu root gọi đối tượng của user.
Chưa làm được: hạn mức đĩa theo phiên; `sqllens_user` chỉ có `@localhost`; chưa thử đọc các bảng `performance_schema` ngoài `data_locks`, `data_lock_waits`.
Phát sinh: (1) Hạn mức đĩa theo phiên (Task035). (2) `max_execution_time` chỉ là mặc định cho `SELECT`, user đặt lại được, agent phải tự `KILL QUERY` bằng root. (3) Cập nhật `CLAUDE.md` nếu muốn: nguyên tắc 8 đã có role quyền thấp cho MySQL.
Việc tiếp theo cần biết: Task035 không đưa SQL người dùng vào `-e` hay stdin của `mysql` client, dùng driver; không bao giờ gọi routine hoặc view của user bằng root; tài khoản đọc `performance_schema` là root (`--as root`).
