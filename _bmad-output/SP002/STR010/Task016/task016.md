# Task016: Bắt lock wait trên MySQL thật

Thuộc: SP002 / STR010
Mục tiêu: Xác nhận hai connection thật đến MySQL cho ra lock wait, deadlock và dirty read quan sát được, để `conflict-sim` của MySQL mang nhãn Thật.
Phạm vi: `spikes/mysql-lock/**`, `_bmad-output/SP002/STR010/Task016/**`.
Không làm: sandbox agent, giao diện timeline.

Hợp đồng:
- `spikes/mysql-lock/`: chương trình Go, module riêng, dùng `github.com/go-sql-driver/mysql`. Điều khiển hai connection theo từng bước, mỗi bước có hạn thời gian để bước bị chặn không làm treo chương trình.
- Container MySQL tên `t016-*`, cổng từ 33160, image cùng bản với Task015 nếu Task015 đã chọn, nếu chưa thì ghim bản 8.4 cụ thể. Xóa khi xong.
- Truy vấn khóa bằng một connection thứ ba quyền cao. Hai connection của người dùng giả lập chạy bằng user quyền thấp, không đọc được `performance_schema`.

Tiêu chí xong:
- AC1: Lock wait: A cập nhật một dòng chưa commit, B cập nhật cùng dòng và bị chặn. Connection thứ ba đọc `performance_schema.data_lock_waits` và `data_locks` thấy đúng cặp chờ, loại khóa, bảng, index.
- AC2: Deadlock do cập nhật ngược thứ tự: MySQL hủy một bên với lỗi 1213. Lấy được thông tin deadlock từ `SHOW ENGINE INNODB STATUS` hoặc bảng tương ứng, chỉ bằng connection quyền cao.
- AC3: Dirty read ở `READ UNCOMMITTED`: B đọc được giá trị A chưa commit. Ở `READ COMMITTED` thì không.
- AC4: Lost update và gap lock: chạy kịch bản lost update ở `REPEATABLE READ`, và một kịch bản `SELECT ... FOR UPDATE` theo khoảng cho thấy gap lock hoặc next-key lock trong `data_locks`.
- AC5: User quyền thấp gọi `SELECT * FROM performance_schema.data_locks` bị từ chối.
- AC6: Mỗi kịch bản chạy 5 lần cho cùng kết quả. Lệch lần nào thì ghi lại.
- AC7: `ket_qua.md` có kết quả từng AC, câu truy vấn khóa đã dùng, ví dụ dữ liệu đọc được, và độ trễ từ lúc B bị chặn đến lúc connection thứ ba thấy được khóa.

Ca biên: `innodb_lock_wait_timeout` mặc định 50 giây. Đặt thấp cho phiên thử và ghi giá trị đã dùng.
Kiểm tra: `cd spikes/mysql-lock && go run .`
Góc review thêm: bảo mật (AC5), nhãn kết luận.
Đọc thêm: `CLAUDE.md` mục "Khác biệt giữa hai engine", nguyên tắc 1 và 8.
