# Bàn giao Task145 — Route `/share` đọc fragment, trạng thái lỗi, chặn referrer

Đã làm: route `/[locale]/share` (server page) + `ShareView` (client) tự đọc `window.location.hash`, tách `d`, giải mã bằng `decodeSnapshot`, 4 trạng thái `loading | ready | invalid | missing`. `invalid` hiện mã lỗi codec + mô tả vi/en và nút "Về trang chủ"; `missing` hướng dẫn xin link mới; `loading` là trạng thái render đầu tiên nên JS chậm vẫn thấy chữ, không thấy trang trắng. Nghe `hashchange` để dán link mới vào cùng tab, có chống giải mã trùng cùng payload (gán hash cũng phát event, gây nháy loading). `next.config.ts` gắn `Referrer-Policy: no-referrer` cho `/:locale(vi|en)/share`. `robots: noindex`.

Hai thay đổi ngoài danh sách phạm vi, cần reviewer biết:
- `web/src/components/shell/bare-routes.ts` + `app-frame.tsx` + `shell-provider.tsx`: `/share` vào nhóm route không khung ứng dụng, và **không mount `AuthProvider`**. Trước đó ShellProvider gọi `/api/me` trên mọi route, làm trang share phụ thuộc Gin (đo được 500 khi backend tắt) dù dữ liệu đã nằm trong fragment.
- `share-view.tsx` render `<ReadonlyWorkspace />` ở trạng thái ready; khung đó thuộc Task146.

Kiểm tra (máy):
- `npx vitest run src/modules/share/share-view.test.tsx`: 11/11 PASS (4 trạng thái, version sai, payload >32KB, XSS, hashchange, en).
- `npx vitest run src/modules/share`: 64/64 PASS; chạy lặp 8 lần liền không còn flake (flake cũ do `hashchange` làm nháy `loading`).
- `npm run check`: PASS 1.288 test (18 skip vì thiếu `T051/T055_DATABASE_URL`), i18n + lint + typecheck sạch.
- `npm run build` PASS, `next start` rồi `curl -I`: `/vi/share` và `/en/share` trả `Referrer-Policy: no-referrer`, `/vi` không có header này (đối chứng) — xem `referrer-headers.txt`.
- Chrome thật (Playwright trên bản production, 1440px + 390px): 20/20 PASS toàn bộ luồng Task145+146. Riêng Task145: 0 request chứa payload (28 request), 0 request sau khi giải mã xong, hash hỏng ra `SNAPSHOT_CORRUPT` + nút về `/vi` + không lộ stack, `/share` trống ra `missing`, hash có tham số khác vẫn đọc được `d`, SQL chứa `<img onerror>` không tạo DOM sống, 0 lỗi console.

Chưa làm được / giới hạn:
- **Chưa gọi reviewer độc lập** (phiên không có subagent), chưa merge.
- Safari thật chưa mở được: Playwright WebKit trong môi trường này thiếu executable (đã ghi nhận từ Task131). Chỉ kiểm Chromium.
- AC4 kiểm trên `next start` của bản build production tại máy, **không** deploy Vercel.

Phát sinh (SP999): (1) `ShareView` hiện coi mọi lỗi không phải `SnapshotError` là `SNAPSHOT_CORRUPT` — đủ an toàn nhưng che mất lỗi hạ tầng; (2) nên có link "mở lại link gốc" thay vì chỉ về trang chủ khi hash bị chat app cắt.

Việc tiếp theo: Task146 dùng `ReadonlyWorkspace`; Task147 fork, Task148 chạy SQL — đừng thêm `/api/me` trở lại trang share.
