# Task116: Nâng cấp động cơ Heuristics nhận thức Scope và mở rộng Foreign Key JOIN

Thuộc: SP017 / STR083
Mục tiêu: Khắc phục triệt để lỗi logic trong động cơ Heuristics cục bộ (BUG-SP016-04):
1. `predictGroupBy`: Nhận thức độ sâu ngoặc đơn (Paren-depth aware) để bỏ qua subquery trong `WHERE`, chỉ lấy `SELECT` ở cấp độ ngoặc ngoài cùng (`parenDepth === 0`).
2. `predictFkJoin`: Mở rộng khả năng nhận diện khi người dùng đã tự tay gõ tên bảng sau `JOIN` (ví dụ `JOIN orders ` hoặc `JOIN orders o `) để tự động gợi ý tiếp `ON orders.user_id = u.id`.

Phạm vi:
- `web/src/modules/editor/heuristics/group-by-predictor.ts`
- `web/src/modules/editor/heuristics/fk-join-predictor.ts`
- `web/src/modules/editor/heuristics/sql-heuristics.test.ts`

Không làm:
- Không sửa đổi cấu trúc dữ liệu `types.ts` hoặc logic CodeMirror extension (Task117 phụ trách).
- Không gọi network hoặc backend AI (duy trì 100% deterministic code-based 0ms, 0đ).

Hợp đồng:
- `predictGroupBy(input: { textBeforeCursor: string; tables?: TableSchema }): string | null`:
  - Tìm `GROUP BY` ở cuối chuỗi.
  - Quét tìm `SELECT` và `FROM` tương ứng ở cấp độ ngoặc `parenDepth === 0` (bỏ qua mọi `SELECT` nằm trong ngoặc đơn `(...)` của subquery).
  - Trả về danh sách cột non-aggregate duy nhất của câu truy vấn hiện tại.
- `predictFkJoin(input: { textBeforeCursor: string; tables?: TableSchema; foreignKeys?: ForeignKeyRelation[] }): string | null`:
  - Trường hợp 1 (Bare JOIN): `... JOIN ` -> gợi ý `<candidate_table> [alias] ON ...` (giữ nguyên logic hiện có).
  - Trường hợp 2 (JOIN with Table): `... JOIN <target_table> [alias] ` -> phát hiện bảng mục tiêu `<target_table>` và alias, tra cứu foreign key giữa `<target_table>` và các bảng trước đó, gợi ý: `ON <target_ref>.<col> = <existing_ref>.<col>`.

Tiêu chí xong:
- AC1: Subquery trong WHERE: Khi câu lệnh có `SELECT u.dept, COUNT(*) FROM users u WHERE u.id IN (SELECT user_id FROM orders) GROUP BY `, `predictGroupBy` gợi ý chính xác `u.dept`, hoàn toàn bỏ qua `user_id`.
- AC2: Subquery lồng nhiều cấp: Hỗ trợ câu lệnh có CTE hoặc nhiều cấp subquery lồng nhau, nhận diện đúng các cột của SELECT cấp cao nhất.
- AC3: Đã gõ tên bảng sau JOIN (chưa alias): Khi gõ `SELECT * FROM users u JOIN orders `, `predictFkJoin` nhận diện `orders` và gợi ý `ON orders.user_id = u.id`.
- AC4: Đã gõ tên bảng sau JOIN (có alias): Khi gõ `SELECT * FROM users u JOIN orders o `, `predictFkJoin` nhận diện alias `o` và gợi ý `ON o.user_id = u.id`.
- AC5: Vừa gõ JOIN (bare JOIN): Giữ nguyên tương thích ngược gợi ý trọn gói bảng và vế ON.
- AC6: Unit tests trong `sql-heuristics.test.ts` đạt 100% PASS, kiểm thử đầy đủ các ca subquery, CTE và foreign key đa chiều.

Ca biên: Dấu ngoặc đơn nằm trong string literal (`'hello (world)'`) hoặc comment (`-- (comment)`) không làm lệch `parenDepth`; bảng không có quan hệ FK trả về `null` an toàn.
Kiểm tra: `cd web; npm run check; npx vitest run src/modules/editor/heuristics/sql-heuristics.test.ts`.
Góc review thêm: Độ chính xác của AST matcher / Hiệu năng tính toán in-memory < 1ms / Tính an toàn không văng exception.
Đọc thêm: `_bmad-output/SPEC_VA_LOI_SP016.md` mục 2 (BUG-SP016-04) và mục 3 (STR083).
