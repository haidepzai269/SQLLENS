# Bàn giao Task056

Đã làm: component `<WhatIfCompare adapter probe />` (ô soạn cách sửa, nút Chạy, Ctrl+Enter, hai cột trước và sau với số dòng, số trang và `PlanTree` mang nhãn Thật, dòng chênh lệch số trang bằng câu trung tính "trong kịch bản này"). Mỗi lần chạy có số thứ tự nên câu trả về muộn không ghi đè câu mới, kết quả cũ bị thay. Có trạng thái chưa chạy, đang chạy, ô rỗng, lỗi SQL kèm dòng và cột, lỗi lớp bảo vệ, lỗi engine, `NotSimulated` kèm lý do, và ghi chú khi cách sửa đã bị chỉnh sau kết quả. Chỉ khi probe là `SELECT` mới hiện số dòng và cảnh báo `rowsChanged` (theo ghi chú Task054); probe khác thì hiện ghi chú "không so số dòng". Không có thời gian chạy ở đâu.
File chính: `web/src/modules/what-if/compare-ui/what-if-compare.tsx`, `web/src/app/[locale]/e2e-whatif/{page,harness}.tsx`, `web/messages/{vi,en}/whatIfUi.json`, `web/e2e/whatif.spec.ts`, ảnh chụp ở thư mục task (vi/en x 1440/390: idle, kết quả, rowsChanged, lỗi).
Kết quả kiểm tra: `npm run check` (i18n, lint, typecheck, vitest 327 đạt, 13 bỏ qua) đạt; `API_ORIGIN=http://localhost:8080 npm run build` thoát 0; `E2E_PORT=3156 npx playwright test e2e/whatif.spec.ts --workers=1` 12/12 đạt (gồm checksum md5 bảng và số index không đổi sau CREATE INDEX, DELETE, UPDATE probe, lỗi SQL; bấm Chạy liên tục; `-- slow` trả muộn; bàn phím; không cuộn ngang ở 390). Server đã tắt. Sau khi bỏ hai khóa dịch thừa chỉ chạy lại `check-i18n` (đạt), chưa chạy lại cả bộ.
Ảnh đã tự xem: en-1440 và vi-390 (bản cuối, chiều cao lớn), en-1440-rows và vi-390-rows (bản cũ, bị cắt), vi-1440-error, en-390-error, và bản đầu của en-1440, vi-390. Chưa xem lại: vi-1440, en-390 bản cuối, các ảnh idle.
Kết quả review: 0 lỗi confirmed. needs_validation 1: lỗi SQL của câu probe (đo "trước") có `position` tính trên chuỗi có tiền tố `EXPLAIN (...)`, UI có thể gán nhầm vào ô sửa; chưa tái hiện, không sửa (harness dùng probe hợp lệ). Đã bỏ 2 khóa dịch không dùng (`pagesCount`, `failed.sql`). Reviewer không chạy build và Playwright; tôi đã chạy.
Chưa làm được: ca "engine đang bận" chỉ xử lý bằng hàng đợi sẵn của adapter, không có test riêng; plan rất sâu không có test riêng ở màn hình này (Task048 đã thử); chưa thử cảm ứng thật, Firefox, Safari.
Phát sinh:
- Lỗi probe có thể bị chỉ vị trí lên ô sửa: `tryChange` nên báo lỗi probe tách khỏi lỗi change.
- Route `e2e-whatif` phải chặn ở SP013.
- Nút Chạy vẫn bấm được khi đang chạy (chủ ý, để chạy lại ngay); lần cũ không bị hủy trong worker, chỉ bị bỏ kết quả.
- Component `Badge` trùng lặp đã tránh bằng dùng nhãn của `PlanTree`; vẫn nên tách Badge chung.
- `isSelect` bảo thủ với `WITH ... SELECT` và `(SELECT`: ẩn số dòng.
Việc tiếp theo cần biết: gắn vào `stage` cần `<WhatIfCompare adapter probe />` với adapter PostgreSQL; namespace dịch `whatIfUi` cộng khóa engine trả về (`tryChange.*`, `whatIfCompare.*`, `guard.*`) qua translator gốc. Build cần `API_ORIGIN` đặt trước.
