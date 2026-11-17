# Bàn giao Task134

Đã làm: người dùng chọn file `.sqlite`/`.db` từ máy thì database của file được nạp vào đúng sandbox WASM đang chạy, Lab đọc lại schema thật và chạy `SELECT` trên bảng của file được. File **không rời khỏi trình duyệt**: byte chỉ đi từ `File` vào worker, không qua mạng (AC4 kiểm bằng network log). Panel nằm cạnh nút Sinh dữ liệu/Chạy trong cột SQL, có nút Nhập, nút Xuất (Task135), nút Huỷ khi đang nạp, và 4 trạng thái rỗng/đang nạp/lỗi/xong.

Cách làm: thêm `loadDatabase(source: File | Uint8Array)` vào `SqliteAdapter` và message `load` vào protocol; worker đọc `File.arrayBuffer()` (main thread không bị chặn, AC5), gọi `sqlite3_deserialize` vào một DB mới, **đọc thử `sqlite_master`** rồi mới thay DB đang mở. File hỏng/mã hóa thì DB cũ còn nguyên và báo `IMPORT_FAILED`. Sau khi nạp, history được xoá; nếu worker chết (timeout/huỷ) thì `rebuild()` nạp lại chính file đó trước khi phát lại câu mới.

Sai lệch so với đề bài (đã được Admin chốt trong phiên Party Mode 17/11): đề bài ghi "Không sửa adapter (Task132)" nhưng hợp đồng `importSqliteFile(file, adapter: EngineAdapter)` **không thi hành được** vì `EngineAdapter` không có đường nạp byte vào database. Đã sửa `adapter.ts`, `worker.ts`, `protocol.ts` đúng một lần cho cả Task134 và Task135; `EngineAdapter` chung vẫn không đổi (Postgres/MySQL không phải trả lời câu hỏi này).

File chính:
- `web/src/engines/sqlite/import-file.ts` (`MAX_IMPORT_BYTES = 50MB`, `looksLikeSqlite`, `SqliteImportError` với `FILE_TOO_LARGE`/`NOT_SQLITE`/`IMPORT_FAILED`, `importSqliteFile`)
- `web/src/engines/sqlite/{adapter,worker,protocol}.ts` (`loadDatabase`, `sqlite3_deserialize`, message `load`)
- `web/src/modules/workspace/components/sqlite-file-panel.tsx` (panel dùng chung với Task135)
- `web/src/modules/lab/lab-workspace.tsx` (gắn panel, `getSqliteAdapter` dùng chung với vùng chạy, `onSqliteImported` đọc lại schema)
- `web/messages/{vi,en}/labStage.json` (khối `file.*`)

Kết quả kiểm tra (chạy thật):
- `npx vitest run web/src/engines/sqlite/import-file.test.ts`: 8/8 PASS (hợp lệ, >50MB chặn trước khi đọc và không gọi adapter, 0 byte, file không phải SQLite, file mã hóa, huỷ, 500 bảng).
- `npx vitest run web/src/engines/sqlite/adapter.test.ts`: 12/12 PASS, gồm 5 test mới chạy trên **WASM thật**: xuất rồi nạp vào session khác đọc đúng dòng; DB rỗng vẫn ra file hợp lệ; nạp hai lần liên tiếp; file rỗng/rác/trang bị xáo đều bị từ chối và **bảng đang có vẫn còn**; nhận cả `File`.
- `npm run check`: PASS, 1.147 test pass / 18 skip; lint còn đúng 1 warning có sẵn ở `e2e/plan-explain.spec.ts`.
- `API_ORIGIN=http://127.0.0.1:8080 npx next build`: PASS.
- `npx playwright test e2e/sqlite.spec.ts` trên Chrome thật + bản build: 6/6 PASS. Trong đó test Task134/135 nhập file thật do WASM sinh ra, `SELECT` ra 2 dòng "An"/"Bình", xuất file, kiểm chữ ký `SQLite format 3\0`, nạp lại file vừa xuất và đếm đúng 2 dòng; không có request upload nào. Test AC5 nạp file **39.1 MB** (40.000 dòng × 1KB): trạng thái "Importing…" hiện trong lúc đọc, nạp xong `SELECT count(*)` ra 40000. Test AC6 ở 390px: hai nút hiện và bấm được, mép phải nằm trong khung nhìn.

Kết quả review: Chưa gọi reviewer độc lập trong phiên này; cần một reviewer mới đọc diff trước khi merge (đặc biệt phần sai lệch adapter ở trên).

Chưa làm được: chưa đo trên Safari/Firefox thật; chưa có progress % khi đọc file (chỉ có trạng thái "đang nạp" vì `File.arrayBuffer()` không báo tiến độ); file lớn hơn 50MB bị chặn cứng chứ không có luồng chia nhỏ; sau khi nhập, SQL đang gõ vẫn giữ nguyên nên có thể trỏ vào bảng không còn tồn tại (Lab sẽ hỏi lại schema ở lần Chạy sau).

Phát sinh cần đưa vào SP999: (1) import xong gọi `notifySchemaChanged(tabId, "ddl")` nên hiện thông báo "Schema đã cập nhật từ <tab>" — đúng nghĩa nhưng với file nhập thì nên có câu riêng; (2) `e2e/lab.spec.ts` hỏng 4 test (2 kịch bản × 2 ngôn ngữ) vì dấu lỗi cú pháp `.cm-sql-error` không hiện khi gõ `SELEC 1` — **đã xác nhận trên `main` sạch trước thay đổi này**, cùng họ với lỗi Task113/114 đã ghi trong AGENTS.

Việc tiếp theo cần biết: `sqlite3_deserialize` trả **0 với cả file rác** (đã đo), nên đừng bỏ bước kiểm magic + đọc thử `sqlite_master`. Nếu sau này dùng OPFS SAHPool thì đường nạp phải đổi sang `sqlite3_js_db_export`/attach, không dùng `deserialize` trên DB đang mở file.
