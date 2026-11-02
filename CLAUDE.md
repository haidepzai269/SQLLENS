# SQLLens: bộ nhớ dự án

Đọc file này trước khi làm bất kỳ việc gì trong dự án. Khi một quyết định thay đổi, cập nhật file này ngay trong cùng lượt làm việc.

- **Tài liệu gốc:** [Google Doc](https://docs.google.com/document/d/1Rg-zKY2ysY4Z4PChw2sZpVk4ImadZ5U95_0gtz-eXjo/edit)
- **Khi Google Doc và file này khác nhau:** file này đúng hơn, cho đến khi Google Doc được cập nhật.
- **Giai đoạn hiện tại:** đã chốt 13 Epic và 61 Story (`_bmad-output/BAN_DO_STORY.md`). Đang làm SP001, tiến độ ở `_bmad-output/SP001/README.md`.
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
| Sơ đồ bảng | React Flow, thẻ bảng dùng component shadcn/ui hoặc React, xếp vị trí bằng `@dagrejs/dagre` |
| Đồ thị | Cytoscape.js cho cây plan và đồ thị chờ khóa, tải riêng theo màn hình |
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

## Chưa kiểm chứng

- RAM và thời gian khởi động của mỗi container MySQL, từ đó suy ra số phiên chạy cùng lúc trên Oracle.
- Bắt lock wait trên MySQL thật.
- PGlite và `pgsql-parser` chạy trong trình duyệt thật.
- Xin được máy ARM của Oracle, và ngưỡng thu hồi máy nhàn rỗi hiện tại.
- Điều khoản của Render về việc ping giữ thức.
- Hạn mức CU-giờ của gói free Neon: các nguồn ghi 50 hoặc 100.
- Điều khoản về việc các gói LLM free dùng dữ liệu gửi lên để huấn luyện model. Phải rõ trước khi gửi SQL của người dùng cho AI.

## Cần thử khi dựng

- Cookie đăng nhập: gọi API qua `rewrites` của Next.js để cùng domain, cần thử xem stream có chạy được không.
- PGlite trong Next.js: chỉ nạp phía client, cần thử việc tải file WASM trên Vercel.
- agent-browser trên Windows: README chưa ghi rõ có hỗ trợ.
- Subagent có gọi được subagent khác không: thử ở task đầu tiên.

## Mốc kiểm tra

Cuối ngày 3 phải có MySQL chạy an toàn trên Oracle và PGlite chạy trong trình duyệt thật. Chưa đạt thì cắt phạm vi ngay. Thứ tự dự kiến: animation join, Capacity Advisor, rồi rút 5 kịch bản PostgreSQL còn 3. Chủ dự án quyết định lần cuối tại thời điểm đó. V1 không có parser `.ibd`.
