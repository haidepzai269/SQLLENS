# Task025: Thử thay đổi rồi hoàn tác

Thuộc: SP003 / STR015
Điều kiện bắt đầu: Task021 đã merge.
Mục tiêu: Engine áp một thay đổi (thường là tạo index), đo lại một câu truy vấn, rồi hoàn tác hết, để `what-if` (SP010) so trước và sau mà không làm bẩn dữ liệu của người dùng.
Phạm vi: `web/src/engines/postgres/try-rollback*`, `web/src/contracts/engine.ts`.
Không làm: giao diện so sánh (SP010), MySQL (SP010 làm trên bảng clone), chuẩn hóa plan (SP007).

Hợp đồng:
- Thêm vào `EngineAdapter`: `tryChange(change: string, probe: string): Promise<Outcome<TryChangeResult>>`.
- `type TryChangeResult = { before: ProbeStats; after: ProbeStats; plans: { before: unknown; after: unknown } }`
- `type ProbeStats = { rows: number; sharedHitBlocks: number; sharedReadBlocks: number; nodeTypes: string[] }`, lấy từ `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`.
- Trình tự: đo `probe` trước; `BEGIN`; chạy `change`; đo `probe` lần nữa; `ROLLBACK`. Tất cả chạy dưới `sqllens_user`, qua `checkUserSql` của Task021.
- Kết quả là `Conclusion` nhãn Thật, `evidence` gồm số trang đọc trước và sau. Không trả thời gian chạy làm bằng chứng, theo nguyên tắc 3.

Tiêu chí xong:
- AC1: Bảng `orders` 100k dòng không có index trên `customer_id`, `change` là `CREATE INDEX ON orders(customer_id)`, `probe` là `SELECT * FROM orders WHERE customer_id = 42`: `after.sharedHitBlocks + after.sharedReadBlocks` nhỏ hơn trước, `nodeTypes` trước có `Seq Scan`, sau có `Index Scan` hoặc `Bitmap Index Scan`.
- AC2: Sau `tryChange`, `pg_indexes` không có index mới, và checksum của bảng (`SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM orders t`) giống trước.
- AC3: `change` chứa `COMMIT`, `ROLLBACK`, `BEGIN`, hoặc `CREATE INDEX CONCURRENTLY`: bị từ chối trước khi chạy, trả `NotSimulated` với lý do rõ, dữ liệu không đổi.
- AC4: `change` lỗi cú pháp hoặc lỗi khi chạy: vẫn `ROLLBACK`, trả lỗi, dữ liệu không đổi.
- AC5: `probe` không phải câu đọc (`INSERT`, `UPDATE`, `DELETE`): chạy trong transaction riêng rồi rollback, để đo không làm đổi dữ liệu. Có test.
- AC6: Timeout giữa chừng: theo cơ chế của Task019, sau khi dựng lại dữ liệu đúng như trước `tryChange`.
- AC7: `npm run check` và `npm run build` thoát với mã 0.

Ca biên: `probe` dùng tham số chưa gán như `$1` thì trả lỗi rõ.
Kiểm tra: `cd web && npm run check && npm run build`
Góc review thêm: nhãn kết luận, bảo mật.
Đọc thêm: `CLAUDE.md` nguyên tắc 1, 3 và bảng "Khác biệt giữa hai engine"; bàn giao Task019, Task021.
