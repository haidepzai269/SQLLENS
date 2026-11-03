# mysql-seed

Bản mẫu thư mục dữ liệu `mysql:8.4.13` và script tạo phiên từ bản mẫu. Chạy trên Linux bằng root.

- `sudo ./seed.sh build` dựng bản mẫu (chạy lại thì bỏ qua), `verify` so SHA256 từng file.
- `sudo ./session.sh create TÊN [tham số mysqld]`, `exec TÊN [tham số mysql]`, `destroy TÊN`.
- `sudo ./bench.sh time1|time2|capacity` là script đo của Task034.
- Cấu hình ở `my.cnf` (cùng nội dung `spikes/mysql-container/my.cnf`), truyền thành tham số mysqld.
- Phiên: thư mục dữ liệu và uid riêng, mật khẩu root ngẫu nhiên đặt bằng `--init-file` rồi xóa, `--network none`, `--cap-drop ALL` không thêm capability nào.

## Tài khoản (Task036)
- `create` tạo thêm database `app` và `sqllens_user` (`@localhost`, chỉ quyền trên `app.*`, tối đa 6 kết nối). Mật khẩu root và user ngẫu nhiên riêng cho từng phiên, nằm ở `<thư mục phiên>/root.pw` và `user.pw` (quyền 600, root).
- `sudo ./session.sh exec TÊN [--as user|root] [tham số mysql]`: mặc định `user` và vào sẵn `app`. Dùng `--as root` cho việc quản trị (đọc `performance_schema`).
- `--max-execution-time=30000` là mặc định của máy chủ cho câu `SELECT`; user vẫn tự đặt lại được cho phiên của mình, nên sandbox agent phải tự hủy câu chạy quá lâu bằng root.
- `sudo ./lowpriv.sh ac1|ac2|ac3|ac4|ac5|edge` kiểm quyền (Task036).
