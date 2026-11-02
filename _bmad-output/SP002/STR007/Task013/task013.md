# Task013: pageinspect và parser trong trình duyệt

Thuộc: SP002 / STR007
Mục tiêu: Xác nhận hai thứ cốt lõi của sản phẩm chạy được trong Chromium thật: đọc cây B-Tree bằng `pageinspect` trên PGlite, và parse SQL bằng `pgsql-parser`.
Phạm vi: `spikes/pg-tools/**`, `_bmad-output/SP002/STR007/Task013/**`.
Không làm: sửa `web/` hay `api/`, dựng `BTreeModel` thật (STR033).

Hợp đồng:
- `spikes/pg-tools/` có `package.json` riêng, ghim `@electric-sql/pglite` đúng `0.5.14`, `pgsql-parser` cùng bản với `web/package.json`, `node-sql-parser` cùng bản với `web/package.json`, và `@playwright/test`.
- `npm run check-tools` chạy bằng Playwright trên Chromium headless và in kết quả từng AC.

Tiêu chí xong:
- AC1: Trong Chromium, nạp extension `pageinspect` của PGlite, tạo bảng 10k dòng có index, đọc được `bt_metap`, `bt_page_stats` và `bt_page_items` của root, một trang internal (nếu có) và một trang leaf. In ra level, số item, và vài key đầu.
- AC2: Đi từ root xuống leaf theo một key cụ thể bằng `bt_page_items`, và trang leaf tìm được chứa đúng key đó. Đây là đường đi mà animation sẽ dùng.
- AC3: Đo thời gian đọc toàn bộ các trang của index ở 100k dòng, để biết có đọc hết cây được không hay chỉ đọc theo đường đi.
- AC4: `pageinspect` cần quyền cao. Ghi lại role nào đọc được, và xác nhận một role quyền thấp tạo bằng `CREATE ROLE` không gọi được các hàm này. Nguyên tắc 8 trong `CLAUDE.md` dựa vào kết quả này.
- AC5: `pgsql-parser` parse được 10 câu PostgreSQL mẫu trong trình duyệt, gồm CREATE TABLE có FK, CREATE INDEX, SELECT có JOIN, CTE, subquery, `LIKE '%x'`, hàm bọc cột, và một câu sai cú pháp. Câu sai phải trả lỗi có vị trí, không làm treo trang. Ghi dung lượng gzip của phần parser trong bundle.
- AC6: `node-sql-parser` parse 10 câu MySQL mẫu trong trình duyệt, gồm câu có `FORCE INDEX`. Ghi câu nào lỗi.
- AC7: `ket_qua.md` trong thư mục task có kết quả từng AC, lệnh đã chạy, và các giới hạn tìm thấy.

Ca biên: nếu `pgsql-parser` cần file WASM riêng thì ghi cách nạp nó, vì `web/` sẽ dùng lại.
Kiểm tra: `cd spikes/pg-tools && npm ci && npm run check-tools`
Góc review thêm: bảo mật (AC4).
Đọc thêm: `CLAUDE.md` mục "Khác biệt giữa hai engine", "Nguyên tắc không được phá"; `_bmad-output/SP001/STR006/Task011/ban_giao_task011.md`.
