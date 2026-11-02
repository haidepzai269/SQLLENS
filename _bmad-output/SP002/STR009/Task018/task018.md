# Task018: Dựng và đo máy Azure

Thuộc: SP002 / STR009
Điều kiện bắt đầu: chủ dự án đã tạo máy Azure theo mục "Chủ dự án tạo máy" và đưa địa chỉ IP cùng đường dẫn file khóa SSH. Task015 và Task016 đã merge.
Mục tiêu: Máy Azure được khóa chặt, chạy được container MySQL theo cấu hình của Task015, và biết số phiên chạy cùng lúc tối đa.
Phạm vi: `spikes/azure-vm/**`, `_bmad-output/SP002/STR009/Task018/**`.
Không làm: sandbox agent (SP004), mở cổng MySQL ra Internet, tạo hay xóa tài nguyên Azure.

Ghi chú: task này trước đây viết cho Oracle. Oracle từ chối đăng ký nên chuyển sang Azure for Students.

## Chủ dự án tạo máy

1. Vào portal Azure, chọn Virtual machines, rồi Create, rồi Azure virtual machine.
2. Resource group: tạo mới tên `sqllens`. Region: Southeast Asia.
3. Image: Ubuntu Server 24.04 LTS, x64.
4. Size: `Standard_B2ats_v2`. Nếu ô chọn size không hiện nhãn miễn phí cho máy này thì chọn `Standard_B1s`, và báo lại.
5. Authentication: SSH public key, username `azureuser`, tạo cặp khóa mới và tải file `.pem` về máy. Không đưa file này vào repo.
6. Inbound ports: chỉ SSH (22).
7. Disks: OS disk loại Premium SSD, kích thước 64 GiB (P6), để nằm trong phần miễn phí.
8. Tạo xong, chép Public IP.

## Hợp đồng

- `spikes/azure-vm/setup.sh`: chạy lại nhiều lần không hỏng. Cập nhật hệ thống, cài Docker, tắt đăng nhập SSH bằng mật khẩu, tắt đăng nhập root, bật tường lửa của máy chỉ cho cổng 22. Bật swap nhỏ nếu cần để tránh OOM, ghi lý do.
- Không lưu IP, khóa hay mật khẩu trong repo. Truyền IP và đường dẫn khóa bằng biến môi trường khi chạy.
- Image MySQL: dùng `mysql:8.4.13` như Task016, cấu hình theo `spikes/mysql-container/my.cnf` của Task015, truyền bằng tham số dòng lệnh vì file mount có thể bị bỏ qua.

## Tiêu chí xong

- AC1: Từ máy ngoài, quét cổng chỉ thấy 22 mở. Ghi lệnh đã dùng.
- AC2: Chạy cấu hình của Task015 trên máy Azure, đo lại thời gian khởi động và RAM.
- AC3: Tăng dần số container chạy cùng lúc, mỗi container giữ khóa như AC2 của Task015, đến khi RAM còn trống dưới 15%, có container bị OOM, hoặc thời gian khởi động tăng gấp đôi. Ghi con số đó.
- AC4: Chạy lại kịch bản AC1 của Task016 trên máy Azure.
- AC5: `ket_qua.md` có số đo, cấu hình máy, và đề xuất trần số phiên cho STR017.
- AC6: Dọn hết container thử khi xong. Máy vẫn để chạy.

Kiểm tra: chạy `setup.sh` hai lần liên tiếp không lỗi; AC1 đến AC4.
Góc review thêm: bảo mật.
Đọc thêm: `ket_qua.md` của Task015 và Task016; `CLAUDE.md` nguyên tắc 8 và mục "Đã kiểm chứng".
