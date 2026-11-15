# Task133: Rào chắn SQL SQLite & UI chọn engine, nhãn "chưa mô phỏng được"

Thuộc: SP020 / STR094
Mục tiêu: SQL người dùng chạy trong hộp kín của trình duyệt, không mở được đường ra ngoài, và các tab không làm được thì nói thật là không làm được.

Phạm vi:
- `web/src/engines/sqlite/guard.ts`
- `web/src/engines/sqlite/guard.test.ts`
- `web/src/modules/lab/stage/stage-data.ts`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/messages/vi/labStage.json`, `web/messages/en/labStage.json`

Không làm:
- Không sửa adapter (Task132).
- Không làm tab B-Tree cho SQLite (không có dữ liệu để vẽ).
- Không thêm engine thứ tư.

Hợp đồng:
- `assertSqliteSafe(sql: string): { ok: true } | { ok: false; reason: "attach" | "vacuum_into" | "load_extension" | "attach_hidden" }`
- Tab Plan và tab B-Tree nhận `engine: "sqlite"` thì trả trạng thái `not_simulated` kèm key lý do i18n, không trả mảng rỗng im lặng.

Tiêu chí xong:
- AC1: Chặn `ATTACH`, `DETACH`, `VACUUM INTO`, `load_extension(...)`, kể cả khi viết hoa/thường lẫn, có chú thích chen giữa, hoặc nằm trong chuỗi nhiều câu lệnh.
- AC2: Lệnh bị chặn trả lỗi rõ cho người dùng (vi/en), không chạy một phần.
- AC3: Engine SQLite xuất hiện trong danh sách chọn engine, chọn được, giữ nguyên lựa chọn sau F5.
- AC4: Tab Plan và B-Tree với SQLite hiện "chưa mô phỏng được" kèm lý do cụ thể (không có `EXPLAIN (ANALYZE, BUFFERS)`, không có `pageinspect`), không có biểu đồ giả.
- AC5: Không có màn hình nào hiển thị số liệu bịa cho SQLite (rà soát toàn bộ tab).
- AC6: Unit test phủ 5 dạng chặn + 3 dạng hợp lệ (`SELECT`, `PRAGMA table_info`, `CREATE VIEW`).

Ca biên: `SELECT 'ATTACH'` (chuỗi, không phải lệnh) phải cho qua; `/*x*/ATTACH`; `attach` viết thường; SQL 2MB.
Giao diện: thông báo chặn vi/en, nêu rõ lệnh nào bị chặn; tab "chưa mô phỏng được" có giải thích, không phải trang trắng.
Kiểm tra: `npm run check` và `npx vitest run web/src/engines/sqlite/guard.test.ts`.
Góc review thêm: bảo mật (SQL người dùng), nhãn kết luận (Core Rule 4).
Đọc thêm: `web/src/engines/postgres/guard.ts`, `_bmad-output/SP018/STR088/`.
