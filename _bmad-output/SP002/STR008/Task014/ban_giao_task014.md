# Bàn giao Task014

Đã làm: spike server Go (Gin 1.12.0) và app Next 16.4.4 với rewrites `/api/:path*`. Đã đo cookie và stream trên `next start`, có test Playwright.
File chính: `spikes/stream-cookie/server/main.go`, `spikes/stream-cookie/web/next.config.ts`, `spikes/stream-cookie/web/e2e/spike.spec.ts`, `_bmad-output/SP002/STR008/Task014/ket_qua.md`.
Kết quả kiểm tra: `npm run build` và `npm run check` đạt 2/2. AC1 đạt (cookie `sid` HttpOnly, Lax, trên domain `localhost:3140`). AC2 đạt: 10 phần, cách nhau 2711 ms. AC3: nguyên nhân gom stream là `compress` mặc định của `next start`, header không ảnh hưởng. AC4 chưa kiểm trên Vercel, bước chạy lại ở `ket_qua.md`. AC5 xong.
Kết quả review: 1 vòng, không có lỗi chặn, 3 điểm nhỏ đều đã sửa: test AC1 giờ kiểm thêm Set-Cookie không có Domain (trường domain `localhost` không phân biệt Next với Go vì cổng không nằm trong cookie), bước Render ghi rõ spike chưa có Dockerfile, lệnh đổi thành `npm ci` và đã chạy `npm ci` thật, 2/2 test vẫn đạt. Không có needs_validation. Reviewer chưa đo lại từng ô bảng AC3, Route Handler, Vercel, HTTPS thật.
Chưa làm được: AC4 (Task010 chưa có, chưa có tài khoản Vercel, Render). Chưa thử Secure qua HTTPS. Mỗi ô đo header chỉ một lần.
Phát sinh: `web/next.config.ts` cần `compress: false` nếu tự host bằng `next start`. SP005 cần kiểm Origin cho CSRF và không đọc cookie ngoài `sid`.
Việc tiếp theo cần biết: trên Vercel phải đo lại AC1 và AC2, nhất là khi rewrites trỏ tới Render.
