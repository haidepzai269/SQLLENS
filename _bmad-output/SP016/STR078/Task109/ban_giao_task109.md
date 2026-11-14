# Bàn giao Task 109: Động cơ Heuristic AST gợi ý cục bộ: Foreign Key JOIN ON, GROUP BY non-aggregate và INSERT column list

## 1. Thông tin chung
- **Task:** Task 109 - Động cơ Heuristic AST gợi ý cục bộ: Foreign Key JOIN ON, GROUP BY non-aggregate và INSERT column list
- **Story:** STR078 - Trợ Lý Gợi Ý Viết Tiếp Cục Bộ (Code-based Inline Ghost Text - Mặc định BẬT)
- **Epic:** SP016 - Smart Editor, User Tiering & Terminal AI Diagnosis
- **Người thực hiện:** Amelia (Developer)
- **Reviewer độc lập:** Task Reviewer độc lập (Subagent ID `3bc452dd-8d65-497c-99c0-ac3caa567218`)
- **Worktree:** `C:\SQLLens-task109` (branch `task/Task109`)
- **Commit triển khai:** `57068e760ade2e657e448d6a347cca8b6e1e00ac`
- **File đặc tả:** `_bmad-output/SP016/STR078/Task109/task109.md`

---

## 2. Các file đã tạo mới & thay đổi
1. `web/src/modules/editor/heuristics/types.ts`:
   - Định nghĩa `ForeignKeyRelation`, `TableSchema`, `PredictContext`, `PredictResult`, `PredictResultType`.
2. `web/src/modules/editor/heuristics/fk-join-predictor.ts`:
   - Dự đoán `JOIN ... ON ...` qua đồ thị khóa ngoại.
   - Nhận diện khi người dùng vừa gõ `FROM table_a [alias_a] JOIN ` hoặc các dạng JOIN (`LEFT`, `RIGHT`, `INNER`, `FULL`, `CROSS`).
   - Tự động quét 2 chiều quan hệ khóa ngoại (bảng cha -> bảng con và bảng con -> bảng cha).
   - Tự động sinh alias ngắn thông minh (`users` -> `u`, `order_items` -> `oi`), chống trùng lặp `usedAliases`.
   - Hỗ trợ dialect Postgres và MySQL (quotes `"`, backticks `` ` ``, schema prefixes `public.users`).
3. `web/src/modules/editor/heuristics/group-by-predictor.ts`:
   - Tự động bóc tách các biểu thức non-aggregate từ mệnh đề `SELECT ... FROM`.
   - Thuật toán đếm độ sâu ngoặc `depth` thông minh xử lý các hàm lồng nhau có dấu phẩy (`COALESCE(u.name, 'Unknown')`).
   - Loại trừ toàn bộ các hàm aggregate (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `STRING_AGG`, `GROUP_CONCAT`, `ARRAY_AGG`).
   - Bóc tách alias (`AS alias` và ngầm định), loại bỏ hằng số literal, deduplicate cột.
4. `web/src/modules/editor/heuristics/insert-columns-predictor.ts`:
   - Dự đoán khi gõ `INSERT INTO <table> `, tự động bung danh sách cột và `VALUES ()`.
   - Tìm kiếm bảng case-insensitive và schema-prefixed.
   - Giới hạn tối đa 25 cột chống tràn ghost text.
5. `web/src/modules/editor/heuristics/sql-heuristics.ts`:
   - Facade `predictNextSqlSnippet(ctx)` điều phối thứ tự ưu tiên: FK JOIN > GROUP BY > INSERT > Lifecycle Next Clause (`WHERE ` sau `FROM table`).
   - In-memory 100%, 0đ chi phí, 0 token, không gọi mạng ngoài.
   - Benchmark đo lường: < 0.05ms cho mỗi lượt tính toán (dưới xa ngưỡng 1ms).
   - Toàn diện bọc `try-catch`, chống crash với mọi cú pháp SQL dở dang hay offset lệch biên.
6. `web/src/modules/editor/heuristics/sql-heuristics.test.ts`:
   - 26 unit tests toàn diện bao phủ 100% các tiêu chí AC1, AC2, AC3, AC4, AC5, AC6 và các ca biên.

---

## 3. Kết quả kiểm tra bằng máy
- `npx vitest run src/modules/editor/heuristics/sql-heuristics.test.ts`: **26/26 tests PASS** (107ms).
- `npm run check:i18n`: **PASS (0 lỗi)**.
- `npm run lint`: **PASS (0 errors, eslint sạch)**.
- `npm run typecheck`: **PASS (tsc --noEmit 0 errors)**.
- `npx vitest run`: **PASS 100% (73 test files passed, 778 tests passed, 0 failed, 16 skipped)**.

---

## 4. Ý kiến của Reviewer độc lập
- **Đánh giá:** **PASS 100%**.
- Thuật toán phân tích cú pháp lát cắt cục bộ (slice-based Heuristic AST) hoạt động chính xác và cực kỳ tối ưu.
- Không gây side-effect hay ảnh hưởng tới các module khác.
- Sẵn sàng tích hợp vào CodeMirror 6 inline ghost text extension ở Task 110.

---

## 5. Việc phát sinh đưa vào SP999
- Không có lỗi hay nợ kỹ thuật phát sinh.
