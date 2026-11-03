# Task027: Hiện đúng infinity, số dòng ảnh hưởng và vị trí câu lỗi

Thuộc: SP999 / STR062
Điều kiện bắt đầu: Task021 đã merge, vì task này có thể phải sửa `worker.ts`.
Mục tiêu: Sửa ba sai lệch Task020 phát hiện khi chạy thật.
Phạm vi: `web/src/components/result-grid/**`, `web/src/engines/postgres/**`, `web/src/contracts/engine.ts`, `web/e2e/lab.spec.ts`, `web/src/modules/lab/**` (chỉ phần nhật ký).
Không làm: sửa giao diện khác.

Tiêu chí xong:
- AC1: `SELECT 'infinity'::timestamptz, '-infinity'::timestamptz, 'infinity'::date, 'infinity'::timestamp` hiện đúng `infinity` và `-infinity`, không hiện `Invalid date`. Kiểm bằng Playwright trên PGlite thật.
- AC2: `Date` hợp lệ vẫn hiện ISO. `Date` không hợp lệ thật sự, không đến từ `infinity`, vẫn hiện `Invalid date`.
- AC3: Kiểm thật xem `affectedRows` của PGlite có cộng dồn không. Sau `INSERT` 2 dòng rồi `SELECT`, kết quả `SELECT` không được hiện "2 dòng bị ảnh hưởng". Ghi nguyên nhân vào bàn giao.
- AC4: Lỗi SQL ở câu thứ N: `EngineError` có `statementIndex`, nhật ký ghi "lỗi ở câu N" đúng hợp đồng Task020, đủ `vi` và `en`, không chứa nội dung SQL.
- AC5: `npm run check`, `npm run build`, `npx playwright test` đều đạt.

Ca biên: `infinity` trong mảng `timestamptz[]` không làm sập; câu lỗi đầu tiên cho N đúng theo số đếm từ 1.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: nhãn kết luận, không ghi log SQL.
Đọc thêm: `_bmad-output/SP003/STR012/Task020/ban_giao_task020.md`.
