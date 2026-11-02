# Task012: Đo PGlite trong trình duyệt

Thuộc: SP002 / STR007
Mục tiêu: Đo thời gian và RAM của PGlite 0.5.14 trong Chromium thật ở 10k, 100k và 500k dòng, để biết mức nào chạy được trên máy người dùng.
Phạm vi: `spikes/pglite-scale/**`, `_bmad-output/SP002/STR007/Task012/**`.
Không làm: sửa `web/` hay `api/`, worker, giao diện sản phẩm.

Hợp đồng:
- `spikes/pglite-scale/` có `package.json` riêng, ghim `@electric-sql/pglite` đúng `0.5.14` và `@playwright/test`.
- `npm run measure` chạy toàn bộ phép đo bằng Playwright trên Chromium headless và in bảng kết quả. Trang đo được phục vụ bằng cách nào cũng được, miễn không cần sửa `web/`.
- Bảng đo dùng cùng schema với số đo trên Node đã có trong `CLAUDE.md`: bảng `orders(id bigint primary key, customer_id bigint, status text, total numeric(12,2), created_at timestamptz)`, rồi tạo index trên `customer_id`.

Tiêu chí xong:
- AC1: Với mỗi mức 10k, 100k, 500k, đo được: thời gian khởi tạo PGlite, thời gian insert, thời gian tạo index, level của B-Tree đọc bằng `pageinspect` (`bt_metap`), kích thước index bằng `pg_relation_size`.
- AC2: Đo RAM của trang ở mỗi mức bằng `performance.measureUserAgentSpecificMemory()` nếu được, nếu không thì bằng CDP `Performance.getMetrics` (`JSHeapUsedSize`) kèm bộ nhớ của tiến trình renderer. Ghi rõ dùng cách nào, vì WASM memory có thể không nằm trong JS heap.
- AC3: Mỗi mức chạy 3 lần trên trang mới, ghi trung vị và giá trị lớn nhất.
- AC4: Ghi thời gian một câu `SELECT ... WHERE customer_id = $1` dùng index và một câu quét toàn bảng, kèm số trang đọc từ `EXPLAIN (ANALYZE, BUFFERS)`.
- AC5: Đo với giới hạn CPU chậm 4 lần qua CDP `Emulation.setCPUThrottlingRate`, để có số cho máy yếu.
- AC6: Nếu 500k làm tab sập hoặc vượt 2 phút thì ghi đúng điều đó, không bỏ qua.
- AC7: `ket_qua.md` trong thư mục task có bảng số, cấu hình máy đo (CPU, RAM, bản Chromium), lệnh đã chạy, và đề xuất mức dòng tối đa nên cho người dùng chạy thật. Đề xuất phải dựa trên số, ghi rõ phần nào là suy luận.

Ca biên: số đo dao động lớn giữa 3 lần thì ghi cả 3, không làm tròn thành một số.
Kiểm tra: `cd spikes/pglite-scale && npm ci && npm run measure`
Góc review thêm: kiểm số liệu có đúng với lệnh đã chạy, không có số bịa.
Đọc thêm: `CLAUDE.md` mục "Đã kiểm chứng", "Capacity Advisor"; `_bmad-output/SP001/STR006/Task011/ban_giao_task011.md` về cách nạp WASM.
