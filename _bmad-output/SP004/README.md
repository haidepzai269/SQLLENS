# SP004: Sandbox MySQL

Kết quả: MySQL thật chạy an toàn trên máy Azure, mỗi phiên một container, SQL người dùng chạy bằng role quyền thấp.

STR019 (nối vào sản phẩm) chờ SP005 vì MySQL cần đăng nhập, Đường mạng đã chốt: HTTPS mở cho dải IP ra ngoài của Render Singapore, cộng token, xem `CLAUDE.md`. STR020 (kiểm tra bảo mật) chạy sau Task035.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR017 Container theo phiên | Task034 | Thư mục dữ liệu MySQL dựng sẵn, đo lại thời gian khởi động và số phiên | Task018 | 1, xong |
| STR018 Quyền thấp | Task036 | Tài khoản `sqllens_user` cho mỗi phiên | Task034 | 2 |
| STR016 Sandbox agent | Task035 | API tạo, chạy, hủy phiên, trần phiên, hết hạn | Task036 | 3 |

## Các file bị đụng

| Task | File |
|---|---|
| Task034 | `sandbox/mysql-seed/**` |
| Task036 | `sandbox/mysql-seed/**` |
| Task035 | `sandbox/agent/**` |

## Quyết định

- Giảm thời gian chờ khởi động bằng thư mục dữ liệu dựng sẵn trước.
- Task034: phiên đầu 2,87 giây, phiên thứ hai 11,9 đến 14,3 giây, trần vẫn 2 phiên.
- Giữ sẵn container chờ: chưa làm. Chỉ làm khi số đo của Task034 hoặc người dùng thật cho thấy thời gian chờ vẫn là vấn đề. Ghi ở `SP999`.
