# SP006: `sql-intake`

Kết quả: Người dùng dán SQL vào ô soạn thật, thấy lỗi đúng dòng, biết hệ thống hiểu SQL đó là schema, query hay cả hai. Chỉ dán query thì hệ thống suy ra schema, người dùng sửa và xác nhận rồi mới chạy.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR025 Ô soạn SQL | Task029 | Component CodeMirror theo dialect, câu mẫu, chỗ đánh dấu lỗi | Không | 1 |
| STR026 Parser hai engine | Task028 | `parseSql` cho hai engine trả cùng một kiểu, chạy trong worker | Task021 | 2 |
| STR027 Phân loại đầu vào | Task030 | Nhận biết schema, query, cả hai, kể cả file dump dài | Task028 | 3 |
| STR028 Suy ra schema | Task031 | Lõi suy ra schema từ query | Task028 | 3 |
| STR025 Ô soạn SQL | Task032 | Thay textarea trên màn hình chính, hiện lỗi và danh sách câu | Task024, Task028, Task029 | 4 |
| STR028 Suy ra schema | Task033 | Màn hình sửa và xác nhận schema | Task030, Task031, Task032 | 5 |

## Các file bị đụng

| Task | File |
|---|---|
| Task028 | `web/src/modules/sql-intake/parser/**` |
| Task029 | `web/src/components/sql-editor/**`, `web/src/app/[locale]/e2e-editor/**`, `web/e2e/sql-editor.spec.ts`, `web/messages/*/sql-editor.json` |
| Task030 | `web/src/modules/sql-intake/classify/**` |
| Task031 | `web/src/modules/sql-intake/infer/**` |
| Task032 | `web/src/modules/lab/**`, `web/messages/*/lab.json`, `web/e2e/lab.spec.ts` |
| Task033 | `web/src/modules/sql-intake/ui/**`, `web/src/modules/lab/**` (chỉ chỗ gắn), `web/messages/*/sql-intake.json`, `web/e2e/sql-intake.spec.ts` |

Task024 và Task032 cùng sửa `web/src/modules/lab/**`, nên Task032 chờ Task024.

Trạng thái: xong ngày 2026-11-03, Task028 đến Task033 đã merge.
