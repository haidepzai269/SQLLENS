# Task005: Tài liệu thiết kế và token

Thuộc: SP001 / STR002
Điều kiện bắt đầu: chủ dự án đã duyệt mẫu ở Task004.
Mục tiêu: Chuyển mẫu đã duyệt thành chuẩn dùng chung cho mọi Story giao diện.
Phạm vi: `DESIGN.md`, `EXPERIENCE.md`, `web/src/app/globals.css`.
Không làm: khung ứng dụng và màn hình thật. Không tự đổi quyết định thiết kế đã được duyệt.

Hợp đồng:
- `globals.css` định nghĩa token shadcn/ui bằng biến CSS theo mẫu đã duyệt, gồm token riêng cho ba nhãn kết luận: `--label-real`, `--label-simulated`, `--label-estimated`.
- `DESIGN.md`: màu, font, khoảng cách, cách dùng nhãn, cách dùng animation.
- `EXPERIENCE.md`: luồng từ dán SQL đến kết luận, trạng thái tải, rỗng, lỗi, "chưa mô phỏng được", và hành vi trên điện thoại.

Tiêu chí xong:
- AC1: Mọi màu trong `DESIGN.md` có token tương ứng trong `globals.css`.
- AC2: Chữ thường và nền đạt tỷ lệ tương phản tối thiểu 4,5:1. Ghi bảng kết quả đo vào `DESIGN.md`.
- AC3: `npm run check` và `npm run build` thoát với mã 0.
- AC4: Mọi quyết định khác với mẫu đã duyệt được liệt kê trong bàn giao kèm lý do.

Kiểm tra: `cd web && npm run check && npm run build`
Góc review thêm: giao diện.
Đọc thêm: `_bmad-output/SP001/STR002/Task004/ghi_chu_thiet_ke.md`, `mau_giao_dien.html`, `_bmad-output/QUY_TRINH.md` mục 8.
