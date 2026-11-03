# mysql-seed

Bản mẫu thư mục dữ liệu `mysql:8.4.13` và script tạo phiên từ bản mẫu. Chạy trên Linux bằng root.

- `sudo ./seed.sh build` dựng bản mẫu (chạy lại thì bỏ qua), `verify` so SHA256 từng file.
- `sudo ./session.sh create TÊN [tham số mysqld]`, `exec TÊN [tham số mysql]`, `destroy TÊN`.
- `sudo ./bench.sh time1|time2|capacity` là script đo của Task034.
- Cấu hình ở `my.cnf` (cùng nội dung `spikes/mysql-container/my.cnf`), truyền thành tham số mysqld.
- Phiên: thư mục dữ liệu và uid riêng, mật khẩu root ngẫu nhiên đặt bằng `--init-file` rồi xóa, `--network none`, `--cap-drop ALL` không thêm capability nào.
