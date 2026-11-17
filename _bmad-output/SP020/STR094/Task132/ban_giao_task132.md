# Bàn giao Task132

Đã làm: Adapter SQLite chạy qua Web Worker theo hợp đồng `EngineAdapter` (`execute` trả `QueryResult[]`, timeout mặc định 1.500 ms, `cancel`/`rebuild`/`fresh`/`reset`/`history`/`dispose`), tách câu bằng `sqlite3_prepare_v2` + `pzTail` và chạy xen kẽ từng câu nên `CREATE TABLE` rồi `INSERT` trong cùng chuỗi hoạt động, BLOB chuyển base64, tên bảng/cột Unicode giữ nguyên. Plan/B-Tree/TryChange trả `not_simulated` thay vì bịa dữ liệu (Core Rule 4). Nạp WASM bằng `import()` động bên trong worker (chỉ khi gọi `init`).

File chính:
- `web/src/engines/sqlite/worker.ts` (session WASM thật + tách câu + message loop)
- `web/src/engines/sqlite/adapter.ts` (hàng đợi, timeout, rebuild theo history, nhãn chưa mô phỏng được)
- `web/src/engines/sqlite/protocol.ts` (3 message: init/exec/progress)
- `web/src/engines/sqlite/adapter.test.ts` (6 test)
- `web/messages/{en,vi}/sqlite.json` (nhãn `sqlite.notSimulated.*`)
- `web/package.json` + lockfile: thêm `@sqlite.org/sqlite-wasm` 3.54.1-build1

Kết quả kiểm tra:
- `npm run check` (i18n + lint + typecheck + vitest): PASS, 1101 test pass / 18 skip; lint còn 1 warning có sẵn ở `e2e/plan-explain.spec.ts` (`hist` không dùng), không liên quan.
- `npx vitest run src/engines/sqlite/adapter.test.ts`: 6/6 PASS, chạy WASM thật qua bản `node.mjs` của thư viện.
- `API_ORIGIN=http://127.0.0.1:8080 npx next build`: PASS. Grep `.next/static` và `.next/server` không thấy `sqlite3.wasm` hay `@sqlite.org/sqlite-wasm`: 0 byte vào bundle ở thời điểm chưa nối UI (AC2).
- AC1: kiểm bằng test (Unicode, NULL, REAL, INTEGER, BLOB `x'00ff10'` → `AP8Q`, `affectedRows`). AC3: lỗi cú pháp báo `statementIndex` 2 và câu sau vẫn chạy. AC4: kiểm đường timeout của adapter bằng worker câm (terminate xảy ra, câu sau báo `worker_crashed`), hằng `DEFAULT_TIMEOUT_MS = 1500`. AC5: test grep `fetch(` trong `worker.ts`; không có request mạng trong lúc chạy SQL.

Kết quả review: Chưa có reviewer độc lập trong lượt này (người dùng yêu cầu làm trực tiếp). Tự soát 1 vòng và đã sửa 1 lỗi thật do test bắt được: bản đầu chuẩn bị toàn bộ chuỗi SQL trước khi chạy nên `INSERT` báo "no such table" khi đứng sau `CREATE TABLE`; nay prepare và execute xen kẽ từng câu.

Chưa làm được: (1) Chưa chạy adapter trong Web Worker thật trên trình duyệt — vitest/jsdom không có Worker, nên AC1/AC3 đo qua session WASM thật, AC4 đo qua worker giả; Task133 phải xác nhận trong Chrome thật. (2) Chưa có network log trình duyệt cho AC5, chỉ có grep. (3) Chưa dùng OPFS SAHPool — DB là in-memory; chuyển VFS để dành cho Task134/135 khi có nhập/xuất file.

Phát sinh: (1) `EngineId` trong `web/src/contracts/engine.ts` chưa có `"sqlite"`, và task cấm tự nới hợp đồng, nên adapter trả `SqliteAdapter = Omit<EngineAdapter,"engine"> & { engine: "sqlite" }`; Task133 phải thêm `"sqlite"` vào `EngineId` và các `Record<EngineId, ...>` (dialect, samples, engine-tabs) mới nối được UI. (2) Đường dẫn asset `sqlite3.wasm` do Emscripten tự tìm cạnh `index.mjs` (`new URL("sqlite3.wasm", import.meta.url)`); chưa kiểm Turbopack có phát asset đó trong worker bundle hay không — Task133 phải thử trên Chrome thật, nếu 404 thì chuyển sang fetch wasm tường minh.

Việc tiếp theo cần biết: `reset()` cùng nghĩa `fresh()` (worker mới, DB rỗng, history rỗng). Timeout giết worker và đặt `needsRebuild`, nên UI phải gọi `rebuild()` hoặc `fresh()` sau lỗi `timeout`/`cancelled`. `rebuild()` chạy lại history đã thành công nên DB được dựng lại đúng; câu gây timeout không nằm trong history.
