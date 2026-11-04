# SP999: Epic phát sinh

Nơi lưu lỗi cần sửa, tính năng chủ dự án mới thêm và các chỗ làm tắt trong lúc phát triển. Quy tắc nằm ở `_bmad-output/QUY_TRINH.md`, mục 2.

Khi đến lượt làm, chủ dự án và party mode chia thành `STR0xx` và `Task0xx` như các Epic khác.

## Chờ chia

| Nguồn | Việc | Trạng thái |
|---|---|---|
| Task009 | Handler đọc body bằng `ShouldBindJSON` rồi tự trả 400 thì body quá lớn không có Content-Length sẽ không thành 413. Request vẫn bị chặn, nên không phải lỗ hổng | `needs_validation` |
| Task009 | Lỗi do chính `net/http` sinh ra, ví dụ 400 do request hỏng, chưa theo định dạng JSON | Chưa làm |
| Task009 | `golang:1.25-alpine` và `alpine:3.21` chưa ghim digest | Chưa làm |
| Task001 | `npm audit` báo 21 lỗ hổng (19 moderate, 2 low), chủ yếu trong chuỗi ESLint và `shadcn`. Cần xem gói nào lên production | Chưa làm |
| Task003 | Action trong CI chỉ ghim theo tag (`@v4`, `@v5`), chưa ghim SHA | Chưa làm |
| Task003 | Chưa kiểm CI với pull request từ fork | Chưa làm |
| Task007 | `check-i18n` chỉ lấy tên đầu mỗi cặp ngoặc nhọn, chưa hiểu đầy đủ ICU plural. Object rỗng `{}` ở cả hai ngôn ngữ không bị coi là lỗi | Chưa làm |
| Task007 | `react/jsx-no-literals` chỉ chặn chữ trong JSX, không chặn chuỗi trong thuộc tính như `aria-label`, nên chuỗi cứng vẫn lọt | Chưa làm |
| Task007 | Matcher của `web/src/proxy.ts` loại mọi đường dẫn bắt đầu bằng `api`, kể cả trang như `/apiary` | Chưa làm |
| Task011 | Chưa có test cho `dispose` khi rời trang, reviewer chỉ đọc code | Chưa làm |
| Task011 | Date không hợp lệ hiện chữ `null` thay vì `NULL`, không crash | Chưa làm |
| Task011 | CI cảnh báo các action đang dùng Node.js 20 | Chưa làm |
| Task004 | Mẫu HTML mới kiểm trên Chrome headless, chưa kiểm cửa sổ thật, Firefox, Safari, điện thoại thật và trình đọc màn hình | Chưa làm |
| Task004 | `inspect.mjs` của skill `design-taste-frontend` không khởi động được trên máy này vì launcher Chrome thoát sớm | Chưa làm |
| Task005 | Bảng tương phản trong `DESIGN.md` là số ghi tay, test chỉ chặn cặp chữ dưới 4,5:1 | Chưa làm |
| Task005 | `control` trên `stage` (1,70:1) và `line` trên `ground` (1,25:1) dưới 3:1 cho phần tử giao diện, giữ theo mẫu | `needs_validation` |
| Task005 | Chưa có giao diện sáng, `.dark` trùng `:root` | Chưa làm |
| Task006 | Đổi qua lại mốc 900 px thì nội dung các vùng bị mount lại. Task đặt nội dung thật phải giữ trạng thái ở trên `WorkspaceLayout` | Chưa làm |
| Task006 | `/lab` có `<main>` riêng, và tab engine ở thanh trên chưa tác động lên `/lab` | Chưa làm |
| Task006 | Dòng giải thích tab khóa không tự mất cho đến khi focus hoặc bấm tab khác | `needs_validation` |
| Task013 | Kiểm trong `next build` xem `libpg-query.wasm` và `pageinspect.tar.gz` có được phát ra đúng chỗ không | Chưa làm |
| Task016 | `spikes/mysql-lock` không bắt signal, Ctrl-C giữa chừng có thể để sót container `t016-mysql` | Chưa làm |
| Task016 | Mới kiểm trên MySQL 8.4.13, chưa kiểm 8.0 hay 9.x | Chưa làm |
| Task012 | Đo PGlite trên máy RAM thấp thật trước khi chốt mức 500k, vì đỉnh RAM lúc khởi tạo khoảng 1,1 GB | Chưa làm |
| Task012 | Chưa chạy lại `npm run measure` sau bản sửa `clearTimeout`, chưa thử `npm ci` từ thư mục sạch | Chưa làm |
| Task010 | `compress: false` của Task014 chưa đưa vào `web/next.config.ts`. Chỉ cần nếu tự host bằng `next start` | Chưa làm |
| Task010 | `next start` thiếu `API_ORIGIN` lúc chạy vẫn rơi về `localhost:8080`, không báo lỗi | Chưa làm |
| Task010 | GitHub tắt workflow theo lịch sau 60 ngày repo không có hoạt động, làm `keep-awake` ngừng | Chưa làm |
| Task010 | AC7 chưa làm: chưa đo cookie và stream qua Vercel thật vì `api/` chưa có route stream. Đo khi SP005 có cookie đăng nhập và SP012 có stream AI | Chưa làm |
| Task009 | `HEAD /healthz` trả 405. Chỉ cần sửa nếu ping giữ thức dùng HEAD. Task010 dùng GET | `needs_validation` |
| Task022 | Chưa kiểm PGlite thật trả gì cho `infinity` của timestamptz. Nếu trả `Date` không hợp lệ thì lưới hiện `Invalid date` thay vì `infinity`. Kiểm khi gắn vào Task020 | `needs_validation` |
| Task022 | AC5 (cuộn ngang ở 390 px) chưa kiểm trên trình duyệt thật, và bản sửa `affectedRows` chưa qua vòng kiểm lại của reviewer. Task020 chụp ảnh 390 px | `needs_validation` |
| Task019 | Route thử `web/src/app/[locale]/e2e-adapter/` đi vào bản production. Chặn hoặc loại ở SP013 | Chưa làm |
| Task019 | Chưa thử `worker_crashed` do hết bộ nhớ thật. Chưa kiểm worker trên Vercel, Firefox, Safari | `needs_validation` |
| Task019 | Test AC2 (khung main thread dưới 200 ms) trượt 1 lần khi máy bận, chạy riêng thì đạt. Có thể gây đỏ giả trên CI | `needs_validation` |
| Task019 | `rebuild` chạy lại `history`, nên câu không tất định như `random()` có thể cho dữ liệu khác. Giao diện nên nói rõ khi dựng lại | Chưa làm |
| Task023 | AC5 chưa đạt: 100k dòng `orders` có FK mất 5,1 giây khi đo riêng, mục tiêu dưới 5 giây. SQL của `planData` mất 1,4 giây, phần còn lại là trigger kiểm FK. Tắt trigger tạm thời cần chủ dự án duyệt | Chủ dự án chốt không tắt trigger, đóng |
| Task023 | PK `GENERATED ALWAYS AS IDENTITY` bị loại khỏi `SCHEMA_QUERY`, bảng con trỏ vào nó báo `referenced column not found`. Schema này phổ biến, đề xuất sửa trong Task024 | Task026 |
| Task023 | Sequence của cột serial và identity by default không được đặt lại sau khi chèn, INSERT tay sau đó có thể trùng khóa | Task026 |
| Task023 | Chưa hỗ trợ FK và UNIQUE nhiều cột, `planData` không báo lỗi trước nên INSERT có thể hỏng lúc chạy | Chưa làm |
| Task023 | Partition con bị liệt kê như bảng riêng, chưa chạy thử. Chu trình FK 3 bảng chưa chạy thật trên PGlite | `needs_validation` |
| Task020 | Trên PGlite thật, `infinity` và `-infinity` của timestamptz hiện `Invalid date` ở cả hai ô (kiểm bằng Playwright, trang không sập). Sửa sau khi Task021 merge vì có thể phải đụng `worker.ts` | Task027 |
| Task020 | `ResultGrid` hiện "2 dòng bị ảnh hưởng" dưới câu SELECT sau INSERT 2 dòng, nghi `affectedRows` của PGlite cộng dồn. Chưa kiểm | Task027 |
| Task020 | Adapter không trả chỉ số câu lỗi, nên nhật ký chỉ ghi "Gặp lỗi", chưa ghi được "lỗi ở câu N" như hợp đồng | Task027 |
| Task020 | Nhánh timeout 30 giây của AC4 và chữ "số MB" của AC1 chưa có test riêng | Chưa làm |
| Phiên chính | `render.yaml` không ghi `region`, mặc định của Render là Oregon, trong khi service thật ở Singapore. Nên ghi `region: singapore` cho khớp | Chưa làm |
| Task021 | Rủi ro thoát lên superuser bằng `DO` với `EXECUTE` rồi chỉ tạo đối tượng, lớp hai không thấy, câu đó sống qua `rebuild`. Chủ dự án chấp nhận, xem lại ở cuối SP012 | Đã chấp nhận |
| Task021 | Lớp một tắt mà không báo khi parser không tải được. Cho qua lỗi 25P02 là suy luận, chưa có test riêng. Bản sửa `pg_catalog.` chưa qua reviewer | `needs_validation` |
| Task021 | Mỗi lần khởi tạo, `libpg-query.wasm` bị fetch sai vào `_next/static/chunks/`, trả 404 rồi tự thử lại đúng đường dẫn. Dọn ở SP013 | Chưa làm |
| Task021 | Khởi tạo chậm hơn vì tải thêm `pageinspect.tar.gz` và `libpg-query.wasm`. Chưa đo lại thời gian và RAM | Chưa làm |
| Task021 | `adminQuery` chưa có message trong `protocol.ts`. SP008 thêm khi cần | Chưa làm |
| Task018 | `spikes/mysql-lock` dùng `docker rm -f` không có `-v`, để lại volume ẩn danh | Chưa làm |
| Task018 | Đĩa máy Azure là 29 GB mặc định, không phải 64 GiB P6 như task ghi. AC1 chỉ quét từ IP được NSG cho vào, chưa quét từ IP khác | `needs_validation` |
| Task026 | FK trỏ vào cột `GENERATED ... STORED UNIQUE` bị vi phạm khi sinh dữ liệu, đã tái hiện | Chưa làm |
| Task026 | Bảng chỉ có một cột sequence và không ai trỏ tới báo `no column can be generated`. Partition với serial chưa kiểm | Chưa làm |
| Chủ dự án | Phương án để dành: giữ sẵn 1 container MySQL chờ để phiên mới không phải khởi động. Tốn khoảng 270 MiB RAM thường trực, trên máy 1 GB tức mất một trong hai chỗ phiên. Chỉ làm khi Task034 hoặc người dùng thật cho thấy thời gian chờ vẫn là vấn đề | Để dành. Task034 đo phiên đầu còn 2,87 giây nên chưa cần |
| Task029 | Route thử `/[locale]/e2e-editor` đi vào bản production. Chặn ở SP013 cùng `e2e-adapter` | Chưa làm |
| Task029 | Chạy cả bộ Playwright ghi đè ảnh `anh-vi-1440.png` của Task020 mỗi lần. Ảnh chụp nên ghi ra thư mục tạm, không ghi vào thư mục task | Chưa làm |
| Task029 | `npm run check` thỉnh thoảng trượt vì test vitest vượt 5 giây khi máy bận, chạy lại thì đạt. Có thể gây đỏ giả trên CI | `needs_validation` |
| Task029 | Ô soạn chưa kiểm trên Firefox, Safari, iOS thật. Màu tô backtick và `::` chỉ kiểm ở tầng parser | `needs_validation` |
| Task034 | Hai lần tạo phiên khác tên cùng lúc có thể chọn trùng uid (khoảng 1/40000). SHA256 của bản mẫu chỉ phủ nội dung file thường, không phủ quyền hay symlink | `needs_validation` |
| Task034 | Task thêm cờ `-attach` vào `spikes/mysql-lock/main.go`, ngoài phạm vi | Đã biết |
| Task034 | Root hiện là tài khoản duy nhất của phiên, chưa có role quyền thấp. Việc của STR018 | Chưa làm |
| Task028 | Route thử `/[locale]/e2e-parser` đi vào bản production. Chặn ở SP013 cùng `e2e-adapter` và `e2e-editor` | Chưa làm |
| Task028 | `libpg-query.wasm` vẫn bị fetch sai vào `/_next/static/chunks/` trước khi tới đúng đường dẫn, giống Task021 | Chưa làm |
| Task028 | Chưa chứng minh JS của `pgsql-parser` không tải ở nhánh MySQL, test chỉ phân biệt theo URL `.wasm`. AST của khoảng 20k câu qua `postMessage` chưa thử trên máy chậm | `needs_validation` |
| Task028 | Chưa hỗ trợ `DELIMITER` của MySQL. `tables` sắp theo bảng chữ cái, không theo thứ tự xuất hiện | Chưa làm |
| Task028 | Test `postgres-guard` (Task021) và `result-grid` AC2 trượt khi máy tải, chạy riêng thì đạt | `needs_validation` |
| Task025 | Probe `INSERT` vào cột serial làm sequence tiến lên, vì `nextval` không rollback. Checksum bảng vẫn đúng. Giới hạn đã chấp nhận | Đã biết |
| Task025 | `reject` cho qua `change` mà parser không đọc được, chưa dựng được ca lọt | `needs_validation` |
| Task025 | `EngineAdapter` có thêm `tryChange` bắt buộc, adapter MySQL của SP010 phải cài | Đã biết |
| Task030 | `prepareDump` chưa xử lý: `$tag$` trong identifier có `$`, `ELSE'x'` bị nhầm thành chuỗi `E'...'`, block comment lồng nhau của PostgreSQL, comment `#` của MySQL, `LOCK TABLES` giữa câu nhiều dòng. SQL luôn được giữ nguyên, không bị cắt nhầm | `needs_validation` |
| Task030 | Chỉ thử với dump dựng mẫu, chưa thử dump thật từ `pg_dump` và `mysqldump`. Dòng lệnh `psql` bị bỏ nhưng không được đếm, `lockStatements` đếm cả `UNLOCK TABLES` | `needs_validation` |
| Task031 | Cột của `JOIN ... USING` bị thêm vào mọi bảng trong cùng SELECT, nên 3 bảng trở lên có cột thừa (query vẫn chạy). Do bản sửa review gây ra, chưa sửa | Chưa làm |
| Task031 | Hàm trong FROM như `generate_series(1,3) g` bị bỏ qua, `g` có thể bị gán cho bảng khác | `needs_validation` |
| Task031 | Không sinh `REFERENCES`, FK chỉ là gợi ý. Tên có schema như `a.t` bị bỏ phần schema. Bảng chỉ dùng `SELECT *` trên MySQL có cột giữ chỗ `_sqllens_placeholder`. Phần MySQL chưa chạy MySQL thật | Đã biết |
| Task024 | `history()` ghi cả câu nội bộ (`SCHEMA_QUERY`, kiểm bảng sau mỗi lần Chạy, `BEGIN`, batch `INSERT`, `COMMIT`), nên số câu hiện khi dừng bị sai và Dựng lại phát lại cả dữ liệu đã sinh | Task027 |
| Task024 | Nút Sinh dữ liệu chỉ cập nhật sau lần Chạy thành công. Bấm Hủy lúc batch cuối vẫn COMMIT. Nhánh timeout và `worker_crashed` khi sinh dữ liệu chưa ép chạy thật. ROLLBACK cũng timeout thì lỗi bị nuốt | `needs_validation` |
| Task024 | `lab.spec.ts` ghi đè ảnh của Task020 mỗi lần chạy. Gộp với mục ảnh của Task029 | Chưa làm |
| Task024 | Liên kết thật tới Capacity Advisor khi SP010 có | Chưa làm |
| Task036 | Routine hoặc view `SQL SECURITY INVOKER` do người dùng tạo chạy bằng quyền người gọi, nên root không được gọi chúng. Tham số `--pager`, `--tee`, `--plugin-dir` của `session.sh exec` chưa bị chặn | `needs_validation` |
| Chủ dự án | Key OpenRouter chưa lấy, chủ dự án nói tạm chưa cần. Cần trước SP012 | Chờ chủ dự án |
| Task043 | Quota dùng cửa sổ cố định, nên quanh ranh giới cửa sổ người dùng có thể dùng tối đa gấp đôi hạn mức. Gói free 500.000 lệnh đủ khoảng 330 người dùng hết hạn mức mỗi ngày | Đã biết |
| Task041 | Hai `Migrate` đồng thời trên hai instance chưa có test. Chưa thử với Neon thật. Test chặn `DROP TABLE` trên database không ở localhost bằng so chuỗi URL, lách được nếu cố ý. `-race` chưa chạy vì máy không có cgo | `needs_validation` |
| Task039 | `bt_page_stats` quét mọi trang: 500k dòng (khoảng 1,4k trang) còn ổn, cây vài chục nghìn trang cần cách khác. Probe `timestamptz` không có múi giờ coi là UTC. Khóa NULL trong index nhiều cột trả `NotSimulated` | Đã biết |
| Task042 | AC7 và AC7b chờ chủ dự án bấm thử với key thật: đăng nhập Google, GitHub, `EVAL` trên Upstash thật. Chưa kiểm `Set-Cookie` qua `rewrites` trên Vercel thật, chưa thử Neon thật | Chờ chủ dự án |
| Task042 | `/auth/*/start` không có giới hạn tần suất: 10.000 yêu cầu trong 10 phút lấp đầy bảng state trong bộ nhớ, mọi người dùng nhận 503 cho đến khi state hết hạn. Cookie `sid` rác vẫn gọi Neon và giữ Neon thức. Cần IP thật từ `X-Forwarded-For` của proxy đã tin. Phải xử lý trước STR020 và STR061 | `needs_validation` |
| Task042 | State OAuth nằm trong bộ nhớ, Render restart giữa chừng thì phải bấm đăng nhập lại, không chạy được nhiều instance. SP012 phải sửa `build()` trong `main.go` để gắn `/ai` bằng `a.Gate(quota.AIMessage)` | Đã biết |
| Task035 | Một dòng kết quả có thể lên đến `max_allowed_packet` 64 MB, rủi ro agent thiếu RAM. Timer bắn đúng lúc câu vừa xong vẫn báo timeout. Ba bản sửa cuối có test nhưng chưa qua review vì đã hết 2 vòng | `needs_validation` |
| Task035 | `--tmpfs /tmp` trong `session.sh` chưa đặt `size`. `readToken` chưa kiểm chủ file token. `systemctl stop` không dọn container, chỉ dọn lúc khởi động lại. Lỗi giữa lô nhiều câu làm mất kết quả các câu trước. `-race` chưa chạy vì máy nhà không có cgo | Chưa làm |
| Task040 | Độ lệch node lưu ở `sqllens.btree.pg` theo số trang, mở cây khác cùng engine có thể chồng node, nên gắn khóa với index. `nodePosition` dùng biến module nên hai `BTreeView` cùng lúc ghi đè nhau | `needs_validation` |
| Task040 | Nhãn tầng Root, Internal, Leaf không dính khi cuộn ngang. Route thử `e2e-btree` chặn ở SP013. Chưa kiểm trình đọc màn hình thật, Firefox, Safari, cảm ứng thiết bị thật, cây trên 1000 node | Chưa làm |
| Task032 | Lỗi PostgreSQL không có `cursorPosition` có thể hiện nhầm câu không bật được trình kiểm tra, chưa có đầu vào tái hiện. Danh sách câu chưa nhảy tới câu trong ô soạn. Test đối chứng AC7 của `sql-editor.spec.ts` đổi sang `/vi/e2e-parser`, yếu đi một chút | `needs_validation` |
| Task032 | Mỗi lần chạy Playwright ghi đè ảnh trong thư mục Task024 và Task032. Ảnh chụp nên ghi ra thư mục tạm | Chưa làm |
| Task037 | Gin phải giới hạn theo người dùng cả số phiên, tần suất và tổng thời gian câu lệnh, vì một token đủ chiếm 2 phiên và 2 vCPU. Làm ở STR019, là điều kiện mở cổng | Chưa làm |
| Task037 | STR019 phải ép `/opt/sqllens` thuộc root khi triển khai. `readToken` chưa kiểm chủ file. SSH `x11forwarding`, `allowtcpforwarding` để mặc định. `/tmp` trên máy Azure còn file cũ của task trước | Chưa làm |
| Task037 | Lô hàng trăm nghìn câu trả `connection_lost`. Nên có mã lỗi riêng khi phiên bị hủy vì câu kẹt. Cân nhắc `--cpus` thấp hơn và chọn lại `--memory` khi đổi sang B2als v2 | Chưa làm |
| Task037 | Người dùng có thể lách giới hạn bộ nhớ tạm bằng biến session như `internal_tmp_mem_storage_engine`. Giết chéo giữa hai phiên khi cạn RAM chưa tái hiện được. `escalate` có thể hủy phiên khi rollback DML lớn mất hơn 5 giây. Tải thật qua HTTPS chưa kiểm | `needs_validation` |
| Task027 | Dữ liệu sinh không được giữ sau Dựng lại, giao diện đã nói rõ. Câu người dùng phụ thuộc dữ liệu sinh như `INSERT ... SELECT` chạy lại trên bảng rỗng nên có thể ra khác. Lỗi runtime không có vị trí trong nhiều câu thì không biết số câu, nhật ký ghi "Gặp lỗi." | Đã biết |
| Task053 | Luật `composite-prefix` chưa tính skip scan của PostgreSQL 18 và MySQL 8, có thể báo quá tay. STR041 không được viết là index chắc chắn không dùng được, phải lấy bằng chứng từ plan. `NOT (...)` bị bỏ qua, cột so với cột không xét, bảng khớp theo tên và bỏ qua schema | `needs_validation` |
| Task053 | Test thời gian AC5 của `plan-data.test.ts` (ngưỡng 15 giây) trượt khi máy quá tải, đo 16,7 và 19,7 giây, chạy riêng thì đạt. Có thể gây đỏ giả trên CI | `needs_validation` |
| Task052 | `parseMysql` từ chối cả đoạn SQL khi gặp kiểu `real` hoặc `double precision`, thay vì chỉ bỏ câu đó, nên mọi luật MySQL mất hiệu lực với đoạn đó. Lỗi thuộc Task028, nên sửa trước STR041 | Chưa làm |
| Task052 | Không theo dõi `RENAME`, `DROP INDEX`, `DROP CONSTRAINT` khác khóa chính nên có thể bỏ sót rủi ro. `start`, `end` là vị trí cả câu. Index một phần hoặc không phải btree không tính là che FK, cần chủ dự án xác nhận. Bản sửa cuối về `CREATE TABLE IF NOT EXISTS` chưa qua reviewer vì hết 2 vòng. Phần dựng trạng thái schema trùng với Task053, nên gộp | `needs_validation` |
| Task052 | `npm run check` với số worker mặc định làm vitest hết RAM trên máy này (`Array buffer allocation failed`, worker thoát giữa chừng), đạt khi `--maxWorkers=2`. Nên đặt `maxWorkers` trong `vitest.config` | Đã đặt `maxWorkers: 2` |
| Task045 | Khối heap không tham gia chống chồng của `settle`, nên node kéo đè lên heap được. `BTreeDrop` đặt `position: relative` lên vùng cuộn của `BTreeView` khi chạy. Route `e2e-btree-anim` chặn ở SP013. Chưa kiểm Firefox, Safari, cảm ứng thật, trình đọc màn hình thật | Chưa làm |
| Task045 | Cả bộ Playwright chưa chạy trên commit cuối vì máy quá tải (hơn 2 giờ mới tới test 30/125, các spec data-lab rất chậm). Chỉ chạy `btree-anim` và `btree-view` đạt 26/26. Nên chạy lại cả bộ trên `main` khi máy rảnh | Chưa làm |
| Task050 | `normalize` gộp khoảng trắng trong chuỗi literal, kịch bản có sẵn không dính. SSI chỉ mô hình vòng hai giao dịch. Chưa có DELETE, FOR SHARE, UPDATE cột khóa duy nhất | `needs_validation` |
| Task050 | STR051 phải thêm bản dịch `conflictSim.tick.*`, `conflictSim.error.*`, `conflictSim.outcome.*`, `conflictSim.notSimulated.*`. Câu `outcome.not_broken` không được hàm ý thiết kế ổn | Chưa làm |
| Task046 | Khóa advisory mức session không được ROLLBACK hoàn tác khi `explain` chạy câu ghi dữ liệu, câu người dùng thấy chưa nói việc này. Chưa có mẫu MySQL thật cho subquery ở `select_list`, `having` | `needs_validation` |
| Task046 | Adapter MySQL (STR019) phải trả cùng `Outcome<Plan>` cho `explain`. MySQL 8.4 không có ANALYZE ở dạng JSON, số dòng chỉ là ước lượng của optimizer, nên phải chọn nhãn đúng | Chưa làm |
| Task051 | Runner CI đứng hơn 500 ms giữa lúc gửi lệnh bị chờ và lúc poll thì nạn nhân deadlock có thể báo lỗi trước khi test thấy nó chờ, làm lệch thứ tự chờ. Không tái hiện được. Nếu flake thì tăng `deadlock_timeout` trong `connect()` | `needs_validation` |
| Task033 | Focus có thể mất sau Xác nhận, và ở 390 px sau lỗi schema rồi Hủy. `sql` đổi rồi đổi ngược khi dialog đang mở thì dialog có thể mở lại. Một test AC3 trượt 1 trong 9 lần, chưa tái hiện được | `needs_validation` |
| Task033 | Dạng form chưa hỗ trợ khóa chính nhiều cột. Chế độ tự viết không kiểm đó là `CREATE TABLE`, SQL vẫn qua lớp bảo vệ role. Chưa kiểm với MySQL | Chưa làm |
| Task033 | Test thời gian dễ trượt khi máy bận: `plan-data` AC5 100k (Task023, ngưỡng 15 giây), `btree-read` 500k (Task039, ngưỡng 1.000 ms). Nên chỉ chặn ở mức thô, ghi số đo riêng | Chưa làm |
| Task048 | Thẻ đặt dòng ước tính mỗi lần cạnh dòng thật tổng các vòng mà không ghi `loops`, nên dễ hiểu nhầm (fixture hiện 1 và 100 không có cờ lệch). Nên thêm `x{loops}` khi `loops > 1`. Nếu engine trả `actualRows` kèm `analyzed: false` thì thẻ vẫn ghi Dòng thật, Task046 hiện không tạo ca này | `needs_validation` |
| Task048 | Component nhãn `Badge` chép từ `btree-view.tsx`, nên tách dùng chung. Route `e2e-plan` chặn ở SP013. Plan 20 tầng chỉ thấy một phần vì Vừa màn hình chặn ở zoom 0,3. Chưa thử cảm ứng thật, Firefox, Safari | Chưa làm |
| Task047 | Khóa `sqllens.schema.*` là toàn cục, hai schema có bảng trùng tên dùng chung vị trí. Nơi gắn sơ đồ phải `useMemo` mảng `tables`, nếu không sơ đồ dựng lại liên tục. Ở một cột 390 px đường nối quặt vòng, đúng cột nhưng xấu. Thẻ chưa lưu vị trí chồng thẻ đã lưu đã sửa nhưng chưa có test | `needs_validation` |
| Task047 | Route `e2e-schema` chặn ở SP013. Chưa có test phím Space. Chưa kiểm cảm ứng thật, Firefox, Safari, trình đọc màn hình thật. Ảnh `1440-en`, `390-vi`, `ac4-120-bang-du-cot-1440` chưa ai xem tận mắt | Chưa làm |
