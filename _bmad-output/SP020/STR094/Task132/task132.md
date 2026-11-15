# Task132: Adapter SQLite trong worker theo hợp đồng EngineAdapter

Thuộc: SP020 / STR094
Mục tiêu: Chạy SQL SQLite trong Web Worker và trả kết quả cùng hình dạng với PGlite, để phần còn lại của app không phải biết engine nào đang chạy.

Phạm vi:
- `web/src/engines/sqlite/adapter.ts`
- `web/src/engines/sqlite/worker.ts`
- `web/src/engines/sqlite/protocol.ts`
- `web/src/engines/sqlite/adapter.test.ts`

Không làm:
- Không sửa `web/src/contracts/engine.ts` (nếu thấy thiếu thì báo, không tự nới hợp đồng).
- Không làm UI chọn engine (Task133).
- Không nhập/xuất file (Task134, Task135).
- Không thêm rào chắn SQL (Task133).

Hợp đồng:
- Triển khai `EngineAdapter` từ `web/src/contracts/engine.ts` cho engine `sqlite`.
- `run(sql: string, options?: { timeoutMs?: number }): Promise<{ fields: string[]; rows: unknown[][]; durationMs: number }>`
- `reset(): Promise<void>` tạo DB mới trong bộ nhớ.
- `cancel(): void` ngắt câu lệnh đang chạy.
- Lỗi trả về cùng định dạng `ApiError` như engine Postgres.

Tiêu chí xong:
- AC1: `CREATE TABLE` + `INSERT` + `SELECT` trả đúng số dòng và đúng kiểu giá trị (số, chuỗi, NULL, blob chuyển base64).
- AC2: Chỉ tải WASM khi engine SQLite được chọn; trang editor không tăng kích thước chunk khi chưa chọn (so số build).
- AC3: Lỗi cú pháp trả lỗi có mã, worker không chết, câu lệnh sau vẫn chạy được.
- AC4: `timeoutMs` mặc định 1.500ms; câu lệnh vượt ngưỡng bị ngắt và trả lỗi timeout, UI không đóng băng.
- AC5: Không có request mạng nào trong lúc chạy SQL (test grep + network log).
- AC6: Unit test phủ AC1, AC3, AC4 với WASM thật (không mock engine).

Ca biên: 100k dòng kết quả (phân trang ở tầng UI), tên bảng/cột Unicode, SQL rỗng, nhiều câu lệnh trong một chuỗi, `BEGIN` không `COMMIT`.
Kiểm tra: `npm run check` và `npx vitest run web/src/engines/sqlite/adapter.test.ts`.
Góc review thêm: đúng hợp đồng engine, test có chạy WASM thật.
Đọc thêm: `web/src/contracts/engine.ts`, `web/src/engines/postgres/adapter.ts`, `_bmad-output/SP020/STR093/Task131/task131.md`.
