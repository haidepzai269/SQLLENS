# Task006: Khung ứng dụng

Thuộc: SP001 / STR002
Điều kiện bắt đầu: Task005 và Task007 đã merge.
Mục tiêu: Dựng khung dùng chung cho mọi màn hình, gồm thanh đầu trang, chọn engine, đổi ngôn ngữ và tab bị khóa.
Phạm vi: `web/src/app/[locale]/layout.tsx`, `web/src/components/shell/**`, `web/messages/*/shell.json`.
Không làm: nội dung từng tính năng, đăng nhập, gọi engine thật.

Hợp đồng:
- `EngineTabs`: PostgreSQL và MySQL chọn được, NoSQL và LSM-Tree hiện khóa. Engine đang chọn lưu trên URL bằng tham số `engine`, mặc định `postgres`.
- Khung có vùng `main` để các trang sau đặt nội dung, không cần sửa lại layout.

Tiêu chí xong:
- AC1: Mở `/vi` và `/en` đều thấy khung đúng ngôn ngữ, đổi ngôn ngữ giữ nguyên trang và tham số `engine`.
- AC2: Bấm tab khóa không đổi engine, và có giải thích vì sao bị khóa bằng cách đọc được, không chỉ màu xám.
- AC3: Đi hết khung được bằng bàn phím, có focus nhìn thấy, tab dùng đúng role.
- AC4: Không cuộn ngang ở 390 px và 1440 px.
- AC5: Khớp với mẫu đã duyệt. Khác chỗ nào thì ghi vào bàn giao.
- AC6: `npm run check` và `npm run build` thoát với mã 0.

Ca biên:
- `engine=abc` trên URL: dùng `postgres`, không crash.
- Tên engine và nhãn khóa không được viết cứng trong code.

Kiểm tra: `cd web && npm run check && npm run build`, rồi chụp ảnh hai ngôn ngữ ở 390 px và 1440 px.
Góc review thêm: giao diện.
Đọc thêm: `DESIGN.md`, `EXPERIENCE.md`, bàn giao Task005 và Task007.
