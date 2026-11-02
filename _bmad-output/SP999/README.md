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
| Task003 | Action trong CI chỉ ghim theo tag (`@v4`, `@v5`), chưa ghim SHA | Chưa làm |
| Task003 | Chưa kiểm CI với pull request từ fork | Chưa làm |
| Task007 | `check-i18n` chỉ lấy tên đầu mỗi cặp ngoặc nhọn, chưa hiểu đầy đủ ICU plural. Object rỗng `{}` ở cả hai ngôn ngữ không bị coi là lỗi | Chưa làm |
| Task007 | `react/jsx-no-literals` chỉ chặn chữ trong JSX, không chặn chuỗi trong thuộc tính như `aria-label`, nên chuỗi cứng vẫn lọt | Chưa làm |
| Task007 | Matcher của `web/src/proxy.ts` loại mọi đường dẫn bắt đầu bằng `api`, kể cả trang như `/apiary` | Chưa làm |
| Task011 | Chưa có test cho `dispose` khi rời trang, reviewer chỉ đọc code | Chưa làm |
| Task011 | Date không hợp lệ hiện chữ `null` thay vì `NULL`, không crash | Chưa làm |
| Task011 | CI cảnh báo các action đang dùng Node.js 20 | Chưa làm |
| Task004 | Mẫu HTML mới kiểm trên Chrome headless, chưa kiểm cửa sổ thật, Firefox, Safari, điện thoại thật và trình đọc màn hình | Chưa làm |
| Task004 | `inspect.mjs` của skill `design-taste-frontend` không khởi động được trên máy này vì launcher Chrome thoát sớm | Chưa làm |
| Task005 | Bảng tương phản trong `DESIGN.md` là số ghi tay, test chỉ chặn cặp chữ dưới 4,5:1 | Chưa làm |
| Task005 | `control` trên `stage` (1,70:1) và `line` trên `ground` (1,25:1) dưới 3:1 cho phần tử giao diện, giữ theo mẫu | `needs_validation` |
| Task005 | Chưa có giao diện sáng, `.dark` trùng `:root` | Chưa làm |
| Task009 | `HEAD /healthz` trả 405. Chỉ cần sửa nếu ping giữ thức dùng HEAD. Task010 dùng GET | `needs_validation` |
