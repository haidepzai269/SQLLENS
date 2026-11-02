# Bàn giao Task013

Đã làm: Spike `spikes/pg-tools` chạy trên Chromium headless. Đọc B-Tree bằng `pageinspect` trên PGlite 0.5.14, đi từ root xuống leaf theo key, đo đọc toàn cây, kiểm quyền role, parse 10 câu PostgreSQL bằng `pgsql-parser` và 10 câu MySQL bằng `node-sql-parser`. Kết quả từng AC nằm ở `ket_qua.md`.
File chính: `spikes/pg-tools/` (`src/app.js`, `tests/check-tools.spec.ts`, `build.mjs`, `serve.mjs`), `_bmad-output/SP002/STR007/Task013/ket_qua.md`.
Kết quả kiểm tra: `cd spikes/pg-tools && npm ci && npm run check-tools` thoát 0, 1 test pass (khoảng 10 đến 22 giây). Server đã tắt, cổng 4173 không còn LISTEN.
Kết quả review: task-reviewer mới, 1 vòng, không có lỗi chặn, 6 điểm nhỏ. Đã sửa F1 (test nay assert phát hiện escape role và AC6), F2 (thời gian dao động theo máy), F3, F4 (metapage), F6 (vị trí lỗi assert đúng 13 và 0), F5 (đã đối chiếu mã `libpg-query`, sửa lời cho đúng). Reviewer chưa kiểm lại bản sửa, vì chỉ là test và tài liệu, đã chạy lại test pass.
Chưa làm được: Firefox, Safari, Vercel, Next.js. Chưa thử `CREATE EXTENSION` dưới role thường. Chưa kiểm khóa `text` và composite ở bước duyệt cây. Không đo RAM.
Phát sinh (đưa vào SP999):
- Nguyên tắc 8: trong PGlite `SET ROLE lowpriv` không phải rào chắn, SQL người dùng gọi được `RESET ROLE` hoặc `SET ROLE postgres` rồi gọi `pageinspect`. Cần chặn `VariableSetStmt` (SET ROLE, SET SESSION AUTHORIZATION) bằng parser, và tách đường đọc B-Tree khỏi SQL người dùng (STR012, STR013).
- Kiểm `libpg-query.wasm` và `pageinspect.tar.gz` có được Turbopack phát ra đúng chỗ trong `next build` không.
- Dùng `node-sql-parser/build/mysql` thay vì import mặc định (66 KB so với 515 KB gzip).
- Cập nhật `CLAUDE.md`: số "level 2 ở 100k" phụ thuộc độ rộng key, `int` thuần 100k là level 1.
Việc tiếp theo cần biết: bỏ item 1 (high key) ở trang không rightmost; item "âm vô cực" ở trang internal có `data` rỗng; vị trí lỗi của `pgsql-parser` bắt đầu từ 0; `libpg-query.wasm` được tìm cạnh trang HTML.
