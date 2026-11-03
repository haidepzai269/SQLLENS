# SP004: Sandbox MySQL

Kết quả: MySQL thật chạy an toàn trên máy Azure, mỗi phiên một container, SQL người dùng chạy bằng role quyền thấp.

Epic này mới chia một task đầu tiên. Các task còn lại chia sau khi có số đo của Task034.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR017 Container theo phiên | Task034 | Thư mục dữ liệu MySQL dựng sẵn, đo lại thời gian khởi động và số phiên | Task018 | 1 |

## Các file bị đụng

| Task | File |
|---|---|
| Task034 | `sandbox/mysql-seed/**` |

## Quyết định

- Giảm thời gian chờ khởi động bằng thư mục dữ liệu dựng sẵn trước.
- Task034: phiên đầu 2,87 giây, phiên thứ hai 11,9 đến 14,3 giây, trần vẫn 2 phiên.
- Giữ sẵn container chờ: chưa làm. Chỉ làm khi số đo của Task034 hoặc người dùng thật cho thấy thời gian chờ vẫn là vấn đề. Ghi ở `SP999`.
