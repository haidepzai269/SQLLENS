# SP999: Epic phát sinh

Nơi lưu lỗi cần sửa, tính năng chủ dự án mới thêm và các chỗ làm tắt trong lúc phát triển. Quy tắc nằm ở `_bmad-output/QUY_TRINH.md`, mục 2.

Khi đến lượt làm, chủ dự án và party mode chia thành `STR0xx` và `Task0xx` như các Epic khác.

## Chờ chia

| Nguồn | Việc | Trạng thái |
|---|---|---|
| Task009 | Handler đọc body bằng `ShouldBindJSON` rồi tự trả 400 thì body quá lớn không có Content-Length sẽ không thành 413. Request vẫn bị chặn, nên không phải lỗ hổng | `needs_validation` |
| Task009 | Lỗi do chính `net/http` sinh ra, ví dụ 400 do request hỏng, chưa theo định dạng JSON | Chưa làm |
| Task009 | `golang:1.25-alpine` và `alpine:3.21` chưa ghim digest | Chưa làm |
| Task001 | `npm audit` báo 21 lỗ hổng (19 moderate, 2 low), chủ yếu trong chuỗi ESLint và `shadcn`. Cần xem gói nào lên production | Chưa làm |
| Task009 | `HEAD /healthz` trả 405. Chỉ cần sửa nếu ping giữ thức dùng HEAD. Task010 dùng GET | `needs_validation` |
