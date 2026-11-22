# ĐỀ XUẤT STORY: Team Multiplayer Collaboration (SP024 / SP025 / SP026)

> Trạng thái: **CHỜ CHỦ DỰ ÁN DUYỆT**. Chưa task nào được cấp số, chưa dòng code nào được viết.
> Nguồn: `_bmad-output/Y_TUONG_TEAM_MULTIPLAYER_COLLABORATION.md` (bản 2.5), phản biện của party mode ngày 2026-11-22.
> Nguyên tắc: chỉ giữ thứ đứng được trước `CLAUDE.md` — ngân sách 0 đồng, nhãn kết luận, Core Rule 7, và "không đoán khi chưa mô phỏng được".

---

## 1. Kết luận phản biện: 5 chỗ văn kiện tự mâu thuẫn

| # | Văn kiện nói | Đối chiếu với dự án | Hệ quả |
|---|---|---|---|
| **M1** | Viewer "0 MB WASM, chỉ kéo dữ liệu qua Edge CDN", "Free Unlimited Viewers" | Snapshot của một phòng là **trạng thái thay đổi liên tục**. CDN chỉ rẻ khi nội dung bất biến; phòng live đổi theo từng lần bấm Run thì tỉ lệ cache hit gần 0, mỗi viewer là một request thật. Thêm nữa Cloudflare là **nhà cung cấp thứ 4** (Vercel + Render + Neon + Upstash đã đủ), trong khi Vercel đã có edge cache. | Xóa luồng "CDN", thay bằng publish qua Gin + polling/SSE trong khung giờ Render thức. |
| **M2** | Mục 3.3: "Broadcast Schema Dump sẽ sập Web Worker máy nhận" | Mục 5.5 lại đề xuất **Fork to Local Sandbox**: nhân bản schema + dữ liệu sang worker của người nhận. Cùng một thao tác, chương trước gọi là tử huyệt, chương sau gọi là giải pháp. | Fork phải có trần byte và dùng lại codec SP022, hoặc bỏ. |
| **M3** | Mục 4: 5 hiểm họa concurrency khi 2 Editor dùng chung một engine | Đó là vấn đề **do chính thiết kế tạo ra**. Nếu chỉ một người được chạy engine và người kia là viewer, cả 5 hiểm họa biến mất — không cần lease token, không cần `idle_in_transaction_session_timeout`. | Bỏ "shared engine". Một writer, N viewer. Đây là thay đổi kiến trúc lớn nhất. |
| **M4** | Snapshot JSON có `sql` và `result_sample`, gửi qua mạng cho viewer | Core Rule 7: **không ghi log SQL của người dùng**. SP022 đã chốt ngược lại: snapshot nằm trong fragment `#`, đo thật ở Task148 là **0 request mang payload**. Multiplayer nghĩa là SQL rời khỏi trình duyệt và đi qua Gin/Neon. | Phải có quyết định mới của chủ dự án. Không được tự đổi. |
| **M5** | "ĐÃ CHỐT PHƯƠNG ÁN KIẾN TRÚC", sẵn sàng lập Epic | Cả văn kiện **không có một số đo nào**: không byte, không ms, không RAM, không giá. `CLAUDE.md` yêu cầu mọi kết luận phải có nhãn và số thật. | Đổi trạng thái thành đề xuất; mở bằng một story đo trước khi cam kết. |

### Ba câu hỏi chưa ai trả lời trong văn kiện

1. **Ai trả tiền cho máy chạy engine?** PGlite đo thật: đỉnh **1,1 GB RAM** lúc khởi tạo. Render free không đủ. Vậy engine chỉ có thể ở trình duyệt của **một** người — người đó là "host". Nếu host đóng tab thì phòng chết. Văn kiện không nói gì về chuyện này.
2. **Viewer được gì hơn một cái link?** SP022 đã có link snapshot miễn phí, không lộ dữ liệu, đã đo 0 byte ra mạng. "Live" hơn ở đúng một điểm: thấy thay đổi ngay khi host bấm Run. Đó có đáng một Epic không?
3. **Hai người sửa cùng một file `.sql` để làm gì?** Nếu engine chỉ chạy trên máy một người, người thứ hai sửa chữ nhưng không chạy được thì họ đang làm gì?

---

## 2. Phạm vi đề xuất: cắt còn 3 tầng, mỗi tầng có cổng

### Tầng 0 — Quyết định & đo (bắt buộc làm trước, kể cả khi sau đó dừng)

| Story | Hành vi khi xong | GD | Nhãn | Điều kiện vào |
|---|---|---|---|---|
| **STR108** Đo & quyết định | Có số thật: byte/lần publish, số request/viewer/phút, thời gian Render free thức thêm, chi phí; so sánh thẳng với link SP022. Chủ dự án đọc xong quyết go/no-go cho tầng 1. Kèm bản ghi quyết định về Core Rule 7 (SQL rời máy). | Không | Thật | Không |

### Tầng 1 — Live Presentation: 1 host phát, N viewer xem (chỉ sau khi STR108 = go)

| Story | Hành vi khi xong | GD | Nhãn | Điều kiện vào |
|---|---|---|---|---|
| **STR109** Phòng & quyền | Tạo phòng, mời bằng token có hạn, thu hồi được, phân vai `host` / `viewer`; RLS ở Neon như SP023, không tin code Go | Có | Thật | STR108 go; chủ dự án chốt M4 |
| **STR110** Host phát snapshot | Bấm "Phát trực tiếp" là viewer thấy đúng tab, đúng plan, đúng kết quả mẫu trong ≤ 2 s; đóng tab là phòng báo host offline, không treo viewer | Có | Thật | STR109 |
| **STR111** Viewer siêu nhẹ | `/r/<id>` mở trên điện thoại không tải WASM, hiện plan/B-Tree/SQL kèm đúng nhãn và nguồn ("host đã chạy"), không có nút Chạy | Có | Thật | STR110 |
| **STR112** Hiện diện & ghim chú thích | Thấy ai đang xem, ghim bình luận vào một node plan, emoji — tất cả **không đụng engine** | Có | Thật | STR110 |

### Tầng 2 — Nhiều người sửa (chủ dự án yêu cầu, nhưng phải chọn hướng A/B ở mục 6.1 trước)

| Story | Hành vi khi xong | GD | Nhãn | Điều kiện vào |
|---|---|---|---|---|
| **STR113** Quyền khi chia sẻ | Chủ phòng cấp `viewer` / `editor` cho từng người; thu hồi được; quyền kiểm ở Gin + RLS, không tin client | Có | Thật | Tầng 1 chạy thật; chủ dự án chốt A hay B |
| **STR114** Nhiều người sửa chữ, một người chạy | Ai có quyền `editor` thì sửa được `.sql` (Yjs trên CodeMirror 6); quyền bấm Run do một người giữ và nhượng được; người khác thấy kết quả người đó phát | Có | Thật | STR113; hướng **A** |
| **STR114b** Nhiều người chạy thật | *(chỉ mở nếu chủ dự án chọn B)* Phải có thiết kế đồng bộ state DB hoặc dời engine lên server trả tiền. Chưa có số, chưa băm được | Có | — | STR113; hướng **B**; cần một cổng đo thứ hai |
| **STR115** Fork ra sandbox riêng | Nhân bản phòng sang máy mình để phá thoải mái, có trần byte và cảnh báo; dùng lại codec SP022 | Có | Thật | STR114 |

### Tầng 3 — Deadlock Arena: làm lại thành kịch bản, không phải engine thật

| Story | Hành vi khi xong | GD | Nhãn | Điều kiện vào |
|---|---|---|---|---|
| **STR116** Đấu trường tranh chấp | Nhiều người xem cùng một kịch bản deadlock dựng bằng `conflict-sim` có sẵn (5 kịch bản PostgreSQL đã đối chiếu Postgres 18 thật), bấm bước để xem ai giữ khóa nào; **không** cho hai người chạy engine thật cùng lúc | Có | Mô phỏng | Tầng 1 xong |

---

## 3. Cái gì bị cắt hẳn và vì sao

| Bị cắt | Lý do |
|---|---|
| WebRTC P2P | Văn kiện đã tự bẻ. Giữ nguyên kết luận. |
| Cloudflare CDN / KV / Durable Objects | Nhà cung cấp thứ 4, cache hit ~0 cho trạng thái live, và gói free không chắc có Durable Objects — **phải kiểm giá trước khi cam kết**, hiện chưa có số. |
| "The Floor Token" 3 s | Giải pháp cho vấn đề do thiết kế tạo ra. Lease 3 s trên mạng di động sẽ hết hạn giữa lúc đang gõ. |
| Hai Editor chạy chung một PGlite | PGlite một phiên; mọi cách chia sẻ đều dẫn về 5 hiểm họa mục 4. |
| "Free Unlimited Viewers" như một lời hứa | Viewer vẫn tốn request. Miễn phí **tiền seat**, không miễn phí hạ tầng. |
| B2B SaaS $15–30/seat trong V1 | Chưa có người dùng thật, chưa có số. Để sau khi tầng 1 chứng minh có người dùng. |

---

## 4. Tài sản đã có, dùng lại chứ không viết mới

| Cần | Đã có | Ở đâu |
|---|---|---|
| Mã hóa snapshot có version + trần byte | `SnapshotV1`, `encodeSnapshot`/`decodeSnapshot`, `MAX_SNAPSHOT_TABS` | `web/src/modules/share/codec.ts`, `snapshot.ts` (SP022) |
| Trang chỉ đọc, chặn referrer | `/share` + `Referrer-Policy: no-referrer` | `web/src/modules/share/`, `web/next.config.ts` |
| Plan rút gọn siêu nhỏ | "40-Token AST Plan Minifier" | Task119, SP018 |
| Kịch bản tranh chấp có nhãn Mô phỏng, đối chiếu thật | `conflict-sim` 5 kịch bản, 13 biến thể khớp Postgres 18 | Task050/051 |
| RLS cấp project, role không phải owner, test cross-tenant | Migration 005 + test | SP023 |
| Đồ thị chờ khóa | Cytoscape.js, tải riêng theo màn hình | `CLAUDE.md` |

---

## 5. Rủi ro phải ghi trước khi duyệt

1. **Core Rule 7 (M4)** — chưa có quyết định. Đây là cổng chặn STR109, không phải việc kỹ thuật.
2. **Render free 750 h/tháng** dùng chung cả workspace; keep-awake hiện đã ăn ~510–527 h. Phòng live ngoài khung 7:00–24:00 sẽ ăn vào phần còn lại. Con số thật phải đo ở STR108.
3. **PGlite 1,1 GB RAM đỉnh** — không có chỗ đặt engine trên server miễn phí. Toàn bộ tầng 1–2 phụ thuộc vào "engine nằm ở máy host".
4. **Thư viện mới** (`yjs`, `y-codemirror.next`) chưa có trong `web/package.json`; theo `QUY_TRINH.md` phiên chính phải thêm, không để agent tự thêm.
5. **Thứ tự thi công** — SP013 (Phát hành) chưa đóng và `SP999` còn tồn. Mở Epic mới trước khi đóng SP013 là quyết định của chủ dự án, không phải của agent.

---

## 6. Chủ dự án đã trả lời ngày 2026-11-22

| # | Câu hỏi | Trả lời | Hệ quả |
|---|---|---|---|
| 1 | SQL rời khỏi trình duyệt (M4, Core Rule 7) | **Ghi nợ — chưa quyết.** | Core Rule 7 giữ nguyên. Đây là cổng chặn mọi story có gửi SQL qua mạng. Tầng 0 vẫn đo được, nhưng phải tách riêng số "byte là SQL người dùng" để sau này quyết. |
| 2 | Đo trước hay xây thẳng | **Đo trước, làm ngay.** | Epic `SP024` mở, Task159 là cổng đo. |
| 3 | Một writer + N viewer có đủ không | **Không.** Cấp quyền khi chia sẻ: ai có quyền sửa thì sửa, ai không thì chỉ xem. Nhiều người sửa và nhiều người xem cùng lúc. | Đây là thay đổi phạm vi lớn: Tầng 2 không còn là "tuỳ chọn mở sau", nó là **yêu cầu**. Nhưng "quyền trên tài liệu" khác "engine chạy được ở đâu" — PGlite vẫn chỉ một phiên. Xem mục 6.1. |
| 4 | Thứ tự với SP013/SP999 | **Song song.** | SP024 chạy cạnh SP013 và SP999. Phải chia file để không đụng nhau. |

### 6.1. Ranh giới chưa được giải từ câu trả lời số 3

"Nhiều người có quyền sửa" là chuyện **quyền trên tài liệu**. Nó chưa trả lời **engine chạy ở đâu**:

- PGlite là WASM một phiên trong một Web Worker trên **một** máy. Hai người bấm Run cùng lúc trên hai máy khác nhau nghĩa là hai engine khác nhau, hai thực tại dữ liệu khác nhau — đúng cái "State Drift" mà văn kiện gốc tự gọi là tử huyệt ở mục 3.2.
- Vì vậy câu 3 mở ra **hai** hướng, và chủ dự án phải chọn một trước khi Tầng 2 thành story:

| Hướng | Nghĩa là | Cái giá |
|---|---|---|
| **A. Nhiều người sửa chữ, một người chạy** | Ai có quyền thì sửa được `.sql`; chỉ người giữ "quyền chạy" được bấm Run, người khác thấy kết quả do người đó phát. | Cần cơ chế nhượng quyền chạy. Không cần server chạy engine. Đây là hướng rẻ và đứng được với hạ tầng hiện tại. |
| **B. Nhiều người chạy thật** | Ai có quyền thì chạy engine của máy mình, trên dữ liệu của phòng. | Phải đồng bộ state DB giữa các máy, hoặc dời engine lên server trả tiền. PGlite đỉnh 1,1 GB RAM nên Render free không đỡ được. Đây là hướng đắt và chưa có số. |

Chưa chọn A hay B thì Tầng 2 chưa băm task được. Tầng 0 (Task159) không bị chặn bởi câu này.
