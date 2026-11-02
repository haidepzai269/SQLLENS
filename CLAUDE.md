# SQLLens: bộ nhớ dự án

Đọc file này trước khi làm bất kỳ việc gì trong dự án. Khi một quyết định thay đổi, cập nhật file này ngay trong cùng lượt làm việc.

- **Tài liệu gốc:** [Google Doc](https://docs.google.com/document/d/1Rg-zKY2ysY4Z4PChw2sZpVk4ImadZ5U95_0gtz-eXjo/edit)
- **Khi Google Doc và file này khác nhau:** file này đúng hơn, cho đến khi Google Doc được cập nhật.
- **Giai đoạn hiện tại:** đã chốt 13 Epic và 61 Story (`_bmad-output/BAN_DO_STORY.md`). Đang làm SP001 và SP002, tiến độ ở `_bmad-output/SP001/README.md` và `_bmad-output/SP002/README.md`.
- **Việc tạm gác:** cập nhật Google Doc. Chỉ làm khi chủ dự án yêu cầu, theo `_bmad-output/CAP_NHAT_GOOGLE_DOC.md`.
- **Key của bên thứ 3:** danh sách ở `KEY_CAN_LAY.md`, file này không được commit. Sau khi chủ dự án điền giá trị, agent không đọc file đó. Cần thêm key thì báo chủ dự án.

## Quy trình làm việc của agent

Đọc `_bmad-output/QUY_TRINH.md` trước khi làm bất kỳ task nào. Tóm tắt: mỗi task nằm ở `_bmad-output/SP0xx/STR0xx/Task0xx/` và một worktree riêng. Amelia làm bằng Ponytail, một reviewer mới kiểm tra, Amelia viết bàn giao, rồi commit và push. Tất cả dùng Sonnet 5.5. Việc phát sinh đưa vào `SP999`.

## Sản phẩm là gì

Nền tảng web giúp lập trình viên nhìn thấy thiết kế database của mình hỏng ở đâu trước khi code, đồng thời giúp người mới hiểu database chạy bên trong như thế nào.

Mục tiêu không dừng ở việc học SQL. Người dùng dán SQL vào, xem hệ thống mô phỏng, sửa lại, chạy lại để biết lựa chọn của mình có hợp lý không.

**Đối tượng:** người mới học SQL, sinh viên và backend engineer.

**Khác biệt:** các công cụ hiện có chỉ làm từng phần (PGSimCity, QueryForge, deadlocker, DB Fiddle, PEV2). Sản phẩm này gộp chúng thành một luồng từ dán SQL đến kết luận.

## Phạm vi V1

Người dùng dán SQL rồi nhận được cả ba:

- **A. Thấy bên trong:** B-Tree, luồng thực thi, sơ đồ schema.
- **B. Thử kịch bản hỏng:** tranh chấp giữa hai session, tác động của quy mô dữ liệu, sửa rồi chạy lại.
- **C. Kiểm tra thiết kế:** danh sách rủi ro của schema và query, kèm bằng chứng.

Kèm theo: AI Mentor, đăng nhập, PostgreSQL và MySQL.

**Thời hạn: đúng 7 ngày.** AI agent làm song song, chủ dự án điều phối.

**Để sau V1:** NoSQL và LSM-Tree (giữ tab khóa trên giao diện), tối ưu chi phí AI.

## Quyết định đã chốt

| Hạng mục | Quyết định |
|---|---|
| Frontend | Next.js + TypeScript + shadcn/ui, deploy trên Vercel |
| Animation | GSAP cho landing page, trang quảng bá và mô phỏng nếu tiện |
| Backend | Gin (Go), Docker image trên Render free |
| Giờ chạy backend | Giữ thức từ 7:00 đến 24:00 giờ Việt Nam, chấp nhận ban đêm kém ổn định |
| PostgreSQL | PGlite chạy trong trình duyệt, không cần server |
| MySQL | MySQL thật, mỗi phiên một container trên Oracle Always Free |
| Ngân sách | 0 đồng |
| AI | Key nằm ở Gin, xoay tua nhiều model, tối ưu sau |
| Đăng nhập | PostgreSQL dùng tự do. MySQL và AI phải đăng nhập bằng Google hoặc GitHub |
| Ngôn ngữ | Tiếng Việt và tiếng Anh làm song song từ dòng code đầu tiên. Không viết chuỗi giao diện cứng trong code. Thiếu bản dịch ở một ngôn ngữ thì CI báo lỗi |
| Animation join | Làm trong V1: Nested Loop, Hash Join, Merge Join. MySQL không có Merge Join |
| Capacity Advisor | Làm bản gọn trong V1, xem mục riêng bên dưới |
| Khi chỉ dán query | Suy ra schema từ query, người dùng xác nhận rồi mới chạy |
| Tiêu chí "hỏng" | Kịch bản mẫu có sẵn điều kiện, người dùng tự viết thêm bằng `SELECT`. Không có điều kiện thì chỉ báo deadlock và chờ khóa |
| Trạng thái phiên MySQL | Nằm ở sandbox agent trên Oracle, vì Render có thể restart |
| Tên sản phẩm | Tạm dùng SQLLens. Đã có SQLLens.AI và một SQLLens mã nguồn mở cùng lĩnh vực, xem lại trước khi mua domain |
| Postgres của app | Neon free. Không đặt trên Render, không đặt trên máy Oracle vì máy đó chạy SQL không đáng tin |
| Quota và giới hạn tần suất | Upstash Redis free, kiểm tra ở Gin. Lệnh ping giữ thức không được chạm Neon, để Neon còn tự tắt và tiết kiệm CU-giờ |
| Trình soạn thảo SQL | CodeMirror 6, qua `@uiw/react-codemirror` và `@codemirror/lang-sql` |
| Sơ đồ bảng và cây plan | React Flow, thẻ dùng component shadcn/ui hoặc React, xếp vị trí bằng `@dagrejs/dagre`. Kéo thả và di chuyển canvas tham khảo n8n và `webhook-hub` |
| Đồ thị chờ khóa | Cytoscape.js, tải riêng theo màn hình |
| Bố cục màn hình chính | Ba cột cộng panel terminal ở dưới, bật tắt và đổi kích thước được. Trên điện thoại chuyển thành tab. Chuẩn nằm ở `_bmad-output/SP001/STR002/Task004/mau_giao_dien.html` |
| Animation trong sản phẩm | Chỉ chạy khi người dùng bấm Chạy. Tự chạy chỉ dùng ở landing page |
| Kiểu di chuyển cây B-Tree | Chọn được "Cố định" hoặc "Kéo tự do". Vị trí kéo chỉ để dễ nhìn, không đổi thứ tự key thật |
| Màu mức độ ở cột rủi ro | Đỏ là hỏng, vàng là ước lượng hoặc chưa mô phỏng được, xanh là không hỏng trong kịch bản đã chạy. Mức độ tách khỏi nhãn kết luận, và màu xanh không được hàm ý "thiết kế này ổn" |
| Cây B-Tree | Tự vẽ bằng SVG và GSAP, không dùng Cytoscape.js |
| Biểu đồ số liệu | Thành phần chart của shadcn/ui khi màn hình thật sự cần, còn lại hiện số bằng thẻ shadcn/ui |
| Quản lý gói | npm. `web/` và `api/` độc lập, không dùng workspace |
| AI Chaos Generator | Có trong V1 nhưng linh hoạt: chưa xong thì đẩy ra sau, không chặn phát hành. Kịch bản AI dựng phải chạy qua `conflict-sim` trước khi hiển thị, không để AI tự kết luận |

## Danh sách Epic

Epic nào có màn hình thì phải có Story giao diện riêng. Không Epic nào được xong khi chỉ có logic.

| Epic | Kết quả | Phụ thuộc |
|---|---|---|
| SP001 Nền móng | Repo, hệ thống giao diện, i18n và CI, Gin, deploy, hợp đồng chung, luồng mỏng chạy xuyên suốt | Không |
| SP002 Thử rủi ro | Số đo thật cho PGlite, stream qua `rewrites`, RAM container, lock wait | Không |
| SP003 Engine PostgreSQL | PGlite trong worker, tải khi cần, dữ liệu 10k, 100k, 500k | SP001, SP002 |
| SP004 Sandbox MySQL | Agent trên Oracle, mỗi phiên một container, role quyền thấp | SP002 |
| SP005 Đăng nhập và quota | Google, GitHub, Neon, Upstash, quota ở Gin | SP001 |
| SP006 `sql-intake` | Dán SQL, parser hai engine, suy ra schema rồi xác nhận | SP001 |
| SP007 `plan-runner` | Luồng thực thi, sơ đồ schema, animation join | SP003, SP006 |
| SP008 `btree-reader` | Cây thật và toàn bộ giao diện B-Tree | SP003 |
| SP009 `findings` | Danh sách rủi ro kèm bằng chứng | SP006, SP007 |
| SP010 `what-if` | Sửa rồi chạy lại, Capacity Advisor | SP003, SP008 |
| SP011 `conflict-sim` | 5 kịch bản PostgreSQL, hai connection thật trên MySQL | SP003, SP004 |
| SP012 AI Mentor | AI proxy xoay model, SQL của AI được chạy thử trước, AI Chaos Generator | SP005, SP009, SP011 |
| SP013 Phát hành | Đánh bóng luồng, landing, E2E, `security-audit` | Tất cả |

## Capacity Advisor

Trả lời câu hỏi: khi dữ liệu tăng lên, thiết kế này bắt đầu gặp vấn đề ở đâu.

**Chốt: làm trong 7 ngày.** Phần đã làm phải chạy tốt và được tối ưu, nhưng V1 chưa cần đủ mọi tính năng.

- **Gồm:** thanh kéo quy mô, số tầng B-Tree, dung lượng index và số trang phải đọc.
- **Nguồn số liệu:** đo thật đến 500k dòng, trên mức đó dùng công thức từ độ rộng node và kích thước thật đã đo, gắn nhãn Ước lượng.
- **Vai trò của AI:** chỉ giải thích các số đã tính và gợi ý hướng xử lý như index, partition. AI không tự đưa ra số.
- **Không làm:** dự đoán QPS và độ trễ production, vì không có dữ liệu phần cứng của người dùng.

## Kiến trúc

```text
Vercel: Next.js + PGlite (PostgreSQL chạy tại trình duyệt)
  │
  └── Cần MySQL hoặc AI ──► Render free: Gin (auth, quota, AI proxy)
                               ├─► Neon: Postgres của app
                               ├─► Upstash Redis: quota
                               ├─► Các model AI
                               └─► Oracle VM: sandbox agent ──► MySQL theo từng phiên
```

Parser và luật kiểm tra viết bằng TypeScript ở frontend, dùng chung cho hai engine. Gin không tin dữ liệu từ frontend: quota và kiểm tra quyền nằm ở Gin.

**Module:** `sql-intake`, `data-lab`, `plan-runner`, `btree-reader`, `findings`, `what-if`, `conflict-sim`.

## Nguyên tắc không được phá

1. **Mỗi kết luận mang đúng một nhãn:**
   - **Thật:** database vừa chạy ra kết quả này.
   - **Mô phỏng:** engine của dự án tính, đã đối chiếu với database thật.
   - **Ước lượng:** ngoại suy khi vượt quy mô chạy được.
2. **Không bao giờ nói "thiết kế này ổn".** Chỉ nói: với giả định này, kịch bản này hỏng hoặc không hỏng ở bước nào.
3. **Không trình bày thời gian chạy trong sandbox như dự đoán cho production.** So sánh bằng số dòng và số trang đã đọc.
4. **Không đoán khi chưa mô phỏng được.** Báo rõ "chưa mô phỏng được".
5. **Giao diện cho người mới không chỉ có con số.** B-Tree phải có animation từ root qua internal xuống leaf, kèm câu giải thích.
6. **SQL do AI đề xuất phải chạy thử trước khi hiển thị.** AI chỉ nhận dữ liệu làm bằng chứng và không có quyền gọi công cụ.
7. **Không ghi log SQL của người dùng.**
8. **SQL người dùng là không đáng tin:** chạy bằng role quyền thấp, chỉ thành phần quản trị mới đọc được thông tin hệ thống.

## Giao diện B-Tree

- Key rơi từ root qua internal xuống leaf, có chạy từng bước và tua lại.
- Cuộc đua giữa Seq Scan và Index Scan.
- Range scan trượt ngang qua các leaf.
- Kéo thanh dữ liệu thì cây mọc thêm tầng.
- Query không dùng được index thì cây tối đi.
- MySQL secondary index rơi hai lần. PostgreSQL nhảy từ index sang heap.
- Node quá nhiều thì gom thành `+206 node`.
- Nền tối kiểu phòng lab.

## Giao diện join

- Nested Loop: mỗi dòng bảng ngoài đi dò bảng trong.
- Hash Join: dựng bảng băm từ một bảng rồi dò từ bảng còn lại.
- Merge Join (chỉ PostgreSQL): hai con trỏ trượt song song trên dữ liệu đã sắp xếp.
- Loại join và số dòng lấy từ plan thật. Animation chỉ chạy trên một mẫu nhỏ và phải ghi rõ đó là mẫu minh họa.

## Khác biệt giữa hai engine

| | PostgreSQL (PGlite) | MySQL (container) |
|---|---|---|
| Đọc B-Tree | `pageinspect`, nhãn Thật | Dựng lại từ dữ liệu thật, nhãn Mô phỏng, đối chiếu `mysql.innodb_index_stats` |
| Tranh chấp | 5 kịch bản giả lập, nhãn Mô phỏng, đối chiếu Postgres thật trong CI | Hai connection thật, `performance_schema.data_lock_waits`, nhãn Thật |
| Thử cách sửa | Dùng transaction rồi rollback | `CREATE INDEX` tự commit, nên làm trên bảng clone |
| Parser | `pgsql-parser` | `node-sql-parser`, lỗi parse không được chặn việc gửi cho MySQL thật |
| Dirty read | Không xảy ra, không được demo | Có thể demo ở `READ UNCOMMITTED` |

**5 kịch bản tranh chấp của PostgreSQL:** lost update, deadlock do cập nhật ngược thứ tự, write skew, double booking, non-repeatable read.

## Sai lầm trong Google Doc gốc, không được làm theo

- **Giả `pg_class`:** planner vẫn đọc kích thước file thật rồi scale lại. Thay bằng dữ liệu thật ở các mức 10k, 100k và tối đa 500k, trên mức đó gắn nhãn Ước lượng.
- **Cây TypeScript order 3 đến 4 làm nguồn chính:** thay bằng cây thật từ `pageinspect`.
- **Demo dirty read trên PostgreSQL:** PostgreSQL không có hiện tượng này.
- **Client-side hoàn toàn:** không còn đúng vì đã có MySQL, auth và AI.
- **PGlite khoảng 3 MB:** bản 0.5.14 đo được khoảng 5,1 MB sau gzip. Chỉ tải khi người dùng chọn PostgreSQL.

## Đã kiểm chứng

Đo ngày 2026-11-02 trên Node, **chưa đo trên trình duyệt**. PGlite 0.5.14, PostgreSQL 18.6.

| Số dòng | Insert | Tạo index | Level B-Tree |
|---:|---:|---:|---:|
| 10.000 | 44 ms | 10 ms | 1 |
| 100.000 | 1,2 giây | 136 ms | 2 |
| 500.000 | 6,1 giây | 897 ms | 2 |

- Tiến trình dùng 566 MB RAM sau mốc 500k.
- `pageinspect` đọc được root và item của index thật.
- `node-sql-parser` đọc đúng 8/9 câu MySQL thử, lỗi ở `FORCE INDEX`.
- Subagent gọi được subagent khác: Amelia đã gọi `task-reviewer` ở Task002.
- PGlite 0.5.14 chạy được trong Chromium trên bản `next build` của Next.js 16.4.4, kiểm bằng Playwright ở máy và CI (Task011). Chưa kiểm trên Vercel.
- Gói free của dịch vụ ngoài, tra ngày 2026-11-02, chi tiết và nguồn ở `_bmad-output/SP002/STR011/Task017/ket_qua.md`:
  - **Oracle A1:** chỉ còn 2 OCPU và 12 GB RAM, không còn 4 OCPU và 24 GB. Máy bị coi là nhàn rỗi khi trong 7 ngày CPU p95, mạng và bộ nhớ đều dưới 20%.
  - **Render:** 750 giờ mỗi tháng cho cả workspace, ngủ sau 15 phút. Lịch 7:00 đến 24:00 dùng khoảng 510 đến 527 giờ.
  - **Neon:** 100 CU-giờ mỗi project mỗi tháng, 1 GB mỗi project, tự tắt sau 5 phút.
  - **Upstash:** 500.000 lệnh mỗi tháng, khoảng 250 MB.
  - **Gemini gói free:** Google dùng dữ liệu để cải thiện sản phẩm và người duyệt có thể đọc. Theo nguyên tắc 7, không gửi SQL người dùng qua gói free.
  - **Groq:** mặc định không giữ dữ liệu suy luận, có thể giữ tạm tối đa 30 ngày. Có tùy chọn Zero Data Retention.
  - **OpenRouter:** mặc định cho phép provider thu dữ liệu. Phải gửi `data_collection: "deny"` và nên thêm `zdr: true`.
- Trong Chromium, `pageinspect` đọc được root, internal, leaf và đi đúng đường từ root xuống leaf. Đọc hết cây 100k dòng mất khoảng 0,8 giây, nên cây lớn đọc theo đường đi (Task013).
- Level của B-Tree phụ thuộc độ rộng key. Index `int` 100k dòng vẫn là level 1, nên số "level 2 ở 100k" trong bảng trên chỉ đúng với key rộng hơn.
- **PGlite không có ranh giới quyền thật:** `session_user` là superuser, nên SQL chạy dưới role quyền thấp vẫn gọi được `RESET ROLE` hoặc `SET ROLE postgres` (Task013). Với PostgreSQL, nguyên tắc 8 phải thực hiện bằng cách chặn `SET ROLE`, `RESET ROLE`, `SET SESSION AUTHORIZATION` trong SQL người dùng bằng parser, và đọc B-Tree qua đường riêng không đi chung với SQL người dùng. Rủi ro hiện thấp vì PGlite chạy trong trình duyệt của chính người dùng.
- `pgsql-parser` chạy được trong Chromium: phần JS khoảng 57 KB gzip, WASM khoảng 344 KB gzip, `libpg-query.wasm` được tìm cạnh trang HTML. `node-sql-parser` nên import `node-sql-parser/build/mysql` (66 KB gzip thay vì 515 KB).
- MySQL 8.4.13 trong Docker cho lock wait, deadlock, dirty read, lost update và gap lock quan sát được qua `performance_schema.data_lock_waits` và `data_locks`, 5/5 lần giống nhau (Task016). Chỉ connection quản trị đọc được các bảng này: user quyền thấp bị từ chối. Bên bị hủy trong deadlock không cố định, nên `conflict-sim` không được giả định bên nào. Mật khẩu truyền qua biến môi trường vẫn lộ qua `docker inspect`, sandbox agent phải dùng cách khác.
- Gọi Gin qua `rewrites` của Next.js giữ được cookie `HttpOnly` và stream SSE, kiểm trên `next start` ở máy (Task014). Điều kiện: `next start` mặc định nén gzip và gom cả stream, nên phải đặt `compress: false`. Chưa kiểm trên Vercel, Task010 đo lại.
- Container MySQL 8.4 cho sandbox, đo trên amd64 ở máy (Task015):
  - Cấu hình tối giản dùng khoảng 240 đến 260 MiB, so với khoảng 440 MiB khi để mặc định. `--memory` thấp nhất chạy được là 288m, khuyến nghị 384m.
  - Khởi động lạnh đến khi nhận kết nối mất khoảng 13 đến 19 giây. Người dùng sẽ phải chờ, nên SP004 cần thư mục dữ liệu dựng sẵn hoặc giữ sẵn container chờ.
  - Ước tính trên máy Oracle 12 GB: khoảng 20 đến 25 phiên cùng lúc, tối đa 2 phiên khởi động đồng thời vì chỉ có 2 OCPU. Task018 đo lại trên ARM.
  - Cô lập bằng `--network none --read-only --cap-drop ALL` cộng 5 capability tối thiểu. `INTO OUTFILE` bị chặn.
  - File cấu hình mount từ Windows bị mysqld bỏ qua vì quyền 0777, phải kiểm cảnh báo trong log.
  - Task015 dùng `mysql:8.4.6`, Task016 dùng `mysql:8.4.13`. SP004 thống nhất một bản.
- PGlite 0.5.14 treo mãi, không báo lỗi, khi tải WASM thất bại. Vì vậy `web/src/engines/postgres/adapter.ts` tự tải file rồi truyền vào `PGlite.create`. Khi nâng PGlite hoặc đổi chỗ file này phải kiểm lại đường dẫn.

## Chưa kiểm chứng

- Số phiên MySQL chạy cùng lúc trên máy ARM của Oracle (Task018).
- `pgsql-parser` chạy trong trình duyệt thật. RAM và thời gian của PGlite ở 10k, 100k, 500k trên trình duyệt.
- Xin được máy ARM của Oracle ở region gần Việt Nam.
- Điều khoản của Render có cấm ping giữ thức không. Trang gói free không nhắc đến.
- Giới hạn kết nối của Neon gói free, thời gian giữ dữ liệu của Gemini gói free, chính sách dữ liệu riêng cho model `:free` của OpenRouter.
- agent-browser chạy thật trên Windows của dự án.

## Cần thử khi dựng

- Cookie và stream qua `rewrites` trên Vercel và Render thật.
- PGlite trong Next.js: cần thử việc tải file WASM trên Vercel, Task010 và STR007 kiểm.
- agent-browser trên Windows: README chưa ghi rõ có hỗ trợ.

## Mốc kiểm tra

Cuối ngày 3 phải có MySQL chạy an toàn trên Oracle và PGlite chạy trong trình duyệt thật. Chưa đạt thì cắt phạm vi ngay. Thứ tự dự kiến: animation join, Capacity Advisor, rồi rút 5 kịch bản PostgreSQL còn 3. Chủ dự án quyết định lần cuối tại thời điểm đó. V1 không có parser `.ibd`.
