# Bàn giao Task028

Đã làm: `parseSql(sql, engine)` và `disposeParser()` chạy trong một Web Worker, tải `pgsql-parser` (cùng `libpg-query.wasm`) hoặc `node-sql-parser/build/mysql` khi gọi lần đầu. Trả `ParseOutcome` theo đúng hợp đồng, không reject vì SQL sai. Tải parser lỗi thì trả `ok: false` và bỏ cache để lần sau tải lại. Mỗi lời gọi có id riêng nên hai lời gọi liền nhau không lẫn kết quả.
File chính: `web/src/modules/sql-intake/parser/{index,worker,core,types}.ts`, test `core.test.ts`, `web/e2e/sql-parser.spec.ts`, route thử `web/src/app/[locale]/e2e-parser/`.
Kết quả kiểm tra (trong `web/`, `API_ORIGIN=http://localhost:8080`):
- `npm run check`: thoát 0, 133 test đạt (26 test của parser).
- `npm run build`: thoát 0.
- `E2E_PORT=3128 npx playwright test`: 45/46 đạt lần đầu. Test Task021 (`postgres-guard`) trượt khi máy đang tải, chạy riêng đạt. Sau khi sửa lỗi review, `sql-parser.spec.ts` chạy lại 7/7 đạt.
- AC6, SQL 1 MB (18.519 câu INSERT, có tiếng Việt): parse trong worker 496 đến 620 ms, khung hình chậm nhất 18 ms.
- Vị trí lỗi `libpg-query`: `cursorPosition` đếm từ 0 theo code point, đã kiểm bằng câu lỗi ở giữa dòng ba. Code đổi sang chỉ số UTF-16.
Kết quả review: 2 lỗi đã sửa (vị trí lỗi PG lệch sau emoji; tên CTE trùng tên bảng thật bị bỏ khỏi `tables`). `needs_validation` còn lại: (1) test AC1 chỉ phân biệt engine qua URL `.wasm`, chunk JS của Next có tên băm nên chưa chứng minh được JS `pgsql-parser` không tải ở nhánh MySQL (cấu trúc là `import()` lười trong worker, và trang không tạo worker); (2) kết quả có AST của ~20k câu đi qua `postMessage`, đã đo không chặn khung hình nhưng chưa thử trên máy chậm.
Chưa làm được: không có `DELIMITER` cho MySQL (có comment `shortcut:`). `DROP INDEX i ON t` (cú pháp MySQL) báo lỗi parse ở PostgreSQL, đúng với engine đó.
Phát sinh:
- Route `web/src/app/[locale]/e2e-parser/` chỉ để test, phải chặn hoặc xóa ở SP013 (giống `e2e-adapter`).
- Khi PostgreSQL tải `libpg-query.wasm`, vẫn có thêm một fetch vào `/_next/static/chunks/libpg-query.wasm` trước khi tới `/_next/static/media/libpg-query.*.wasm`, y như Task021 ghi. Nên dọn ở SP013.
- `tables` được sắp theo bảng chữ cái, không theo thứ tự xuất hiện.
Việc tiếp theo cần biết: `ast` của hai engine có hình dạng khác nhau (`unknown`), Task031 phải rẽ theo `engine`. `ok: false` không có nghĩa SQL sai: vẫn phải gửi SQL cho engine thật. `position/line/column` tính trên chuỗi JS. Parser chạy ở một worker chung, gọi `disposeParser()` khi rời màn hình.
