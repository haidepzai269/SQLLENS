# Task091: Hợp đồng kiểu `ErrorRemediation` & Heuristic Matcher cho PostgreSQL

## Bối cảnh & Mục tiêu
Khi người dùng chạy SQL trong phòng lab (`/lab`) và gặp lỗi từ PostgreSQL/PGlite (ví dụ: `relation "users" already exists`), hiện tại hệ thống chỉ hiển thị một dòng thông báo lỗi cộc lốc của database engine. Người mới học không hiểu nguyên nhân vì sao và không biết cách sửa.
Đồng thời, theo yêu cầu nghiệp vụ thực tế: **Tuyệt đối không được xóa bỏ mã lỗi và thông điệp gốc của database engine (Raw Error First)** để người dùng làm quen với log production thật, nhưng cần có hệ thống phân tích lỗi thông minh và sinh ra các phương án sửa nhanh (Quick-Fix) tức thì (100% offline, 0ms, không tốn AI token).

Task091 xây dựng lõi logic phân tích lỗi cho PostgreSQL:
1. Định nghĩa hợp đồng kiểu dữ liệu `ErrorRemediation` và `QuickFixAction`.
2. Xây dựng bộ `matchPostgresError(errorMessage: string, sql: string, position?: number)` có khả năng nhận diện 10 mã lỗi kinh điển của PostgreSQL (thuộc 5 nhóm lỗi production).
3. Tự động sinh các hành động sửa nhanh (Quick-Fix Actions) tương ứng với từng lỗi (chèn `IF NOT EXISTS`, chèn `DROP TABLE IF EXISTS ... CASCADE;`, thêm `ON CONFLICT DO NOTHING`, hoặc gợi ý `rebuild_sandbox`).
4. Cung cấp bộ từ điển bản dịch song ngữ `vi` và `en` cho tiêu đề và giải thích bình dân học vụ.

## Tiêu chí chấp nhận (AC)
- **AC1 (Hợp đồng kiểu chuẩn):** Tạo file `web/src/modules/error-remediation/types.ts` với đầy đủ các kiểu:
  - `QuickFixAction`:
    + `{ type: "replace_stmt"; targetSql: string; replacementSql: string; labelKey: string }`
    + `{ type: "prepend_stmt"; sqlToPrepend: string; labelKey: string }`
    + `{ type: "rebuild_sandbox"; labelKey: string }`
  - `ErrorRemediation`: gồm `engine: "postgres" | "mysql"`, `code: string` (SQLSTATE chuẩn), `category`, `rawMessage`, `titleKey`, `explanationKey`, `explanationParams`, `highlightToken`, `actions: QuickFixAction[]`, và `rootCauseHintKey` (tùy chọn).
- **AC2 (Nhận diện 10 mẫu lỗi PostgreSQL thực chiến):**
  1. `42P07` (`duplicate_table`): Bắt chuỗi `relation "(\w+)" already exists` -> Trả về 3 actions: `replace_stmt` (thay bằng `CREATE TABLE IF NOT EXISTS`), `prepend_stmt` (chèn `DROP TABLE IF EXISTS <name> CASCADE;\n` lên đầu), và `rebuild_sandbox`.
  2. `42P01` (`undefined_table`): Bắt chuỗi `relation "(\w+)" does not exist` hoặc `table "(\w+)" does not exist` -> Giải thích thứ tự tạo bảng hoặc thiếu câu CREATE TABLE.
  3. `42703` (`undefined_column`): Bắt chuỗi `column "(\w+)" of relation "(\w+)" does not exist` hoặc `column "(\w+)" does not exist` -> Highlight tên cột, gợi ý kiểm tra chính tả.
  4. `23505` (`unique_violation`): Bắt chuỗi `duplicate key value violates unique constraint "(\w+)"` -> Giải thích trùng khóa chính/unique, gợi ý dùng `ON CONFLICT DO NOTHING`.
  5. `23503` (`foreign_key_violation`): Bắt chuỗi `violates foreign key constraint "(\w+)"` -> Giải thích bản ghi cha chưa tồn tại.
  6. `23502` (`not_null_violation`): Bắt chuỗi `null value in column "(\w+)" violates not-null constraint` -> Highlight tên cột bắt buộc.
  7. `42601` (`syntax_error`): Bắt chuỗi `syntax error at or near "([^"]+)"` -> Trích xuất token gây lỗi, gợi ý kiểm tra dấu phẩy `,` hoặc đóng ngoặc.
  8. `25P02` (`in_failed_sql_transaction`): Bắt chuỗi `current transaction is aborted, commands ignored until end of transaction block` -> Cung cấp `rootCauseHintKey` giải thích câu lệnh này vô tội và lỗi xuất phát từ câu lệnh phía trước trong transaction.
  9. `22P02` (`invalid_text_representation`): Bắt chuỗi `invalid input syntax for type (\w+): "([^"]+)"` -> Giải thích ép kiểu sai.
  10. `2BP01` (`dependent_objects_still_exist`): Bắt chuỗi `cannot drop table (\w+) because other objects depend on it` -> Gợi ý action đổi thành `DROP TABLE <name> CASCADE;`.
  - Nếu không khớp mẫu nào: Trả về đối tượng `ErrorRemediation` với `code: "UNKNOWN"`, giữ nguyên `rawMessage`, không có action cụ thể hoặc có action `rebuild_sandbox`.
- **AC3 (Bảo toàn Raw Message):** `remediation.rawMessage` luôn giữ nguyên 100% chuỗi lỗi gốc do PostgreSQL/PGlite trả về, không bị cắt xén hay thay đổi.
- **AC4 (Song ngữ i18n):** Tạo `web/messages/vi/error-remediation.json` và `web/messages/en/error-remediation.json` chứa toàn bộ khóa dịch giải thích cho 10 mẫu lỗi trên.
- **AC5 (Kiểm tra bằng máy):**
  - Viết unit test toàn diện `web/src/modules/error-remediation/postgres-matcher.test.ts` kiểm thử đầy đủ 10 mẫu lỗi trên và ca không khớp (unknown).
  - `npm run check` (i18n check, eslint, typecheck, vitest) thoát 0.

## Hướng dẫn triển khai
1. Tạo thư mục `web/src/modules/error-remediation/`.
2. Tạo `types.ts` theo AC1.
3. Tạo `postgres-matcher.ts` chứa hàm `matchPostgresError(rawMessage: string, sql: string, position?: number): ErrorRemediation`.
4. Tạo `web/messages/vi/error-remediation.json` và `web/messages/en/error-remediation.json`.
5. Tạo `postgres-matcher.test.ts` kiểm thử mọi trường hợp.
6. Chạy `npm run check` đảm bảo kiểm tra tự động xanh 100%.
