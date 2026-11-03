# Task027: Hiện đúng infinity, số dòng ảnh hưởng và vị trí câu lỗi

Thuộc: SP999 / STR062
Điều kiện bắt đầu: Task021, Task024, Task025 đã merge, vì task này sửa `web/src/engines/postgres/**`, `web/src/contracts/engine.ts` và `web/src/modules/lab/**`.
Mục tiêu: Sửa ba sai lệch Task020 phát hiện khi chạy thật, và hiện đúng ngôn ngữ cho lỗi chặn của Task021.
Phạm vi: `web/src/components/result-grid/**`, `web/e2e/postgres-guard.spec.ts`, `web/src/engines/postgres/**`, `web/src/contracts/engine.ts`, `web/e2e/lab.spec.ts`, `web/src/modules/lab/**` (chỉ phần nhật ký và hiển thị lỗi).
Không làm: sửa giao diện khác.

Tiêu chí xong:
- AC1: `SELECT 'infinity'::timestamptz, '-infinity'::timestamptz, 'infinity'::date, 'infinity'::timestamp` hiện đúng `infinity` và `-infinity`, không hiện `Invalid date`. Kiểm bằng Playwright trên PGlite thật.
- AC2: `Date` hợp lệ vẫn hiện ISO. `Date` không hợp lệ thật sự, không đến từ `infinity`, vẫn hiện `Invalid date`.
- AC3: Kiểm thật xem `affectedRows` của PGlite có cộng dồn không. Sau `INSERT` 2 dòng rồi `SELECT`, kết quả `SELECT` không được hiện "2 dòng bị ảnh hưởng". Ghi nguyên nhân vào bàn giao.
- AC4: Lỗi SQL ở câu thứ N: `EngineError` có `statementIndex`, nhật ký ghi "lỗi ở câu N" đúng hợp đồng Task020, đủ `vi` và `en`, không chứa nội dung SQL.
- AC5: Lỗi chặn của Task021 (`EngineError.guard`) hiện đúng ngôn ngữ ở màn hình chính bằng `reasonKey` và `statementIndex`, không hiện chuỗi tiếng Anh dự phòng. Kiểm bằng Playwright với `SET ROLE postgres` ở `vi` và `en`.
- AC6: `loadGuard` của Task021 không tải được parser thì thử lại, và trạng thái lớp một được báo ra ngoài (ví dụ một dòng trong nhật ký), không tắt im lặng. Task025 gặp lỗi này 1 trong 4 lần chạy `postgres-guard.spec.ts`, kết quả trả `guard.escaped` thay vì `guard.role`. Chạy `postgres-guard.spec.ts` 10 lần liên tiếp đều đạt.
- AC7: Test `result-grid` AC2 (trên 500 dòng bị cắt) không còn trượt vì quá 5 giây khi máy bận, mà không bỏ kiểm tra nội dung. Đã trượt ở Task025, Task028, Task029.
- AC8: `npm run check`, `npm run build`, `npx playwright test` đều đạt.

Ca biên: `infinity` trong mảng `timestamptz[]` không làm sập; câu lỗi đầu tiên cho N đúng theo số đếm từ 1.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: nhãn kết luận, không ghi log SQL.
Đọc thêm: `_bmad-output/SP003/STR012/Task020/ban_giao_task020.md`.
