# Bàn giao Task019

Đã làm: PGlite chạy trong Web Worker. `createPostgresAdapter({ onProgress, timeoutMs })` vẫn trả `EngineAdapter`, thêm `cancel()`, `history()`, `rebuild()`. Lỗi có kiểu `EngineError` (class kế thừa `Error`, có `code` và `position`). Timeout và cancel dùng `terminate` worker, sau đó `execute` báo lỗi cho đến khi gọi `rebuild()`. `timeoutMs` (mặc định 30.000) chỉ áp cho câu SQL; tải và khởi tạo có hạn riêng 30 giây, quá hạn trả `load_failed`.
File chính: `web/src/engines/postgres/adapter.ts`, `worker.ts`, `protocol.ts`; `web/src/contracts/engine.ts`; test `web/e2e/postgres-worker.spec.ts`.
Kết quả kiểm tra (trong `web/`, `API_ORIGIN=http://localhost:8080`, `E2E_PORT=3119`):
- `npm run check`: thoát 0 (41 test vitest đạt).
- `npm run build`: thoát 0, phát ra `turbopack-worker-*.js` và ba file `pglite.wasm`, `initdb.wasm`, `pglite.data` trong `.next/static`.
- `npx playwright test`: 6 test mới đạt (AC1 đến AC7, ca biên hai execute liên tiếp và SQL 3 MB), `lab.spec.ts` không sửa và đạt. Sau khi sửa lỗi review, chạy cả bộ: 27 đạt, riêng AC2 trượt một lần vì máy đang bận (nhiều task song song); chạy lại riêng `-g AC2` thì đạt (thoát 0), không nới tiêu chí 200 ms.
- AC2 chạy `generate_series(1, 30000000)` đạt (khung chờ dưới 200 ms).
Kết quả review: 1 lỗi đã sửa (`execute` ném đồng bộ khi signal đã abort, nay trả reject `EngineError` `cancelled`). 1 needs_validation đã xử lý phòng ngừa (nếu chạy lại history trong `rebuild` lỗi thì adapter vẫn ở trạng thái cần dựng lại). Còn lại: Task020 phải gọi `rebuild()` trong `lab-client.tsx`, vì sau câu chạy quá 30 giây mọi lần Chạy báo lỗi cho đến khi tải lại trang.
Chưa làm được: chưa thử `worker_crashed` do hết bộ nhớ thật; chưa kiểm trên Vercel, Firefox, Safari.
Phát sinh:
- Route `web/src/app/[locale]/e2e-adapter/` (chỉ gắn `createPostgresAdapter` lên `window` cho Playwright) đi vào bản production. Nên chặn hoặc loại khỏi bản deploy ở SP013.
- `lab-client.tsx` chưa dùng `rebuild()` (Task020).
- `rebuild` chạy lại history nên câu không tất định (`random()`) có thể cho dữ liệu khác trước.
Việc tiếp theo cần biết: `EngineAdapter` có thêm 3 hàm bắt buộc; mọi adapter khác (MySQL) phải cài. Lỗi nay là `EngineError`, `lab-client` vẫn đọc `e.message` nên không đổi. Đường dẫn WASM trong `worker.ts` giữ cách tự tải; nếu đổi chỗ file phải kiểm lại.
