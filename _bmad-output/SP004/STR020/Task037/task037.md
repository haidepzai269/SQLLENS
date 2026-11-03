# Task037: Kiểm tra bảo mật sandbox MySQL

Thuộc: SP004 / STR020
Mục tiêu: Chạy skill `security-audit` trên sandbox trước khi mở cổng cho Render, và sửa hết lỗi nghiêm trọng.
Phạm vi: `sandbox/**`, `_bmad-output/SP004/STR020/Task037/**`. Chỉ đọc `api/**` và `spikes/azure-vm/**`, lỗi ở đó ghi vào Phát sinh.
Không làm: mở cổng hay đổi NSG, `ufw`, SSH; tạo hay xóa tài nguyên Azure; thử tấn công vào dịch vụ của bên thứ ba; sửa `web/`.

Phạm vi kiểm tra:
- Sandbox agent: xác thực, so token, id phiên, giới hạn body, kết quả và thời gian, cạn tài nguyên, xử lý đồng thời, log.
- `session.sh`, `seed.sh`: chèn lệnh shell qua tên phiên hay tham số, quyền file mật khẩu, tiến trình lộ mật khẩu, thoát khỏi thư mục phiên.
- Container: thoát container, ghi file ngoài thư mục phiên, capability, uid, kết nối giữa hai phiên, socket bị lộ.
- MySQL dưới `sqllens_user`: leo quyền qua routine, trigger, view, `DEFINER`, biến hệ thống; đọc thông tin hệ thống; làm chết `mysqld` hay agent bằng SQL.
- Máy Azure: dịch vụ đang nghe, quyền `/etc/sqllens-agent` và `/opt/sqllens`, cấu hình SSH.
- Sẵn sàng cho bước tiếp theo: khi mở HTTPS cho dải IP Render Singapore cộng token, kẻ tấn công cùng dải IP có thể làm gì nếu không có token, và nếu lộ token.

Tiêu chí xong:
- AC1: `ket_qua.md` liệt kê từng lỗi với mức độ, file, dòng, cách tái hiện đã chạy thật. Chưa chứng minh được thì ghi `needs_validation`, không nâng mức độ theo suy đoán.
- AC2: Mọi lỗi mức nghiêm trọng và cao trong phạm vi được sửa, có test hoặc lệnh tái hiện cho thấy không còn. Lỗi trong phạm vi nhưng chưa sửa phải nói rõ lý do.
- AC3: Có kết luận rõ ràng cho câu hỏi: đã đủ an toàn để mở cổng cho Render chưa, và phải làm gì trước. Kết luận không được ghi "an toàn" chung chung, phải nêu giả định và phần chưa kiểm.
- AC4: `cd sandbox/agent && go vet ./... && go test ./...` thoát với mã 0 sau khi sửa. Bản sửa đã cài lên máy Azure và chạy lại các AC liên quan của Task035, Task036.
- AC5: Dọn hết phiên và file thử, agent vẫn chạy.

Kiểm tra: chạy lại các phép tái hiện trong `ket_qua.md`, cùng lệnh ở AC4.
Góc review thêm: bảo mật.
Đọc thêm: skill `security-audit` và `ATTACK-CLASSES.md` của nó; bàn giao và `ket_qua.md` của Task034, Task035, Task036; `CLAUDE.md` nguyên tắc 7, 8 và dòng "Đường mạng Render tới máy Azure".
