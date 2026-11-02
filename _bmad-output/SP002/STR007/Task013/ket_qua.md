# Kết quả Task013: pageinspect và parser trong trình duyệt

Ngày chạy: 2026-11-02. Chromium headless do Playwright 1.64.1 điều khiển, trên Windows 11, Node 22.15. PGlite 0.5.14 (PostgreSQL 18.6), `pgsql-parser` 18.3.2 (dùng `libpg-query` 18.2.1), `node-sql-parser` 5.4.0. Ba bản này ghim đúng bản đang khóa trong `web/package-lock.json`.

Lệnh đã chạy: `cd spikes/pg-tools && npm ci && npm run check-tools`. Kết quả: 1 test pass (khoảng 11 đến 22 giây). Lệnh này tự dựng bundle bằng esbuild, bật server tĩnh cổng 4173, rồi in từng AC. Số liệu chi tiết nằm ở `results.json` (không commit, sinh lại khi chạy).

Nhãn: mọi số dưới đây là đo thật trên một máy, một lần chạy chính. Thời gian chỉ để so sánh tương đối, không phải dự đoán cho production.

## AC1: đọc `bt_metap`, `bt_page_stats`, `bt_page_items` (đạt)

`CREATE EXTENSION pageinspect` chạy được trong Chromium sau khi nạp `@electric-sql/pglite/contrib/pageinspect`. Khởi tạo PGlite kèm extension mất khoảng 2,5 giây.

| Bảng | Khóa | Level | Số trang index | Root | Trang internal | Trang leaf |
|---|---|---:|---:|---|---|---|
| 10k dòng | `int` | 1 | 29 | blk 3, 28 item | không có (level 1 chỉ có root và leaf) | blk 1, 367 item |
| 10k dòng | `text` dài 128 ký tự | 2 | 273 | blk 60, 7 item | blk 3, 39 item | blk 1, 40 item |

- Key đầu của leaf `int`: item 1 là high key (`6f 01 00 00` = 367), item 2 là key 1 (`01 00 00 00`), v.v.
- Với 10k dòng `int`, cây chỉ có 1 tầng nên không có trang internal. Muốn có internal ở 10k phải dùng key rộng, nên bảng thứ hai dùng `repeat(md5(..),4)`.

## AC2: đi từ root xuống leaf theo key (đạt)

Chỉ dùng `bt_metap` (lấy root) rồi `bt_page_stats` và `bt_page_items` ở mỗi trang. Ở mỗi trang internal chọn con của item cuối có key nhỏ hơn hoặc bằng key cần tìm. Kiểm 10 lần (5 key mỗi bảng, gồm key đầu, cuối, giữa): trang leaf luôn chứa key, và `htid` trong item leaf trùng đúng `ctid` của dòng trong bảng.

- `t100k` (int, level 1): đường đi root blk 3 → leaf, 2 bước.
- `t300k` (int, level 2): root blk 412 → internal → leaf, 3 bước. Ví dụ key 150000: 412 → 411 → 413.

Hai quy tắc phải nhớ khi viết `BTreeModel` thật:
- Mọi trang không phải rightmost (`btpo_next <> 0`) có item 1 là high key, không phải con trỏ hay dữ liệu. Phải bỏ nó đi trước khi duyệt.
- Ở trang internal, item đầu tiên còn lại là "âm vô cực": `data` rỗng, `ctid` trỏ thẳng đến con trái nhất. Trang root có thể không có high key nên item 1 chính là mục âm vô cực.
- `ctid` của item ở trang internal là `(blkno con, ...)`; chỉ lấy số đầu.

## AC3: đọc toàn bộ trang index (đạt)

Đọc `bt_page_stats` cộng `bt_page_items` cho mọi trang, mỗi trang một truy vấn:

| Bảng | Số trang index | Số item đọc | Thời gian đọc | Thời gian seed |
|---|---:|---:|---:|---:|
| 100k `int` | 275 | 100.547 | 0,8 giây | 0,4 giây |
| 300k `int` | 824 | 301.644 | 2,6 giây | 2,2 giây |

Kết luận: đọc hết cây ở 100k khả thi (dưới 1 giây) nhưng tăng gần tuyến tính, và 500k sẽ vào khoảng 4 đến 5 giây (ngoại suy, chưa đo). Vì vậy giao diện nên đọc theo đường đi (3 trang) cho animation, và chỉ đọc hết khi cần vẽ toàn cây. Khi vẽ toàn cây, nên lấy `bt_page_stats` của mọi trang (rẻ) và chỉ lấy `bt_page_items` cho trang cần mở. Chưa đo cách đó riêng. Số item đọc nhiều hơn số dòng vì mỗi trang trừ rightmost có thêm high key và trang internal có thêm con trỏ.

Lưu ý khi so với số trong `CLAUDE.md`: số "level 2 ở 100k, 500k" đo trước đây khác với kết quả ở đây (int thuần 100k là level 1). Level phụ thuộc độ rộng key, nên số tầng phải lấy từ `bt_metap`, không được giả định theo số dòng.

## AC4: quyền (đạt, kèm một phát hiện quan trọng)

- PGlite chạy với `session_user = postgres`, là superuser. Chỉ superuser gọi được các hàm `pageinspect`. Lỗi của role thường: `must be superuser to use pageinspect functions` (`bt_metap`, `bt_page_stats`, `bt_page_items`) và `must be superuser to use raw page functions` (`get_raw_page`).
- Role `lowpriv` tạo bằng `CREATE ROLE ... NOLOGIN`, cấp `SELECT` trên bảng, rồi `SET ROLE lowpriv`: không gọi được ba hàm B-Tree, vẫn `SELECT` được bảng.
- `GRANT EXECUTE ON FUNCTION bt_metap(text)` cho một role khác vẫn bị từ chối, vì hàm tự kiểm tra superuser trong code. Thành viên `pg_monitor` và `pg_read_all_data` cũng bị từ chối. Chỉ superuser đọc được. ACL của `bt_metap` là `NULL`.
- `CREATE EXTENSION` dưới role thường: bản này chỉ có `pageinspect` nạp qua `extensions`, thử với `amcheck` báo "không có sẵn", nên chưa chứng minh được việc `CREATE EXTENSION` bị chặn theo quyền. Chưa kiểm.

**Phát hiện: `SET ROLE` không phải rào chắn trong PGlite.** Vì `session_user` là superuser, SQL của người dùng chạy dưới `lowpriv` vẫn gọi được `SET ROLE postgres` hoặc `RESET ROLE`, sau đó gọi được `bt_metap` (`low_reset_role_then_call`: OK, `current_user` trở lại `postgres`). Hệ quả cho Nguyên tắc 8 trong `CLAUDE.md`:
- Với PGlite, "chạy bằng role quyền thấp" bằng `SET ROLE` không ngăn được SQL người dùng leo lại superuser. Không có đăng nhập role thật vì PGlite là single-user.
- Phần an toàn thực sự của PostgreSQL ở V1 là: PGlite chạy trong trình duyệt của chính người dùng, nên SQL của họ chỉ ảnh hưởng dữ liệu của họ. Không có dữ liệu của người khác để lộ. Rủi ro còn lại là phá phiên của chính họ.
- Cần chặn ở tầng ứng dụng nếu muốn: đoán trước và từ chối `SET ROLE`, `RESET ROLE`, `SET SESSION AUTHORIZATION`, `pageinspect` trong SQL do người dùng gõ (dùng `pgsql-parser` để nhận diện câu `VariableSetStmt`). Đây là việc cho STR012 và STR013, không nằm trong task này.
- Đường đọc B-Tree phải chạy bằng phiên quản trị của ứng dụng, tách khỏi SQL người dùng. Chưa kiểm cách tách (hai instance PGlite hay một instance với bước kiểm trước khi chạy).

## AC5: `pgsql-parser` trong trình duyệt (đạt)

- 8 trong 8 câu hợp lệ parse đúng: `CREATE TABLE` có FK (`CreateStmt`), `CREATE INDEX`, `SELECT` có JOIN, CTE, subquery `IN`, `LIKE '%son'`, `lower(email) = ..`, `UPDATE`.
- Hai câu sai cú pháp: `SELECT * FROM` trả "syntax error at end of input" với `cursorPosition` 13 (độ dài câu); `SELEC id FROM users` trả `syntax error at or near "SELEC"` với vị trí 0. Vị trí lấy từ `error.sqlDetails.cursorPosition`. Theo số đo này vị trí bắt đầu từ 0 (lỗi ở ký tự đầu cho 0), khác với thông lệ 1-based của `libpg_query`: khi hiển thị dấu chỉ lỗi phải dùng đúng quy ước này, nên kiểm lại bằng một câu lỗi ở giữa trước khi dùng.
- Trang không treo: lỗi trả về trong dưới 2 ms và trang vẫn chạy được `page.evaluate` ngay sau đó. Lần parse đầu mất khoảng 60 ms (khởi tạo WASM), các lần sau dưới 1,5 ms.
- Dung lượng: JS của parser (đã minify) 235.377 byte, gzip **56.981 byte**. File WASM `libpg-query.wasm` 1.717.872 byte, gzip **344.487 byte**. Tổng phần parser phải tải khoảng 400 KB gzip.

Cách nạp WASM (cho `web/` dùng lại): `libpg-query` gọi `PgQueryModule()` không có tham số, và Emscripten tính thư mục WASM từ `document.currentScript.src`. Khi bundle chạy dạng `<script type="module">`, `currentScript` là `null`, nên file `libpg-query.wasm` được tìm **cạnh trang HTML**, không phải cạnh bundle JS. Ở spike này `build.mjs` chép file đó vào cùng thư mục với `index.html`. Với Next.js: phải đặt `libpg-query.wasm` ở đường dẫn tương ứng với URL trang (ví dụ `public/`) hoặc đổi cách nạp; chưa thử trong Next.js, phải kiểm trên `next build` ở STR012. Không thể truyền `locateFile` vì thư viện không cho.

## AC6: `node-sql-parser` trong trình duyệt (đạt, 8/10 câu parse được)

Parse đúng 8 câu: `CREATE TABLE` có `AUTO_INCREMENT` và FK, `CREATE INDEX`, JOIN, CTE, subquery, `LIKE '%son'`, `LOWER(email)`, `UPDATE ... LIMIT`.

Hai câu **lỗi**:
- `SELECT * FROM orders FORCE INDEX (idx_orders_user) WHERE user_id = 5`: lỗi tại cột 27 (`Expected [A-Za-z0-9_$\x80-￿] but " " found.`).
- `SELECT * FROM orders USE INDEX (idx_orders_user) WHERE user_id = 5`: lỗi tại cột 25, cùng thông báo.

Cả hai index hint đều lỗi, không chỉ `FORCE INDEX`. Phù hợp với `CLAUDE.md`: lỗi parse không được chặn việc gửi câu cho MySQL thật.

Dung lượng: import mặc định (`import { Parser } from "node-sql-parser"`) cho bundle 2.609.033 byte, gzip **514.599 byte**, vì chứa mọi dialect. Import riêng dialect (`import mysql from "node-sql-parser/build/mysql"`) cho 292.187 byte, gzip **66.424 byte**, kết quả parse giống hệt. Web nên dùng bản theo dialect.

## AC7 và giới hạn tìm thấy

- Chỉ đo trên Chromium headless trên Windows. Chưa đo Firefox, Safari, trình duyệt thật có giao diện, hay trên Vercel.
- Một tiến trình, một lần chạy chính, nên thời gian không có độ lệch chuẩn. Chạy lại cho thấy cùng cỡ (đọc hết 100k: 0,80 đến 0,84 giây).
- Spike không đo RAM của PGlite trong trình duyệt.
- Spike nạp PGlite qua import map và server tĩnh, không qua bundler của Next.js. Cách nạp trong Next.js đã có ở Task011 (tải tay WASM). Phần `pageinspect.tar.gz` thì chưa thử trong Next.js: `contrib/pageinspect.js` tính đường dẫn `../pageinspect.tar.gz` từ `import.meta.url`, nên cần kiểm tra Turbopack có phát file đó ra hay không trước khi dùng ở `web/`.
- `bt_page_items` ở trang internal với key `text` có thêm 4 byte tiền tố độ dài (`10 02 00 00`); ở key `int` thì key nằm đầu `data`. Hàm duyệt thật phải giải mã theo kiểu cột.
- AC2 chỉ kiểm khóa `int`. Chưa kiểm duyệt cây với khóa `text` hay composite.
