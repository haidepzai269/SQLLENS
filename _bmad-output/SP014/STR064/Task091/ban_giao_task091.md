# Bàn giao Task091

Đã làm:
1. Định nghĩa hợp đồng kiểu dữ liệu chuẩn trong `web/src/modules/error-remediation/types.ts`:
   - `QuickFixAction`: 3 biến thể phân biệt (`replace_stmt`, `prepend_stmt`, `rebuild_sandbox`) với đầy đủ các trường `targetSql`, `replacementSql`, `sqlToPrepend`, `labelKey`.
   - `ErrorCategory`: `"schema" | "integrity" | "datatype" | "syntax" | "transaction" | "other"`.
   - `ErrorRemediation`: `engine`, `code` (SQLSTATE chuẩn), `category`, `rawMessage` (bảo toàn 100% thông điệp gốc), `titleKey`, `explanationKey`, `explanationParams`, `highlightToken`, `actions`, và `rootCauseHintKey`.
2. Xây dựng module nhận diện lỗi `web/src/modules/error-remediation/postgres-matcher.ts`:
   - Nhận diện 10 mã lỗi PostgreSQL kinh điển:
     1. `42P07` (`duplicate_table`): Sinh 3 actions (`replace_stmt` thêm `IF NOT EXISTS`, `prepend_stmt` chèn `DROP TABLE IF EXISTS <name> CASCADE;\n`, và `rebuild_sandbox`).
     2. `42P01` (`undefined_table`): Giải thích thứ tự tạo bảng hoặc thiếu câu CREATE TABLE.
     3. `42703` (`undefined_column`): Bóc tách token cột, gợi ý kiểm tra chính tả.
     4. `23505` (`unique_violation`): Gợi ý thêm `ON CONFLICT DO NOTHING`.
     5. `23503` (`foreign_key_violation`): Giải thích bản ghi cha chưa có.
     6. `23502` (`not_null_violation`): Chỉ rõ cột bắt buộc bị thiếu giá trị.
     7. `42601` (`syntax_error`): Bóc tách token gây lỗi, gợi ý kiểm tra dấu phẩy hoặc đóng ngoặc.
     8. `25P02` (`in_failed_sql_transaction`): Nhận diện lỗi transaction aborted và gắn `rootCauseHintKey` chỉ rõ câu lệnh bị chết oan do câu trước hỏng.
     9. `22P02` (`invalid_text_representation`): Giải thích ép kiểu sai.
     10. `2BP01` (`dependent_objects_still_exist`): Gợi ý đổi thành `DROP TABLE ... CASCADE;`.
     11. Fallback `UNKNOWN`: Giữ nguyên thông điệp gốc, hỗ trợ định vị token theo cursor position, kèm nút `rebuild_sandbox`.
   - Nguyên tắc Raw Error First: Toàn bộ thông điệp gốc của PostgreSQL được giữ nguyên 100% trong `remediation.rawMessage`.
3. Song ngữ i18n:
   - Tạo `web/messages/vi/error-remediation.json` và `web/messages/en/error-remediation.json` đồng bộ 100% khóa dịch và biến nội suy.
4. Unit tests:
   - Tạo `web/src/modules/error-remediation/postgres-matcher.test.ts` với 18 ca kiểm thử bao quát toàn bộ 10 mã lỗi, fallback và i18n.

File chính:
- `web/src/modules/error-remediation/types.ts`
- `web/src/modules/error-remediation/postgres-matcher.ts`
- `web/src/modules/error-remediation/postgres-matcher.test.ts`
- `web/src/modules/error-remediation/index.ts`
- `web/messages/vi/error-remediation.json`
- `web/messages/en/error-remediation.json`
- `_bmad-output/SP014/STR064/Task091/task091.md`

Kết quả kiểm tra:
- `npm run check` (check:i18n, eslint, typecheck, vitest): Thoát mã 0.
- `vitest run`: 592 tests passed, 0 failed.
- `postgres-matcher.test.ts`: 18/18 tests passed.

Kết quả review:
- Reviewer độc lập thẩm định commit `2a290de` và kết luận **PASS 100%** (0 confirmed, 0 needs_validation).

Chưa làm được:
- Tích hợp UI hiển thị và áp dụng Quick-Fix Action vào CodeMirror / Lab (thuộc Task093).
- Nhận diện lỗi cho MySQL engine (thuộc Task092).

Phát sinh:
- Không có.

Việc tiếp theo cần biết:
- Module `error-remediation` đã sẵn sàng để tích hợp vào `SqlErrorView` / `SmartErrorCard` ở Task093 hoặc mở rộng sang MySQL ở Task092.
