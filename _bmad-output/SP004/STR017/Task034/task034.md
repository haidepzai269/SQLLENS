# Task034: Thư mục dữ liệu MySQL dựng sẵn

Thuộc: SP004 / STR017
Mục tiêu: Phiên MySQL mới không phải chờ `mysqld` khởi tạo dữ liệu từ đầu. Khởi động từ dữ liệu dựng sẵn phải nhanh hơn rõ so với 16 giây cho một phiên và khoảng 50 giây cho phiên thứ hai đo ở Task018.
Phạm vi: `sandbox/mysql-seed/**`, `_bmad-output/SP004/STR017/Task034/**`.
Không làm: sandbox agent và API phiên (STR016), giữ sẵn container chờ (chủ dự án để sau, xem `SP999`), role quyền thấp đầy đủ (STR018), tạo hay sửa tài nguyên Azure.

Bối cảnh: Task018 đo trên máy Azure `Standard_B2ats_v2` (1 GB RAM): một phiên sẵn sàng sau trung vị 16,2 giây, phiên thứ hai mất 48,6 đến 51,8 giây, trần 2 phiên. Phần lớn thời gian là bước khởi tạo thư mục dữ liệu lúc chạy lần đầu.

Hợp đồng:
- Có cách dựng một bản dữ liệu `mysql:8.4.13` đã khởi tạo sẵn, theo cấu hình Task015 (truyền bằng tham số dòng lệnh vì file mount có thể bị bỏ qua). Cách dựng là image riêng hoặc thư mục mẫu được sao chép cho mỗi phiên, task tự chọn và ghi lý do.
- Mỗi phiên có thư mục dữ liệu riêng, ghi được. Phiên này không đọc hay sửa được dữ liệu của phiên khác hay của bản mẫu.
- Mật khẩu root khác nhau cho mỗi phiên, sinh ngẫu nhiên lúc tạo phiên. Không nằm trong bản mẫu, không truyền qua biến môi trường vì lộ qua `docker inspect` (Task016), không nằm trong repo.
- Giữ cách cô lập của Task015: `--network none --read-only --cap-drop ALL` cộng các capability tối thiểu, `--memory 384m`.
- `sandbox/mysql-seed/` có script dựng bản mẫu và script tạo một phiên thử, chạy lại nhiều lần không hỏng.

Tiêu chí xong:
- AC1: Trên máy Azure, đo 5 lần thời gian từ lúc tạo phiên đến khi nhận kết nối, cho 1 phiên và cho 2 phiên cùng lúc. So với số của Task018 trong cùng bảng.
- AC2: Lặp lại cách đo AC3 của Task018 với bản mẫu: tăng dần số phiên, mỗi phiên giữ khóa, đến khi RAM trống dưới 15%, có OOM, hoặc thời gian khởi động tăng gấp đôi. Ghi số phiên tối đa.
- AC3: Hai phiên tạo từ cùng bản mẫu có mật khẩu root khác nhau. `docker inspect` không chứa mật khẩu. Dữ liệu ghi ở phiên A không thấy ở phiên B và không làm đổi bản mẫu.
- AC4: Kịch bản AC1 của Task016 chạy đúng trên phiên tạo từ bản mẫu.
- AC5: Dung lượng bản mẫu và dung lượng đĩa thêm cho mỗi phiên được ghi vào `ket_qua.md`.
- AC6: Có đề xuất trần số phiên mới cho SP004, và nói rõ có còn cần giữ sẵn container chờ hay không, dựa trên số đo.
- AC7: Dọn hết container và thư mục thử khi xong, máy vẫn chạy.

Ca biên: tạo phiên khi đĩa còn ít; xóa phiên giữa lúc đang khởi động; bản mẫu bị sửa nhầm thì phát hiện được (ví dụ bằng checksum).
Kiểm tra: chạy script dựng bản mẫu hai lần liên tiếp không lỗi; AC1 đến AC7.
Góc review thêm: bảo mật (mật khẩu, cô lập giữa các phiên).
Đọc thêm: `_bmad-output/SP002/STR009/Task018/ket_qua.md`, `ket_qua.md` của Task015 và Task016, `CLAUDE.md` mục "Đã kiểm chứng" phần MySQL và máy Azure.
