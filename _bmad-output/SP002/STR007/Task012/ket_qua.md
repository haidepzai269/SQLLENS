# Task012: PGlite 0.5.14 trong Chromium, 10k / 100k / 500k dòng

## Cấu hình máy đo

| Mục | Giá trị |
|---|---|
| CPU | 12th Gen Intel Core i5-12450H, 12 luồng |
| RAM | 15,7 GB |
| OS | Windows 11 (10.0.26200) |
| Chromium | 140.0.7339.16 (Playwright 1.55.0, headless, bản tải bởi `npx playwright install chromium`) |
| Node | 22.15.0 |
| PGlite | 0.5.14 (PostgreSQL 18.6), database trong RAM, thêm extension `pageinspect` |

Lệnh đã chạy (từ `spikes/pglite-scale`): `npm install`, `npx playwright install chromium`, `npm run measure` (2 lần, xem "Độ tin cậy").
Dữ liệu thô của lần chạy 2: `spikes/pglite-scale/results.json`.

Cách đo: `measure.mjs` phục vụ `page.html` và thư mục `dist` của PGlite qua một HTTP server nội bộ (không đụng `web/`). Mỗi lần đo mở context và trang mới, chạy `window.run(n)` trong trang, giới hạn 120 giây. Schema giống số đo Node trong `CLAUDE.md`: `orders(id bigint primary key, customer_id bigint, status text, total numeric(12,2), created_at timestamptz)`, rồi `CREATE INDEX` trên `customer_id`. Dữ liệu sinh bằng một câu `INSERT ... SELECT generate_series`, `customer_id = (i % (n/10)) + 1` nên mỗi khách có đúng 10 đơn. Sau khi tạo index chạy `ANALYZE` (không tính giờ).

## Bảng chính (lần chạy 2, trung vị / lớn nhất của 3 lần, mỗi lần một trang mới)

CPU thường (không giới hạn):

| Dòng | Khởi tạo PGlite | Insert | Tạo index | Level B-Tree | Index (`pg_relation_size`) | Bảng |
|---:|---:|---:|---:|---:|---:|---:|
| 10.000 | 1763 / 1777 ms | 58 / 126 ms | 9 / 21 ms | 1 | 112 KB | 672 KB |
| 100.000 | 1961 / 1972 ms | 1076 / 1224 ms | 87 / 137 ms | 1 | 936 KB | 6,8 MB |
| 500.000 | 1944 / 1987 ms | 4933 / 5064 ms | 456 / 580 ms | 2 | 4640 KB | 34,1 MB |

CPU chậm 4 lần (`Emulation.setCPUThrottlingRate` = 4):

| Dòng | Khởi tạo PGlite | Insert | Tạo index | Level | Tổng một lần chạy (trung vị / max) |
|---:|---:|---:|---:|---:|---:|
| 10.000 | 16086 / 17541 ms | 982 / 1129 ms | 63 / 63 ms | 1 | 19,8 / 21 s |
| 100.000 | 16351 / 16833 ms | 7480 / 7750 ms | 566 / 594 ms | 1 | 27,7 / 28 s |
| 500.000 | 15996 / 16196 ms | 27465 / 28231 ms | 1668 / 2042 ms | 2 | 49,8 / 51 s |

Cả 18 lần chạy (3 mức x 3 lần x 2 chế độ CPU) hoàn tất. Không có tab sập, không có lần nào vượt 2 phút (AC6): lâu nhất là 51 giây ở 500k với CPU chậm 4 lần. Kích thước index và số trang đọc giống hệt nhau giữa mọi lần chạy.

### Cả 3 lần (ms, lần 1 / 2 / 3), không làm tròn thành một số

| Chế độ | Dòng | Khởi tạo | Insert | Tạo index |
|---|---:|---|---|---|
| 1x | 10k | 1777 / 1763 / 1712 | 126 / 56 / 58 | 21 / 9 / 6 |
| 1x | 100k | 1834 / 1961 / 1972 | 1224 / 1076 / 968 | 87 / 137 / 84 |
| 1x | 500k | 1987 / 1944 / 1772 | 4731 / 4933 / 5064 | 437 / 580 / 456 |
| 4x | 10k | 15743 / 17541 / 16086 | 722 / 982 / 1129 | 63 / 47 / 63 |
| 4x | 100k | 16833 / 16351 / 15319 | 7067 / 7750 / 7480 | 566 / 444 / 594 |
| 4x | 500k | 15996 / 16196 / 13982 | 28231 / 27465 / 24460 | 846 / 2042 / 1668 |

## Truy vấn (AC4)

`SELECT * FROM orders WHERE customer_id = $1` (customer 42, trả 10 dòng). Thời gian là trung vị của 5 lần chạy ấm, rồi lấy trung vị của 3 trang. Số trang là `shared hit + read` ở dòng Buffers trên cùng của `EXPLAIN (ANALYZE, BUFFERS)`. Toàn bộ nằm trong bộ nhớ nên `read` luôn bằng 0, mọi trang đều là `hit`.

| Dòng | Dùng index (CPU 1x) | Trang | Quét toàn bảng (1x) | Trang | Index (4x) | Quét toàn bảng (4x) |
|---:|---:|---:|---:|---:|---:|---:|
| 10.000 | 1,63 ms | 15 | 5,8 ms | 84 | 13,1 ms | 16,4 ms |
| 100.000 | 1,38 ms | 15 | 14,6 ms | 834 | 11,4 ms | 113,5 ms |
| 500.000 | 1,49 ms | 16 | 65,5 ms | 4167 | 9,9 ms | 339,5 ms |

- Câu dùng index được planner chọn là `Bitmap Heap Scan` trên `orders_customer_id_idx` (không ép). Câu quét toàn bảng ép bằng `SET enable_indexscan=off; enable_bitmapscan=off` và tắt parallel, planner ra `Seq Scan`.
- Số trang quét toàn bảng đúng bằng số trang của bảng (500k: 34.136.064 byte = 4167 trang). Số trang đi qua index gần như không đổi theo quy mô (15 đến 16).
- Thời gian ở mức 1 ms có nhiễu lớn (ví dụ 500k lần chạy 2 ra 2,81 ms ở 1x). Theo nguyên tắc dự án, dùng số trang để so sánh, không dùng ms.

## RAM (AC2)

`performance.measureUserAgentSpecificMemory()` **không dùng được**: gọi trả `SecurityError: ... is not available` dù trang đã phục vụ với COOP/COEP (`same-origin` / `require-corp`). Cột uasm bằng `n/a`. Vì vậy dùng cách dự phòng, gồm hai nguồn:

1. CDP `Performance.getMetrics` `JSHeapUsedSize`: chỉ 6 đến 8 MB ở mọi mức. Số này **không phản ánh PGlite**, vì bộ nhớ WASM không nằm trong JS heap.
2. Bộ nhớ tiến trình renderer của Chromium, đọc từ Windows (`WorkingSet64` và `PeakWorkingSet64` của tiến trình có `--type=renderer`, con của đúng trình duyệt đang đo, lấy tiến trình lớn nhất). Đây là số có ý nghĩa.

Trung vị của 3 lần, MB (working set gồm cả trang chia sẻ, nên là cận trên cho "RAM riêng của tab"):

| Dòng | Sau khởi tạo PGlite (hiện tại / đỉnh) | Sau insert + index + ANALYZE (hiện tại / đỉnh) | Đỉnh cả lần chạy (trung vị / lớn nhất) |
|---:|---:|---:|---:|
| 10.000 | 385 / 1081 | 391 / 1081 | 1081 / 1109 |
| 100.000 | 388 / 1087 | 451 / 1087 | 1087 / 1097 |
| 500.000 | 386 / 1103 | 599 / 1103 | 1103 / 1118 |

Với CPU 4x các số tương tự (đỉnh 1088 đến 1145 MB, sau index 392 / 471 / 570 MB cho 10k / 100k / 500k).

Đọc số: đỉnh working set ~1,08 GB đã xuất hiện ngay sau khi khởi tạo PGlite, trước khi có một dòng dữ liệu, và gần như không đổi theo số dòng. Sau đó working set hạ về ~385 MB rồi tăng theo dữ liệu: +6 MB (10k), +63 MB (100k), +213 MB (500k) so với sau khởi tạo. Suy luận (chưa kiểm): đỉnh 1,08 GB là chi phí tức thời của việc khởi tạo cluster (initdb) trong WASM, và không phụ thuộc dữ liệu. Chưa tách được nó bằng công cụ khác nên chỉ kết luận được về working set của Windows, không phải mức cấp phát của WASM.

## Độ tin cậy

- Máy chạy đồng thời 5 task khác (2 task MySQL trong Docker, 2 task Playwright). Số bị ảnh hưởng bởi tải.
- Đã chạy `npm run measure` hai lần. Lần 1 (không lưu file thô, chỉ giữ bảng in ra, trung vị): 1x khởi tạo 2445 / 2379 / 2249 ms, insert 75 / 652 / 4001 ms, index 10 / 85 / 472 ms; 4x khởi tạo 10533 / 11362 / 12236 ms, insert 322 / 4124 / 18828 ms, index 24 / 344 / 1925 ms (10k / 100k / 500k). Lần 2 ở trên: insert 500k 1x là 4,9 giây so với 4,0 giây ở lần 1 (+23%), khởi tạo 4x 10k là 16,1 giây so với 10,5 giây (+53%). Các ô khác cũng lệch nhiều: 4x insert 10k là 322 ms ở lần 1 so với 982 ms ở lần 2 (3,0 lần), 4x insert 100k là 4124 so với 7480 ms (+81%), 1x insert 100k là 652 so với 1076 ms (+65%). Dao động giữa hai lần chạy từ +23% đến 3 lần, lớn hơn dao động giữa 3 lần trong cùng một lần chạy. Chỉ nên đọc thời gian là cùng bậc độ lớn ở mức 100k trở lên, không phải giá trị chính xác; ở 10k với CPU 4x thì cả bậc độ lớn cũng chưa ổn định. Kích thước index, level, số trang không đổi giữa các lần.
- Chromium headless, không phải trình duyệt người dùng có tiện ích; chỉ Windows; chưa đo Chrome headed, Safari, Firefox hay điện thoại.
- Level B-Tree ở 100k là 1 (không phải 2 như số Node trong `CLAUDE.md`). Suy luận (chưa kiểm, không có số Node trên cùng dữ liệu để so): khác biệt do phân bố `customer_id`: ở đây mỗi giá trị lặp 10 lần nên B-Tree 18 gộp trùng (deduplication) và index nhỏ hơn. Không đưa ra kết luận nào cho schema của người dùng từ chỗ này.
- Insert bằng một câu `generate_series` phía server, khác với nạp dữ liệu từ ứng dụng qua nhiều câu. Insert thật của sản phẩm (Task data-lab) có thể chậm hơn.
- "Khởi tạo PGlite" gồm tải và biên dịch WASM từ localhost (không qua mạng), `CREATE EXTENSION pageinspect`. Trên Vercel, thời gian tải 5 MB gzip qua mạng cộng thêm vào, chưa đo.

## Đề xuất mức dòng tối đa

Dựa trên số đo:

- 500k dòng chạy được trên máy này ở cả CPU thường (khoảng 10 giây tổng) và CPU chậm 4 lần (45 đến 51 giây), không sập, dưới giới hạn 2 phút.
- Chi phí RAM chủ yếu là mức cố định ~1,1 GB đỉnh lúc khởi tạo, cộng thêm khoảng 0,43 MB mỗi 1000 dòng ở working set cuối (213 MB cho 500k).

Đề xuất (phần suy luận ghi rõ):

1. **Mặc định cho người dùng chạy thật: tối đa 100.000 dòng.** Ở mức này một lần nạp là ~3 giây (1x) và dưới 30 giây (4x), working set cuối ~450 MB. Suy luận: đủ để B-Tree có số tầng và số trang cho Capacity Advisor, mà không phụ thuộc vào máy mạnh.
2. **500.000 dòng cho phép như tùy chọn có cảnh báo**, đã đo chạy được trên máy đo, với thông báo thời gian (10 giây đến ~1 phút tùy máy) và RAM (~0,6 GB cuối, đỉnh khoảng 1,1 GB). Suy luận: nên bật khi người dùng chủ động chọn, và có nút hủy.
3. Trên 500k: không chạy thật, dùng công thức nhãn Ước lượng như `CLAUDE.md` đã chốt.
4. **Chưa đo, không kết luận được:** máy có 4 GB RAM, điện thoại, Safari/Firefox, hay 2 tab cùng mở PGlite. Đỉnh ~1,1 GB lúc khởi tạo là rủi ro đầu tiên cần thử trên máy yếu thật trước khi chốt mức 500k cho mọi người.
