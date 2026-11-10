# Bàn giao Task093

Đã làm:
1. Xây dựng Heuristic Matcher cho MySQL (`mysql-matcher.ts` & `mysql-matcher.test.ts`):
   - Nhận diện 8 mã lỗi MySQL kinh điển:
     + 1050 (`ER_TABLE_EXISTS_ERROR`): Table '...' already exists -> sinh 3 actions Quick-Fix (`replace_stmt` CREATE TABLE IF NOT EXISTS, `prepend_stmt` DROP TABLE IF EXISTS, `rebuild_sandbox`).
     + 1146 (`ER_NO_SUCH_TABLE`): Table '...' doesn't exist.
     + 1054 (`ER_BAD_FIELD_ERROR`): Unknown column '...' in 'field list'.
     + 1062 (`ER_DUP_ENTRY`): Duplicate entry '...' for key '...'.
     + 1452 (`ER_NO_REFERENCED_ROW_2`): Foreign key constraint fails.
     + 1064 (`ER_PARSE_ERROR`): Cú pháp sai.
     + 1048 (`ER_BAD_NULL_ERROR`): Cột NOT NULL bị thiếu.
     + 1406 (`ER_DATA_TOO_LONG`): Dữ liệu vượt quá độ dài.
     + Fallback `UNKNOWN`.
   - Bảo toàn 100% `rawMessage` gốc.
   - Re-export trong `web/src/modules/error-remediation/index.ts`.
   - 13/13 unit tests pass 100%.
2. Nâng cấp `SqlErrorView` thành `SmartErrorCard` (`sql-error-view.tsx`):
   - **Mặc định:** Hiển thị khối Console lỗi đen tuyền (`bg-zinc-950 font-mono text-xs`) với từng ký tự gốc của engine, vị trí dòng/cột đỏ rực có highlight token lỗi từ `locateError` (Nguyên tắc Raw Error First).
   - **Toggle Chế độ xem:** Có nút chuyển tab `[Nguyên bản]` (mặc định) và `[Dịch nghĩa tiếng Việt]` (hiển thị badge mã lỗi, category, giải thích chi tiết và gợi ý nguyên nhân gốc rễ).
   - **Khối Cứu hộ Quick-Fix 1-Click:** Render các nút hành động sửa nhanh từ `remediation.actions`:
     + `replace_stmt`: Tự động thay thế câu lệnh trong editor (`sql.replace(...)`).
     + `prepend_stmt`: Tự động chèn câu lệnh lên đầu editor.
     + `rebuild_sandbox`: Nút dọn sạch sandbox PGlite / MySQL và tự chạy lại.
   - **Nút "Hỏi AI Mentor về lỗi này":** Nút bấm với icon Sparkles kết nối chẩn đoán lỗi.
3. Tích hợp vào `web/src/modules/lab/lab-workspace.tsx`:
   - Khi `state.phase === "sql_error"`: truyền `engine={engine}`, `onApplyFix={(newSql) => setSql(newSql)}` và `onRebuild={rebuild}` vào `SqlErrorView`.
4. Song ngữ i18n:
   - Thêm đầy đủ bản dịch trong `web/messages/vi/error-remediation.json` và `web/messages/en/error-remediation.json`.

File chính:
- `web/src/modules/error-remediation/mysql-matcher.ts`
- `web/src/modules/error-remediation/mysql-matcher.test.ts`
- `web/src/modules/error-remediation/index.ts`
- `web/src/components/result-grid/sql-error-view.tsx`
- `web/src/components/result-grid/sql-error-view.test.tsx`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/messages/vi/error-remediation.json`
- `web/messages/en/error-remediation.json`

Kết quả kiểm tra:
- `npm run check` (check:i18n, eslint, typecheck, vitest): Thoát mã 0.
- `vitest run`: 55 test files pass (611 tests pass, 16 skipped), 0 errors.
- `sql-error-view.test.tsx`: 6/6 tests pass.
- `mysql-matcher.test.ts`: 13/13 tests pass.
