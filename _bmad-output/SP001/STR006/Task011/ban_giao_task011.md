# Bàn giao Task011

Đã làm: Trang `/[locale]/lab` có `textarea`, nút Chạy, bảng kết quả, trạng thái tải, lỗi, thử lại và rỗng. PGlite nạp bằng `import()` sau khi bấm Chạy, instance dùng lại cho các lần chạy sau, rời trang gọi `dispose`. Chạy thành công thì màn hình nhận `Conclusion` nhãn `real` (số câu, số dòng câu cuối). Job `e2e` đã thêm vào CI.
File chính: `web/src/engines/postgres/adapter.ts`, `web/src/modules/lab/lab-client.tsx`, `web/src/app/[locale]/lab/page.tsx`, `web/messages/{vi,en}/lab.json`, `web/playwright.config.ts`, `web/e2e/lab.spec.ts`, `.github/workflows/ci.yml`, `web/package.json` (thêm script `e2e`).
Kết quả kiểm tra (chạy thật): `npm run check` thoát 0 (8 test). `npm run build` thoát 0. `npx playwright test` 10/10 pass trên `next start` cổng 3100 (AC1, AC2 ở vi và en, AC3, AC4, AC5, AC6, ca biên, Date/bytea, Date infinity). AC7: CI run 41440640948 trên commit 0eea949, job `web`, `api`, `e2e` đều success. Run cho commit cuối 7839c40 (41442311430) đang chạy lúc viết file này.
Kết quả review: task-reviewer mới, 2 vòng. 3 lỗi hiển thị đã sửa (Date/bytea hiện sai, "1 statements" ở tiếng Anh, câu CREATE/INSERT cuối hiện "không trả dòng nào"), và 1 lỗi mới do bản sửa (Date `infinity` làm sập trang) cũng đã sửa. Reviewer xác nhận ở vòng 2. Còn lại: Date không hợp lệ hiện chữ `null` thay vì `NULL`, chưa sửa, không crash. Không có test cho `dispose` khi rời trang.
Chưa làm được: kiểm trên Vercel. Không có test cho `dispose`. Trạng thái "đang tải" chưa có assert trong E2E.
Phát sinh (đưa vào SP999):
- `web/package.json` thêm script `e2e`, và `adapter.ts` tải tay file WASM bằng đường dẫn tương đối vào `node_modules` (xem bên dưới), cần theo dõi khi nâng PGlite.
- Cảnh báo CI về Node.js 20 của các action, chưa xử lý.
Việc tiếp theo cần biết (WASM trong Next.js 16.4.4, STR007 dùng lại):
- `new URL("<đường dẫn tương đối>/pglite.wasm", import.meta.url)` trong code của mình khiến Turbopack tự phát các file `pglite.wasm`, `initdb.wasm`, `pglite.data` ra `.next/static/media/` (có hash). `next build` thành công, không cần cấu hình thêm.
- PGlite 0.5.14 treo mãi, không báo lỗi, nếu tải file WASM thất bại (tái hiện bằng route abort). Vì vậy adapter tự `fetch` cả ba file rồi truyền `pgliteWasmModule`, `initdbWasmModule`, `fsBundle` vào `PGlite.create`. Tải thất bại ra lỗi thật và thử lại được (`adapter.current` bị xóa khi lỗi).
- Đường dẫn dạng `../../../node_modules/@electric-sql/pglite/dist/...` phụ thuộc vị trí file `adapter.ts`; đổi chỗ file thì đếm lại số `../`.
- Route `/lab` là Partial Prerender (`◐`); phải nạp PGlite chỉ ở client sau thao tác, và `setRequestLocale` ở page.
- Lỗi PGlite ném ra là `Error` có `message` của PostgreSQL (ví dụ `syntax error at or near "SELEC"`, `already exists`).
- Role mặc định có quyền cao và chạy trên main thread: đã đánh dấu `shortcut:` cho STR012, STR013.
- Trong test, role `alert` bị `next-route-announcer` chiếm; dùng `data-testid="error"`.
- `exec(sql, { rowMode: "array" })` trả mỗi câu một `Results`; giá trị `Date`, `Uint8Array`, `bigint` cần định dạng riêng khi hiển thị.
