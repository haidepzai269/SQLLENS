# Bản đồ Story

Bản nháp chờ chủ dự án duyệt. Sau khi duyệt, mỗi Story được băm thành Task trong `_bmad-output/SP0xx/STR0xx/Task0xx/`.

Số Story không lặp trong toàn dự án, giống số Task. Cột "GD" đánh dấu Story có màn hình, Story này phải qua góc review giao diện. Cột "Nhãn" ghi nhãn kết luận mà Story tạo ra.

## SP001 Nền móng

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR001 Khung repo | `web/` (Next.js, TypeScript, shadcn/ui) và `api/` (Gin) có lint, typecheck, test chạy trong CI. Các thư viện đã biết được cài sẵn | | |
| STR002 Hệ thống giao diện | Có `DESIGN.md` và `EXPERIENCE.md`, token màu nền tối kiểu phòng lab, khung ứng dụng, tab engine, tab NoSQL và LSM-Tree bị khóa | Có | |
| STR003 Hai ngôn ngữ | Đổi được tiếng Việt và tiếng Anh. Bản dịch tách theo module. CI báo lỗi khi thiếu key ở một ngôn ngữ | Có | |
| STR004 Hợp đồng chung | Có kiểu `Conclusion` mang đúng một nhãn, kiểu `NotSimulated`, `EngineAdapter` và định dạng lỗi API. Thiếu nhãn thì không compile được | | |
| STR005 Gin và deploy | Vercel và Render chạy được, `rewrites` nối hai bên, có healthcheck và ping giữ thức không chạm Neon. Log của Gin không chứa SQL người dùng | | |
| STR006 Luồng mỏng | Dán SQL, PGlite chạy, hiện một kết luận gắn nhãn. Có Playwright test giữ luồng này không gãy | Có | Thật |

## SP002 Thử rủi ro

Kết quả của Epic này là số đo ghi vào `CLAUDE.md`, không phải tính năng.

| Story | Câu hỏi phải trả lời | GD | Nhãn |
|---|---|---|---|
| STR007 PGlite trên trình duyệt thật | WASM có tải được trên Vercel không? Thời gian khởi động và RAM ở 10k, 100k, 500k là bao nhiêu? `pageinspect` và `pgsql-parser` có chạy không? | | |
| STR008 Cookie và stream | Gọi qua `rewrites` có giữ được cookie và stream không? | | |
| STR009 Máy Oracle | Xin được máy ARM không? Mỗi container MySQL tốn bao nhiêu RAM và khởi động mất bao lâu? Chạy được bao nhiêu phiên cùng lúc? Ngưỡng thu hồi máy nhàn rỗi là gì? | | |
| STR010 Lock wait MySQL | Hai connection thật có bắt được lock wait qua `performance_schema.data_lock_waits` không? | | |
| STR011 Điều khoản và công cụ | Điều khoản ping của Render, hạn mức CU-giờ của Neon, chính sách dữ liệu của các gói LLM free, agent-browser trên Windows | | |

## SP003 Engine PostgreSQL

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR012 Nạp PGlite | PGlite chạy trong worker, chỉ tải khi chọn PostgreSQL, có tiến trình tải và màn hình lỗi | Có | |
| STR013 Chạy SQL an toàn | SQL người dùng chạy bằng role quyền thấp, có timeout và nút hủy. Treo query không làm treo giao diện. Hiện lưới kết quả | Có | Thật |
| STR014 `data-lab` | Sinh dữ liệu theo tên cột và kiểu dữ liệu, chỉnh được độ lệch dữ liệu, chọn mức 10k, 100k, 500k, có tiến trình và nút hủy | Có | |
| STR015 Thử rồi hoàn tác | Thử thay đổi trong transaction rồi rollback, trạng thái dữ liệu trở lại như cũ | | |

## SP004 Sandbox MySQL

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR016 Sandbox agent | Agent có API tạo, chạy, hủy phiên, xác thực bằng token. Trạng thái phiên nằm ở agent nên Render restart không mất phiên | | |
| STR017 Container theo phiên | Mỗi phiên một container, giới hạn CPU và RAM, không có mạng ra ngoài, tự hủy khi hết hạn, có trần số phiên | | |
| STR018 Quyền thấp | SQL người dùng chạy bằng role quyền thấp, không đọc được thông tin hệ thống và không đọc ghi được file | | |
| STR019 Nối vào sản phẩm | Gin chuyển tiếp đến agent, có `EngineAdapter` cho MySQL, có màn hình đang khởi động, hết hạn, hết chỗ. Không ghi log SQL | Có | Thật |
| STR020 Kiểm tra bảo mật | Chạy `security-audit` trong Docker tắt mạng, sửa hết lỗi nghiêm trọng trước mốc ngày 3 | | |

## SP005 Đăng nhập và quota

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR021 CSDL của app | Schema và migration trên Neon cho tài khoản và phiên đăng nhập | | |
| STR022 OAuth | Đăng nhập, đăng xuất bằng Google và GitHub, cookie an toàn | Có | |
| STR023 Quota | Gin kiểm tra quyền và quota bằng Upstash, không tin dữ liệu từ frontend. Có màn hình khi hết quota | Có | |
| STR024 Cổng đăng nhập | PostgreSQL dùng tự do. Chọn MySQL hoặc AI thì được mời đăng nhập, đăng nhập xong quay lại đúng chỗ và không mất SQL đã dán | Có | |

## SP006 `sql-intake`

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR025 Ô soạn SQL | CodeMirror theo dialect đã chọn, có SQL mẫu, báo lỗi đúng dòng, dùng được trên điện thoại | Có | |
| STR026 Parser hai engine | `pgsql-parser` và `node-sql-parser` trả về cùng một kiểu kết quả. Lỗi parse của MySQL không chặn việc gửi cho MySQL thật | | |
| STR027 Phân loại đầu vào | Nhận biết schema, query, hay cả hai, kể cả file dump dài | | |
| STR028 Suy ra schema | Chỉ dán query thì suy ra schema, người dùng sửa và xác nhận rồi mới chạy | Có | |

## SP007 `plan-runner`

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR029 Chuẩn hóa plan | `EXPLAIN` của hai engine đưa về cùng kiểu `PlanNode`, có số dòng và số trang đọc khi engine cung cấp | | Thật |
| STR030 Sơ đồ bảng | React Flow và thẻ shadcn/ui hiện cột, PK, FK, tự xếp bằng `dagre`, gom bớt khi quá nhiều bảng. Kéo thẻ, đường nối chạy theo, kéo khoảng trống hoặc Space để di chuyển canvas, cuộn để zoom, có nút vừa màn hình và xếp lại, nhớ vị trí. Cụm nút không được che thẻ trên điện thoại, mẫu HTML còn lỗi này | Có | |
| STR031 Cây plan | React Flow vẽ tổng quan các bước, kéo được thẻ và di chuyển canvas như sơ đồ bảng, bấm một bước thì mở chi tiết | Có | Thật |
| STR032 Animation join | Nested Loop, Hash Join, Merge Join theo loại join và số dòng của plan thật, ghi rõ là mẫu minh họa. MySQL không có Merge Join | Có | Mô phỏng |

## SP008 `btree-reader`

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR033 Đọc cây PostgreSQL | Đọc cây thật bằng `pageinspect` qua thành phần quản trị, đưa về `BTreeModel` | | Thật |
| STR034 Dựng cây MySQL | Dựng lại từ dữ liệu thật, đối chiếu `mysql.innodb_index_stats`, lệch thì báo | | Mô phỏng |
| STR035 Vẽ cây | Nền tối kiểu phòng lab, gom node thành `+206 node`, chạy được khi cây lớn. Chọn được kiểu "Cố định" hoặc "Kéo tự do", animation chạy theo vị trí node hiện tại. Node kéo sát nhau không được chồng chữ lên nhau, mẫu HTML còn lỗi này | Có | Theo nguồn |
| STR036 Key rơi | Key rơi từ root qua internal xuống leaf, chạy từng bước, tua lại, kèm câu giải thích. Báo lại nếu GSAP không hợp | Có | Theo nguồn |
| STR037 Range scan và khác biệt engine | Range scan trượt ngang leaf, MySQL secondary index rơi hai lần, PostgreSQL nhảy từ index sang heap | Có | Theo nguồn |
| STR038 Cuộc đua và cây tối | Seq Scan đua với Index Scan bằng số dòng và số trang, không bằng thời gian. Query không dùng được index thì cây tối đi | Có | Thật |

## SP009 `findings`

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR039 Luật schema | Thiếu PK, FK không có index, FLOAT lưu tiền, VARCHAR quá lớn | | |
| STR040 Luật query | Bọc hàm lên cột có index, `LIKE '%x'`, sai tiền tố trái của composite index, ép kiểu ngầm | | |
| STR041 Bằng chứng | Mỗi rủi ro gắn bằng chứng từ plan với đúng một nhãn. Không đủ dữ liệu thì báo "chưa mô phỏng được". Không có câu nào hàm ý thiết kế ổn | | Theo nguồn |
| STR042 Màn hình rủi ro | Danh sách rủi ro có màu mức độ đỏ, vàng, xanh ở border và nền nhẹ, bấm một mục thì tô đúng chỗ trong SQL và sơ đồ | Có | Theo nguồn |

## SP010 `what-if`

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR043 Thử sửa PostgreSQL | Áp dụng cách sửa trong transaction rồi rollback, so số dòng và số trang trước và sau | | Thật |
| STR044 Thử sửa MySQL | Làm trên bảng clone vì `CREATE INDEX` tự commit, xong thì dọn | | Thật |
| STR045 Màn hình so sánh | Chia đôi trước và sau, sửa rồi chạy lại ngay | Có | Thật |
| STR046 Số liệu Capacity | Đo thật đến 500k, trên mức đó dùng công thức từ độ rộng node và kích thước đã đo. Không có QPS, không có độ trễ | | Thật, Ước lượng |
| STR047 Màn hình Capacity | Kéo thanh quy mô thì cây mọc thêm tầng, hiện số tầng, dung lượng index, số trang đọc, nhãn đổi đúng lúc vượt 500k | Có | Thật, Ước lượng |

## SP011 `conflict-sim`

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR048 Giả lập PostgreSQL | Lost update, deadlock do cập nhật ngược thứ tự, write skew, double booking, non-repeatable read. Không có dirty read | | Mô phỏng |
| STR049 Đối chiếu trong CI | Golden test so 5 kịch bản với Postgres thật, lệch thì CI đỏ | | |
| STR050 Tranh chấp MySQL | Hai connection thật, đọc `performance_schema.data_lock_waits`, dirty read chỉ ở `READ UNCOMMITTED` | | Thật |
| STR051 Timeline | Hai session theo từng nhịp, chạy từng bước, tua lại, đồ thị chờ khóa bằng Cytoscape.js | Có | Theo nguồn |
| STR052 Tiêu chí hỏng | Kịch bản mẫu có sẵn điều kiện, người dùng viết thêm bằng `SELECT`. Không có điều kiện thì chỉ báo deadlock và chờ khóa | Có | Theo nguồn |

## SP012 AI Mentor

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR053 AI proxy | Key nằm ở Gin, xoay tua model, stream, tính quota, không ghi log SQL, tuân theo kết quả STR011 về dữ liệu | | |
| STR054 Gói bằng chứng | AI chỉ nhận dữ liệu làm bằng chứng, không gọi được công cụ. SQL người dùng nhét lệnh vào cũng không đổi được hành vi | | |
| STR055 Chạy thử SQL của AI | SQL AI đề xuất chạy thử trước khi hiển thị, lỗi thì không hiện | | Thật |
| STR056 Màn hình Mentor | Hỏi đáp, áp dụng đề xuất rồi so sánh, giải thích số của Capacity Advisor. AI không tự đưa ra số | Có | Theo nguồn |
| STR057 AI Chaos Generator | Linh hoạt, chưa xong thì đẩy ra sau. AI dựng kịch bản hai session từ SQL nghiệp vụ, kịch bản chạy qua `conflict-sim` rồi mới hiện | Có | Theo nguồn |

## SP013 Phát hành

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| STR058 Landing | Trang quảng bá dùng GSAP và `design-taste-frontend`, đủ hai ngôn ngữ | Có | |
| STR059 Đánh bóng luồng | Đi từ dán SQL đến kết luận không đứt đoạn. Mọi trạng thái tải, rỗng, lỗi đã có. Có bàn phím, có giảm chuyển động | Có | |
| STR060 E2E | Playwright chạy luồng chính ở hai engine và hai ngôn ngữ | | |
| STR061 Kiểm tra cuối | `security-audit` đầy đủ, rà nhãn kết luận trên toàn sản phẩm, danh sách việc trước khi phát hành | | |
