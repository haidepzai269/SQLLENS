# Bàn giao Task022

Đã làm: Component `ResultGrid`, `SqlErrorView`, hàm thuần `formatCell` và `locateError`. Kết quả trên 500 dòng bị cắt kèm tổng số và câu báo. Câu cuối mở sẵn, các câu trước thu gọn được bằng nút có `aria-expanded`. Lỗi SQL chỉ đúng dòng, cột và token. Mọi giá trị và tên cột đi qua JSX text nên HTML hiện dạng chữ.
File chính: `web/src/components/result-grid/` (`format-cell.ts`, `result-grid.tsx`, `sql-error-view.tsx`, `result-grid.test.tsx`), `web/messages/{vi,en}/result.json`.
Kết quả kiểm tra: `cd web && npm run check` thoát 0 (i18n, lint, typecheck, 63 test qua). Sau bản sửa nhỏ cuối (hiện `affectedRows` cho câu có cột) chạy lại, xem commit cuối.
Kết quả review: 0 lỗi chặn, 3 mục needs_validation. Đã sửa mục 2 (câu `INSERT ... RETURNING` nay hiện cả số dòng bị ảnh hưởng). Còn lại:
- `Date` không hợp lệ hiện `Invalid date` theo đúng AC1. Chưa kiểm PGlite thật trả gì cho `infinity` của timestamptz; nếu trả `Date` không hợp lệ thì người dùng thấy `Invalid date` thay vì `infinity`.
- `ResultGrid` đặt lại trạng thái thu gọn khi nhận mảng `results` khác tham chiếu.
Chưa làm được: chưa kiểm bằng trình duyệt ở 390 px (chỉ dựa vào `overflow-x-auto` có sẵn của `Table`). Không có test Playwright.
Phát sinh: kiểm `infinity` của timestamptz trên PGlite thật khi gắn vào Task020.
Việc tiếp theo cần biết: Task020 phải giữ mảng `results` ổn định giữa các lần render (chỉ đổi khi có lần chạy mới), và bọc cha bằng `min-w-0` để cuộn ngang nằm trong component. Dịch bằng namespace `result`.
