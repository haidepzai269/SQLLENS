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
| Task006 | Đổi qua lại mốc 900 px thì nội dung các vùng bị mount lại. Task đặt nội dung thật phải giữ trạng thái ở trên `WorkspaceLayout` | Chưa làm |
| Task006 | `/lab` có `<main>` riêng, và tab engine ở thanh trên chưa tác động lên `/lab` | Chưa làm |
| Task006 | Dòng giải thích tab khóa không tự mất cho đến khi focus hoặc bấm tab khác | `needs_validation` |
| Task013 | Kiểm trong `next build` xem `libpg-query.wasm` và `pageinspect.tar.gz` có được phát ra đúng chỗ không | Chưa làm |
| Task016 | `spikes/mysql-lock` không bắt signal, Ctrl-C giữa chừng có thể để sót container `t016-mysql` | Chưa làm |
| Task016 | Mới kiểm trên MySQL 8.4.13, chưa kiểm 8.0 hay 9.x | Chưa làm |
| Task012 | Đo PGlite trên máy RAM thấp thật trước khi chốt mức 500k, vì đỉnh RAM lúc khởi tạo khoảng 1,1 GB | Chưa làm |
| Task012 | Chưa chạy lại `npm run measure` sau bản sửa `clearTimeout`, chưa thử `npm ci` từ thư mục sạch | Chưa làm |
| Task010 | `compress: false` của Task014 chưa đưa vào `web/next.config.ts`. Chỉ cần nếu tự host bằng `next start` | Chưa làm |
| Task010 | `next start` thiếu `API_ORIGIN` lúc chạy vẫn rơi về `localhost:8080`, không báo lỗi | Chưa làm |
| Task010 | GitHub tắt workflow theo lịch sau 60 ngày repo không có hoạt động, làm `keep-awake` ngừng | Chưa làm |
| Task010 | AC7 chưa làm: chưa đo cookie và stream qua Vercel thật vì `api/` chưa có route stream. Đo khi SP005 có cookie đăng nhập và SP012 có stream AI | Chưa làm |
| Task009 | `HEAD /healthz` trả 405. Chỉ cần sửa nếu ping giữ thức dùng HEAD. Task010 dùng GET | `needs_validation` |
| Task022 | Chưa kiểm PGlite thật trả gì cho `infinity` của timestamptz. Nếu trả `Date` không hợp lệ thì lưới hiện `Invalid date` thay vì `infinity`. Kiểm khi gắn vào Task020 | `needs_validation` |
| Task022 | AC5 (cuộn ngang ở 390 px) chưa kiểm trên trình duyệt thật, và bản sửa `affectedRows` chưa qua vòng kiểm lại của reviewer. Task020 chụp ảnh 390 px | `needs_validation` |
| Task019 | Route thử `web/src/app/[locale]/e2e-adapter/` đi vào bản production. Chặn hoặc loại ở SP013 | Chưa làm |
| Task019 | Chưa thử `worker_crashed` do hết bộ nhớ thật. Chưa kiểm worker trên Vercel, Firefox, Safari | `needs_validation` |
| Task019 | Test AC2 (khung main thread dưới 200 ms) trượt 1 lần khi máy bận, chạy riêng thì đạt. Có thể gây đỏ giả trên CI | `needs_validation` |
| Task019 | `rebuild` chạy lại `history`, nên câu không tất định như `random()` có thể cho dữ liệu khác. Giao diện nên nói rõ khi dựng lại | Chưa làm |
