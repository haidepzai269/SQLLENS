# Task046: Chuẩn hóa plan

Thuộc: SP007 / STR029
Mục tiêu: `EXPLAIN` của hai engine đưa về cùng kiểu `Plan`, có số dòng và số trang đọc khi engine cung cấp.
Phạm vi: `web/src/engines/postgres/explain*`, `web/src/engines/postgres/worker.ts`, `protocol.ts`, `adapter.ts`, `web/src/contracts/engine.ts`, `web/src/modules/plan-runner/normalize/**`, `web/e2e/plan-explain.spec.ts`.
Không làm: giao diện, MySQL thật (SP004 STR019), sửa `web/src/contracts/plan.ts` (đã chốt, cần đổi thì báo phiên chính).

Hợp đồng:
- `normalizePostgres(json: unknown): Plan` đọc kết quả `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS)`. `pagesRead` là tổng shared hit và read của chính node.
- `normalizeMysql(json: unknown): Plan` đọc kết quả `EXPLAIN FORMAT=JSON` của MySQL 8.4. Không có số thật thì `analyzed: false`.
- Hàm thuần, không phụ thuộc trình duyệt. Node lạ thì `kind: "other"`, giữ nguyên `label`, không ném lỗi.
- `EngineAdapter.explain(sql)` đổi thành `Promise<Outcome<Plan>>`. Kết luận nhãn Thật khi đã chạy. Câu không `EXPLAIN` được (ví dụ DDL, nhiều câu) trả `NotSimulated` với lý do riêng.
- `EXPLAIN ANALYZE` chạy thật câu đó, nên câu ghi dữ liệu (`INSERT`, `UPDATE`, `DELETE`) phải chạy trong transaction rồi rollback, và không vào `history()`. Câu đi qua lớp bảo vệ của Task021, chạy dưới `sqllens_user`.

Tiêu chí xong:
- AC1: Trên PGlite thật, bảng 10k dòng có index: `SELECT ... WHERE id = 1` cho `index_scan` hoặc `index_only_scan`, có `index`, `table`, `actualRows`, `pagesRead`. Bỏ index thì `seq_scan`, `pagesRead` lớn hơn rõ.
- AC2: Câu `JOIN` hai bảng cho đúng `nested_loop`, `hash_join` hoặc `merge_join`, cây con đúng cấu trúc của JSON gốc. Ép từng loại bằng `SET enable_*` trong test.
- AC3: `UPDATE` qua `explain`: dữ liệu không đổi sau đó (đối chiếu checksum), `history()` không đổi.
- AC4: `normalizeMysql` với ít nhất 4 mẫu JSON thật của MySQL 8.4 (lấy bằng Docker, `mysql:8.4.13`, tên container `t046-*`, xóa khi xong, lưu mẫu vào thư mục test): full scan, index lookup, join, sort. Không có `pagesRead` thì để `undefined`.
- AC5: Không có trường thời gian nào lọt vào `Plan`.
- AC6: Câu sai cú pháp trả lỗi SQL như `execute`, không sập. Giao dịch đang mở hoặc hỏng thì `NotSimulated`, không phá transaction của người dùng.
- AC7: `npm run check`, `npm run build`, `npx playwright test --workers=1` đều đạt.

Ca biên: subplan và CTE; plan rất sâu; số `loops` lớn hơn 1 thì `actualRows` là tổng hay trung bình phải ghi rõ trong code và test.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test --workers=1`
Góc review thêm: nhãn kết luận, bảo mật (đi vòng qua lớp bảo vệ).
Đọc thêm: bàn giao Task021, Task025, Task027; `CLAUDE.md` nguyên tắc 1, 3, 4.
