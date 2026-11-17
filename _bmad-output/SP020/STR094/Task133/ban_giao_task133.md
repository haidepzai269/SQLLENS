# Bàn giao Task133

Đã làm: `assertSqliteSafe(sql)` đọc SQL như SQLite đọc (bỏ comment, chuỗi, định danh có bọc) rồi chặn `ATTACH`, `DETACH`, `VACUUM INTO`, `load_extension(...)` và câu không đóng chuỗi/comment (lý do `attach_hidden`); lệnh bị chặn thì **không câu nào trong chuỗi được chạy**. `EngineId` có thêm `"sqlite"`, tab SQLite xuất hiện trên header, engine ghim vào dự án nên F5 vẫn giữ lựa chọn. Lab tạo `createSqliteAdapter`, đọc schema thật qua `sqlite_master` + `pragma_table_info`, và SQLite vào được Cột SQL (dialect CodeMirror `SQLite`, mẫu SQL riêng, parser `node-sql-parser/build/sqlite`). Tab Plan, B-Tree, Capacity, Tranh chấp của SQLite trả `not_simulated` kèm lý do tiếng Việt/Anh (không có `EXPLAIN (ANALYZE, BUFFERS)`, không có `pageinspect`).

File chính:
- `web/src/engines/sqlite/guard.ts`, `guard.test.ts` (rào chắn + 7 test)
- `web/src/contracts/engine.ts` (`EngineId` có `"sqlite"`), `components/shell/engine-tabs.tsx`, `components/sql-editor/{dialect,samples}.ts`
- `web/src/modules/lab/stage/stage-data.ts` (`SQLITE_SCHEMA_QUERY`, `SQLITE_INDEX_QUERY`, `sqliteSchema`), `web/src/modules/lab/stage/stage.tsx`, `web/src/modules/lab/lab-workspace.tsx`
- `web/src/modules/sql-intake/parser/{core,worker}.ts` (parse SQLite)
- `web/messages/{vi,en}/{guard,shell,sqlite}.json`
- `web/next.config.ts` + `web/scripts/turbopack-sqlite-opfs-stub.cjs`, `web/e2e/sqlite.spec.ts`

Kết quả kiểm tra (chạy thật, không phải ước lượng):
- `npm run check` (i18n + lint + typecheck + vitest): PASS, 1.126 test pass / 18 skip; lint còn 1 warning có sẵn ở `e2e/plan-explain.spec.ts` (`hist` không dùng).
- `API_ORIGIN=http://127.0.0.1:8080 npx next build`: PASS. Build trước đó **trượt** vì Turbopack không bundle được `new Worker(new URL(proxyUri, import.meta.url))` trong `@sqlite.org/sqlite-wasm/dist/sqlite3-worker1.mjs`; đã thay file worker OPFS đó bằng module rỗng qua loader (ứng dụng chỉ dùng DB trong bộ nhớ, không dùng OPFS). `.next/static/media/sqlite3.*.wasm` được phát, JS chính không chứa WASM.
- `npx playwright test e2e/sqlite.spec.ts` trên Chrome thật + bản build: 3/3 PASS. AC1/AC2: `CREATE` + `INSERT` + `SELECT` ra 2 dòng nhãn Thật, `ATTACH` bị chặn và bảng ở câu trước **không** được tạo (đếm `sqlite_master` = 0), không request `/api` nào ngoài `/api/me`. AC4: Plan và B-Tree hiện `not simulated` kèm lý do, không có `stage-btree`. AC3: chọn SQLite rồi F5 vẫn `aria-selected`.
- `npx vitest run web/src/engines/sqlite/guard.test.ts`: 7/7 PASS, gồm 5 dạng chặn, 3 dạng hợp lệ, `SELECT 'ATTACH'`, `/*x*/ATTACH`, `attach` thường, 2MB (chặn câu ở cuối chuỗi 2MB).

Kết quả review: Chưa gọi reviewer độc lập trong phiên này (không có agent reviewer riêng), nên bàn giao chưa được nghiệm thu theo mục 5 của QUY_TRINH. Tự kiểm theo các góc: logic rào chắn có test thật, nhãn kết luận không câu nào hàm ý "thiết kế ổn", i18n đủ vi/en. Cần một reviewer mới đọc diff trước khi merge.

Chưa làm được: chưa đo trên Safari/Firefox thật; chưa có bộ gợi ý sửa lỗi riêng cho SQLite (`SqlErrorView` được truyền `engine` rỗng nên không gán nhãn lỗi PostgreSQL, nhưng cũng chưa có remediation của SQLite); chưa dùng OPFS SAHPool (vẫn DB trong bộ nhớ như Task132).

Phát sinh cần đưa vào SP999: (1) `e2e/mysql.spec.ts` hỏng 20 test trên `main` **trước** task này — đã kiểm bằng cách stash thay đổi rồi build lại và chạy đúng test đó: URL `?engine=mysql` bị engine của dự án ("Mặc định PG") ghi đè ở Trường hợp 3 của effect đồng bộ trong `lab-workspace.tsx` (hệ quả Task128). (2) Nút "Sinh dữ liệu" vẫn bật cho SQLite nhưng đọc schema bằng catalog PostgreSQL nên sẽ báo lỗi. (3) Luật Rủi ro và AI Doctor vẫn xử lý SQLite như MySQL.

Việc tiếp theo cần biết: rào chắn SQLite nằm ở `lab-workspace.tsx` (trước khi có worker), không nằm trong adapter — Task132 cấm sửa adapter nên nếu sau này adapter được gọi từ chỗ khác thì phải gọi `assertSqliteSafe` ở đó trước. `sqlite3.wasm` do Emscripten tự tìm cạnh `index.mjs` và đã chạy được dưới Turbopack, không cần fetch tường minh. `SqliteAdapter` vẫn khai báo `engine: "sqlite"` qua `Omit`; có thể đơn giản thành `EngineAdapter` khi có dịp.
