# Task018: Dựng và đo máy Oracle

Thuộc: SP002 / STR009
Điều kiện bắt đầu: chủ dự án đã có máy ARM Always Free trên Oracle Cloud và đưa địa chỉ IP cùng đường dẫn khóa SSH. Task015 và Task016 đã merge.
Mục tiêu: Máy Oracle được khóa chặt, chạy được container MySQL theo cấu hình của Task015, và biết số phiên chạy cùng lúc tối đa.
Phạm vi: `spikes/oracle-vm/**`, `_bmad-output/SP002/STR009/Task018/**`.
Không làm: sandbox agent (SP004), mở cổng MySQL ra Internet.

Hợp đồng:
- `spikes/oracle-vm/setup.sh`: chạy lại nhiều lần không hỏng. Cập nhật hệ thống, cài Docker, tắt đăng nhập SSH bằng mật khẩu, tắt đăng nhập root, chỉ mở cổng 22 ở tường lửa của máy. Ghi riêng các bước phải làm trên giao diện Oracle Cloud (Security List).
- Không lưu IP, khóa hay mật khẩu trong repo.

Tiêu chí xong:
- AC1: Từ máy ngoài, quét cổng chỉ thấy 22 mở.
- AC2: Chạy cấu hình của Task015 trên máy ARM, đo lại thời gian khởi động và RAM.
- AC3: Tăng dần số container chạy cùng lúc, mỗi container giữ khóa như AC2 của Task015, đến khi RAM còn trống dưới 15% hoặc thời gian khởi động tăng gấp đôi. Ghi con số đó.
- AC4: Chạy lại kịch bản AC1 của Task016 trên máy ARM.
- AC5: `ket_qua.md` có số đo, cấu hình máy, và đề xuất trần số phiên cho STR017.

Kiểm tra: chạy `setup.sh` hai lần liên tiếp không lỗi; AC1 đến AC4.
Góc review thêm: bảo mật.
Đọc thêm: `ket_qua.md` của Task015 và Task016; `CLAUDE.md` nguyên tắc 8.
