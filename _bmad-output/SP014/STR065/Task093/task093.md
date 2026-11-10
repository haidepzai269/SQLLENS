# Task093: SmartErrorCard UI 1-Click Sửa nhanh & MySQL Matcher

## Bối cảnh & Mục tiêu
Tiếp nối Task091 (Hợp đồng kiểu & Postgres Matcher), Task093 hoàn thiện tầng Frontend của Epic SP014:
1. Xây dựng Heuristic Matcher cho MySQL (`mysql-matcher.ts`) nhận diện các mã lỗi kinh điển của MySQL 8.4 (1050, 1146, 1054, 1062, 1452, 1064, 1048, 1406...).
2. Nâng cấp `web/src/components/result-grid/sql-error-view.tsx` thành `SmartErrorCard`:
   - **Nguyên tắc Raw Error First:** Mặc định hiển thị khối Console lỗi gốc của database engine kèm dòng/cột đỏ rực bôi đậm token lỗi.
   - **Toggle Chế độ xem:** Có nút chuyển `[Nguyên bản]` / `[Dịch nghĩa tiếng Việt]` để người dùng chuyển đổi linh hoạt.
   - **Khối Cứu hộ Quick-Fix 1-Click:** Render các nút hành động sửa nhanh từ `remediation.actions`:
     + `replace_stmt`: Tự động thay thế câu lệnh trong editor.
     + `prepend_stmt`: Tự động chèn câu lệnh lên đầu editor.
     + `rebuild_sandbox`: Nút dọn sạch sandbox PGlite / MySQL và tự chạy lại.
   - **Nút "Hỏi AI Mentor về lỗi này":** Mở drawer / gọi handler chẩn đoán lỗi.
3. Tích hợp `SmartErrorCard` vào `web/src/modules/lab/lab-workspace.tsx` để truyền callback `onApplyFix` (gọi `setSql`) và `onRebuild` (gọi `rebuild`).

## Tiêu chí chấp nhận (AC)
- **AC1 (MySQL Heuristic Matcher):**
  - Tạo `web/src/modules/error-remediation/mysql-matcher.ts` với hàm `matchMysqlError(rawMessage: string, sql: string, position?: number): ErrorRemediation`.
  - Nhận diện các lỗi:
    + 1050: `Table '(\w+)' already exists` -> 3 actions: `replace_stmt` (thêm `IF NOT EXISTS`), `prepend_stmt` (chèn `DROP TABLE IF EXISTS <name>;\n`), `rebuild_sandbox`.
    + 1146: `Table '(\w+)' doesn't exist`.
    + 1054: `Unknown column '(\w+)' in 'field list'`.
    + 1062: `Duplicate entry '(\w+)' for key '(\w+)'`.
    + 1452: `Cannot add or update a child row: a foreign key constraint fails`.
    + 1064: `You have an error in your SQL syntax`.
    + 1048: `Column '(\w+)' cannot be null`.
    + 1406: `Data too long for column '(\w+)'`.
  - Unit test `web/src/modules/error-remediation/mysql-matcher.test.ts` pass 100%.
- **AC2 (Component SmartErrorCard):**
  - Giữ nguyên hiển thị dòng/cột của `locateError`.
  - Khối Console Raw Error hiển thị đầu tiên, giữ nguyên từng ký tự gốc.
  - Hỗ trợ tab/toggle chuyển đổi giữa raw message và bản dịch tiếng Việt / tiếng Anh.
  - Các nút Quick-Fix 1-Click:
    + Bấm `replace_stmt`: gọi `onApplyFix(sql.replace(action.targetSql, action.replacementSql))`.
    + Bấm `prepend_stmt`: gọi `onApplyFix(action.sqlToPrepend + sql)`.
    + Bấm `rebuild_sandbox`: gọi `onRebuild()`.
  - Nút "Hỏi AI Mentor về lỗi này" có icon `Sparkles`.
- **AC3 (Tích hợp vào Lab Workspace):**
  - Trong `lab-workspace.tsx`: Khi `state.phase === "sql_error"`, render `SmartErrorCard` với `onApplyFix={(newSql) => setSql(newSql)}` và `onRebuild={rebuild}`.
  - Nhấn nút Quick-Fix lập tức cập nhật nội dung ô `SqlEditor`.
- **AC4 (Kiểm tra bằng máy):**
  - `npm run check` (i18n check, eslint, typecheck, vitest) thoát 0.
  - Viết unit test cho `SmartErrorCard` tương tác click nút Quick-Fix.
