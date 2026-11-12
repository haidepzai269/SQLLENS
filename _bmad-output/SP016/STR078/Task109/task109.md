# Task109: Động cơ Heuristic AST gợi ý cục bộ: Foreign Key JOIN ON, GROUP BY non-aggregate và INSERT column list

Thuộc: SP016 / STR078
Mục tiêu: Xây dựng động cơ phân tích cú pháp quy tắc cục bộ (Client-side SQL Heuristic Matcher) thuần TypeScript, tính toán < 1ms, 0đ chi phí, 0 token; tự động suy luận gợi ý viết tiếp cho các cấu trúc SQL kinh điển: `JOIN ... ON ...` theo khóa ngoại, `GROUP BY` bốc cột trần, và `INSERT INTO` bung cột.

Phạm vi:
- `web/src/modules/editor/heuristics/sql-heuristics.ts`
- `web/src/modules/editor/heuristics/fk-join-predictor.ts`
- `web/src/modules/editor/heuristics/group-by-predictor.ts`
- `web/src/modules/editor/heuristics/insert-columns-predictor.ts`
- `web/src/modules/editor/heuristics/sql-heuristics.test.ts`
- `web/src/modules/editor/heuristics/types.ts`

Không làm: Không dùng LLM hay gọi API mạng; không xử lý toàn bộ AST ngữ nghĩa của trình biên dịch đầy đủ (chỉ phân tích lát cắt câu lệnh quanh con trỏ); không làm chậm luồng gõ phím của editor.

Hợp đồng:
- `predictNextSqlSnippet({ docText, cursorOffset, tables, foreignKeys }): string | null`: Trả về đoạn text gợi ý tiếp theo (hoặc `null` nếu không đủ điều kiện tự tin).
- `predictFkJoin({ textBeforeCursor, tables, foreignKeys }): string | null`.
- `predictGroupBy({ textBeforeCursor, tables }): string | null`.
- `predictInsertColumns({ textBeforeCursor, tables }): string | null`.

Tiêu chí xong:
- AC1: **Dự đoán `JOIN ... ON ...` qua Foreign Key Graph:**
  - Nhận diện khi người dùng vừa gõ `FROM table_a [alias_a] JOIN ` hoặc `FROM table_a, JOIN `.
  - Quét danh sách khóa ngoại: nếu `table_b` liên kết với `table_a` (hoặc ngược lại), sinh chính xác chuỗi:
    `table_b alias_b ON alias_b.fk_id = alias_a.id`.
- AC2: **Dự đoán `GROUP BY` tự động:**
  - Khi người dùng gõ `GROUP BY `, quét ngược lại mệnh đề `SELECT`.
  - Trích xuất toàn bộ các cột không được bọc trong hàm tổng hợp (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`), tự động ghép thành danh sách:
    `col1, col2`.
- AC3: **Dự đoán danh sách cột khi `INSERT INTO`:**
  - Khi người dùng gõ `INSERT INTO table_name `, tự động trích xuất toàn bộ cột của bảng đó trong schema và gợi ý:
    `(col1, col2, col3) VALUES ()`.
- AC4: **Dự đoán tiếp bước (Lifecycle Next Clause):**
  - Sau `SELECT ... FROM table` -> gợi ý tiếp ` WHERE ` hoặc ` ORDER BY id DESC`.
- AC5: Động cơ trả về kết quả trong thời gian < 1ms, không sinh ngoại lệ với bất kỳ chuỗi SQL gõ dở nào.
- AC6: Unit test toàn diện kiểm thử mọi mẫu ngữ cảnh SQL trên cả dialect Postgres và MySQL đạt 100%.

Ca biên: SQL có cú pháp gõ dở/lỗi; bảng không có khóa ngoại nào; mệnh đề SELECT chỉ toàn hàm aggregate (không cần GROUP BY); bảng có 50 cột (giới hạn danh sách hợp lý).
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/editor/heuristics/sql-heuristics.test.ts`.
Góc review thêm: Độ chính xác của câu lệnh SQL sinh ra / Tốc độ xử lý in-memory.
Đọc thêm: `_bmad-output/SPEC_SMART_EDITOR.md` mục 3 (STR078) & `MUC_TIEU_TRUOC_MAT.md` mục 6.

