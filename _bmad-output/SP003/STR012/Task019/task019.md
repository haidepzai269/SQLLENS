# Task019: PGlite trong Web Worker

Thuộc: SP003 / STR012
Mục tiêu: Chuyển PGlite từ main thread sang Web Worker, để câu SQL chạy lâu không làm treo giao diện, và có tiến trình tải, timeout, hủy.
Phạm vi: `web/src/engines/postgres/**`, `web/src/contracts/engine.ts`.
Không làm: giao diện (Task020), role quyền thấp (Task021), sinh dữ liệu (Task023), EXPLAIN (SP007).

Hợp đồng:
- `web/src/engines/postgres/worker.ts`: Web Worker chứa PGlite. Giữ cách tự tải ba file WASM rồi truyền vào `PGlite.create` như `adapter.ts` hiện tại, vì PGlite 0.5.14 treo mãi khi tải lỗi.
- `web/src/engines/postgres/protocol.ts`: kiểu message giữa main và worker. Mỗi yêu cầu có `id`, mỗi phản hồi trả đúng `id` đó. Lỗi đi qua message, không để worker chết im lặng.
- `createPostgresAdapter(options?: { onProgress?: (p: LoadProgress) => void; timeoutMs?: number }): Promise<EngineAdapter>` vẫn trả `EngineAdapter` như cũ, chạy qua worker.
- Thêm vào `web/src/contracts/engine.ts`:
  - `type LoadProgress = { phase: "download" | "init"; loadedBytes?: number; totalBytes?: number }`
  - `EngineAdapter.cancel(): Promise<void>`: dừng câu đang chạy.
  - `EngineAdapter.history(): readonly string[]`: các câu đã chạy thành công từ lúc khởi tạo.
  - `EngineAdapter.rebuild(): Promise<void>`: tạo worker mới rồi chạy lại `history()`.
  - Lỗi có kiểu `EngineError = { code: "timeout" | "cancelled" | "load_failed" | "sql" | "worker_crashed"; message: string; position?: number }`. `code: "sql"` giữ thông báo và vị trí lỗi của PostgreSQL.
- `cancel` và timeout làm bằng cách dừng worker (`terminate`), vì PGlite không hủy được câu đang chạy. Sau khi dừng, adapter ở trạng thái `needs_rebuild`, và `execute` trả lỗi rõ cho đến khi gọi `rebuild`.
- `timeoutMs` mặc định 30.000.

Tiêu chí xong:
- AC1: Mở trang không tải WASM, giống Task011. Gọi `createPostgresAdapter` thì tải trong worker và báo `onProgress` ít nhất một lần cho `download` và một lần cho `init`.
- AC2: Chạy `SELECT count(*) FROM generate_series(1, 30000000)` trong lúc đo main thread: `requestAnimationFrame` vẫn chạy, không có khung nào chờ quá 200 ms. Test Playwright đo việc này.
- AC3: Câu chạy quá `timeoutMs` trả `EngineError` `timeout`. `cancel()` giữa chừng trả `cancelled`. Cả hai xảy ra trong vòng 1 giây sau thời điểm yêu cầu.
- AC4: Sau timeout, `execute` trả lỗi yêu cầu dựng lại. Gọi `rebuild()` thì bảng tạo trước đó có lại, kèm dữ liệu.
- AC5: `history()` chỉ chứa câu chạy thành công, không chứa câu lỗi hay câu bị hủy.
- AC6: Tải WASM thất bại trả `load_failed` trong vòng 30 giây, không treo. Gọi lại `createPostgresAdapter` thì thành công.
- AC7: `dispose()` dừng worker. Có test cho việc này, vì Task011 chưa có.
- AC8: Playwright của `lab.spec.ts` vẫn đạt mà không sửa file test, vì giao diện chưa đổi.
- AC9: `npm run check` và `npm run build` thoát với mã 0. `next build` phát ra file worker và ba file WASM đúng chỗ.

Ca biên:
- Worker chết vì lỗi WASM hoặc hết bộ nhớ: trả `worker_crashed`, không treo promise nào.
- Hai `execute` gửi liên tiếp: chạy tuần tự đúng thứ tự gửi.
- Câu SQL lớn vài MB: gửi được qua message.

Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: không có.
Đọc thêm: `web/src/engines/postgres/adapter.ts`; `_bmad-output/SP001/STR006/Task011/ban_giao_task011.md`; `_bmad-output/SP002/STR007/Task012/ket_qua.md`; tài liệu Web Worker của Next.js 16 trong `web/node_modules/next/dist/docs/`.
