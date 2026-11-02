# Task006: Khung ứng dụng

Thuộc: SP001 / STR002
Điều kiện bắt đầu: Task005 và Task007 đã merge.
Mục tiêu: Dựng khung dùng chung cho mọi màn hình, gồm thanh đầu trang, chọn engine, đổi ngôn ngữ và tab bị khóa.
Phạm vi: `web/src/app/[locale]/layout.tsx`, `web/src/components/shell/**`, `web/src/components/ui/resizable.tsx`, `web/messages/*/shell.json`, `web/package.json`, `web/package-lock.json`.
Không làm: nội dung từng tính năng, đăng nhập, gọi engine thật. Các vùng chỉ có nội dung giữ chỗ.

Hợp đồng:
- `EngineTabs`: PostgreSQL và MySQL chọn được, NoSQL và LSM-Tree hiện khóa. Engine đang chọn lưu trên URL bằng tham số `engine`, mặc định `postgres`.
- `WorkspaceLayout` nhận bốn vùng `sql`, `stage`, `findings`, `terminal`, là component để các trang sau đặt nội dung mà không sửa lại layout. Dùng component `resizable` của shadcn/ui.
- Bốn nút ở thanh đầu trang bật tắt từng vùng, các vùng còn lại giãn ra. Kích thước và trạng thái bật tắt nhớ bằng `localStorage`, đọc ghi trong `try/catch`, và trang vẫn chạy đúng khi không đọc được.
- Dưới chiều rộng đã ghi trong `EXPERIENCE.md`, bốn vùng chuyển thành bốn tab ở đáy màn hình như mẫu đã duyệt.

Tiêu chí xong:
- AC1: Mở `/vi` và `/en` đều thấy khung đúng ngôn ngữ, đổi ngôn ngữ giữ nguyên trang và tham số `engine`.
- AC2: Bấm tab khóa không đổi engine, và có giải thích vì sao bị khóa bằng cách đọc được, không chỉ màu xám.
- AC3: Đi hết khung được bằng bàn phím, có focus nhìn thấy, tab dùng đúng role.
- AC4: Không cuộn ngang ở 390 px và 1440 px.
- AC5: Khớp với mẫu đã duyệt. Khác chỗ nào thì ghi vào bàn giao.
- AC6: `npm run check` và `npm run build` thoát với mã 0.
- AC7: Tắt từng vùng thì vùng còn lại giãn ra. Tải lại trang vẫn giữ trạng thái bật tắt và kích thước.
- AC8: Đổi kích thước được bằng chuột và bằng phím mũi tên.
- AC9: Tắt hết bốn vùng không làm vỡ trang: hiện trạng thái rỗng kèm cách bật lại, hoặc không cho tắt vùng cuối.
- AC10: `/lab` vẫn chạy đúng trong khung mới, Playwright của Task011 vẫn đạt.
- AC11: `layout.tsx` bỏ Geist, nạp Public Sans và JetBrains Mono có subset `vietnamese`, gắn vào biến `--sans` và `--mono` của `globals.css`. `<html>` có `className="dark"`.

Ca biên:
- `engine=abc` trên URL: dùng `postgres`, không crash.
- Tên engine và nhãn khóa không được viết cứng trong code.

Kiểm tra: `cd web && npm run check && npm run build`, rồi chụp ảnh hai ngôn ngữ ở 390 px và 1440 px.
Góc review thêm: giao diện.
Đọc thêm: `DESIGN.md`, `EXPERIENCE.md`, bàn giao Task005 và Task007.
