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
