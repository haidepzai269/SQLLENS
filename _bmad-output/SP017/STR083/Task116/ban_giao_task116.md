# Bàn giao Task116: Nâng cấp động cơ Heuristics nhận thức Scope và mở rộng Foreign Key JOIN

Đã làm:
- Khắc phục triệt để lỗi logic BUG-SP016-04 trong động cơ Heuristics cục bộ.
- Trong `predictGroupBy`: Xây dựng thuật toán `maskNonTopLevel` nhận thức độ sâu ngoặc (Paren-depth aware), che giấu các khối ngoặc `(...)` (depth > 0), comment và chuỗi ký tự với tỷ lệ 1:1, bóc tách chính xác các cột non-aggregate của SELECT cha ở `parenDepth === 0`, loại bỏ hoàn toàn việc bắt nhầm subquery trong `WHERE` hay CTE.
- Trong `predictFkJoin`: Mở rộng nhận diện cú pháp `JOIN <target_table> [alias]` khi người dùng đã gõ tên bảng, tự động tra cứu đồ thị khóa ngoại đa chiều và sinh đoạn gợi ý `ON <target_ref>.<col> = <existing_ref>.<col>`, đồng thời giữ nguyên 100% tương thích ngược với Bare JOIN và xử lý an toàn khi đã có `ON`.
- Trong `extractExistingTables`: Quét nhận diện bảng trên chuỗi đã che giấu (`clauseMasked`) để loại bỏ triệt để các bảng trong subquery của `WHERE` và comment giả lập.

File chính:
- `web/src/modules/editor/heuristics/group-by-predictor.ts`
- `web/src/modules/editor/heuristics/fk-join-predictor.ts`
- `web/src/modules/editor/heuristics/sql-heuristics.test.ts`
- `web/src/components/sql-editor/extensions/inline-ghost-text.test.ts`

Kết quả kiểm tra:
- `npm run check` (check:i18n, eslint, tsc --noEmit, vitest): 76 test files / 874 tests PASS 100%, 0 failures.
- `npx vitest run src/modules/editor/heuristics/sql-heuristics.test.ts`: 42/42 tests PASS 100% (thời gian chạy 26ms, tốc độ phân tích in-memory < 0.1ms).

Kết quả review:
- Đã sửa 1 lỗi do Reviewer độc lập phát hiện ở Vòng 1 (chuyển quét `tableRegex` từ `clauseRaw` sang `clauseMasked` trong `extractExistingTables` để không bắt nhầm bảng trong subquery của `WHERE` và comment).
- Reviewer độc lập đã nghiệm thu PASS 100% ở Vòng 2.

Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết:
- Task117 (STR084): Xây dựng bộ điều phối ưu tiên (Precedence Dispatcher) CodeMirror 6, xử lý phân xử phím Tab giữa Dropdown Menu, Inline Ghost Text và AI Copilot. Động cơ Heuristics tại Task116 đã sẵn sàng phản hồi siêu tốc < 0.1ms cho các trường hợp JOIN và GROUP BY phức tạp.
