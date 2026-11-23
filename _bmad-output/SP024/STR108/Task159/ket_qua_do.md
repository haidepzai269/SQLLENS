# Task159 — Kết quả đo cổng Tầng 0 (Live Rooms)

Máy: Windows 11, i5-12450H, 15,7 GB RAM. Ngày đo: 2026-11-23.
Thư mục spike: `spikes/live-rooms/`. Không sửa `web/src/`, `api/internal/`, `web/messages/`, `web/package.json`, `api/go.mod`.
Mọi phép đo chạy trên bản `next build` + `next start` (Next 16.4.4), Chromium thật (Playwright 1.64.1). Không dùng `next dev`.
Không gọi Neon, Upstash, Render thật, Cloudflare. Mọi thứ trên localhost. Gin cổng 18160, Next cổng 3159.

Nhãn dùng đúng ba loại của dự án: **Thật** (vừa chạy ra), **Mô phỏng** (engine dự án tính, đã đối chiếu DB thật), **Ước lượng** (ngoại suy). Không làm tròn theo hướng có lợi.

---

## AC1 — Byte mỗi lần phát

Cùng một dữ liệu, hai cách đóng gói, cùng đi qua `encodeSnapshot` của SP022 (canonical JSON → gzip → base64url).
Dự án mẫu: 3 tab (`01_schema.sql` 802 B, `02_seed.sql` 515 B, `03_report.sql` 2.275 B), một `EXPLAIN` plan thật, kết quả mẫu 100 dòng × 5 cột. Dữ liệu do PGlite 0.5.14 thật sinh ra trên 100.000 dòng.

| # | Số đo | Lần 1 | Lần 2 | Lần 3 | Trung vị | Nhãn |
|---|---|---:|---:|---:|---:|---|
| 1 | (a) payload phòng live = 3 tab + plan + 100 dòng | 3.909 | 3.901 | 3.906 | **3.906 B** | Thật |
| 2 | (b) cùng dữ liệu đó ở dạng link `/share` = chỉ 3 tab | 1.860 | 1.860 | 1.860 | **1.860 B** | Thật |
| 3 | tỉ lệ (a)/(b) | 2,1016 | 2,0973 | 2,1000 | **2,10×** | tính từ (1)(2) |
| 4 | (a) ở dạng JSON chưa nén | 11.774 | 11.774 | 11.771 | **11.774 B** | Thật |
| 5 | (a) sau gzip, trước base64url | 2.930 | 2.924 | 2.928 | **2.928 B** | Thật |
| 6 | (b) ở dạng JSON chưa nén | 3.905 | 3.905 | 3.905 | **3.905 B** | Thật |
| 7 | byte SQL thuần (UTF-8, 3 tab + tên tab) | 3.629 | 3.629 | 3.629 | **3.629 B** | Thật |
| 8 | byte **quy được cho SQL** trong payload (a) | 1.700 | 1.701 | 1.700 | **1.700 B** | Thật |
| 9 | byte **quy được cho SQL** trong payload (b) | 1.652 | 1.652 | 1.652 | **1.652 B** | Thật |
| 10 | (a) chiếm trần cứng 32.768 B | 11,93 % | 11,90 % | 11,92 % | **11,92 %** | tính từ (1) |
| 11 | (a) chiếm ngưỡng cảnh báo 8.192 B | 47,72 % | 47,62 % | 47,68 % | **47,68 %** | tính từ (1) |
| 12 | thời gian từ mở trang tới có số | 2.485 | 2.365 | 2.387 | **2.387 ms** | Thật |

Cách đo dòng 8/9 (không phải suy đoán): mã hóa lại **đúng payload đó** nhưng thay mọi `sql` bằng chuỗi rỗng, rồi lấy hiệu độ dài. Hiệu đó là số byte nén thật sự do SQL chiếm.

**Đọc dòng 1 và 2 cho đúng.** Hai số không cùng một thứ. (b) chỉ là 3 tab. (a) là 3 tab **cộng** plan **cộng** 100 dòng kết quả — đúng thứ mà văn kiện gốc hứa cho viewer. So (a) với (b) để nói "live đắt gấp 2,1 lần" là so sai: (a) chở nhiều thứ hơn. So đúng là: **cùng 3 tab thì hai cách đóng gói ra byte như nhau**, vì cùng codec. Cái làm payload live nặng lên chính là plan và kết quả, tức cái giá của việc viewer không chạy engine.

Payload (a) 3.906 B nằm **dưới** ngưỡng cảnh báo 8.192 B và chỉ bằng 11,92 % trần cứng. Trần 32 KB **không** phải nút cổ chai của một lần phát.

### Ca biên phía phát (AC1 mở rộng)

`encodeSnapshot` chặn trong trình duyệt. Bảng dưới là chuyện xảy ra khi phát:

| Ca | Kết quả | Nhãn |
|---|---|---|
| kết quả 500 dòng | 5.736 B — qua | Thật |
| kết quả 2.000 dòng | 11.700 B — qua | Thật |
| kết quả 5.000 dòng | 23.056 B — qua (70,4 % trần cứng) | Thật |
| kết quả 10.000 dòng | **`SNAPSHOT_TOO_LARGE`** — "Kích thước snapshot (41490 bytes) vượt quá giới hạn cứng 32768 bytes" | Thật |
| kết quả 20.000 dòng | **`SNAPSHOT_TOO_LARGE`** — 78.345 B | Thật |
| 1 tab SQL 20.000 ký tự | 1.990 B — qua | Thật |
| 1 tab SQL 40.000 ký tự | 2.062 B — qua | Thật |
| 1 tab SQL 80.000 ký tự | 2.166 B — qua | Thật |
| 101 tab | **`SNAPSHOT_TOO_MANY_TABS`** — "Snapshot có quá 100 tab nên không tạo được liên kết" | Thật |
| 100 tab (đúng trần) | 522 B — qua | Thật |

Hai kết luận từ bảng này:

1. **Nút cổ chai là số dòng kết quả, không phải SQL.** SQL dài 80.000 ký tự vẫn chỉ 2.166 B vì gzip nén câu lặp rất tốt. Nhưng 10.000 dòng kết quả đã vượt trần. Ngưỡng rơi vào khoảng giữa 5.000 và 10.000 dòng.
2. **Chặn ở phía phát là chặn mềm.** `encodeSnapshot` ném lỗi trong trình duyệt, tức chỉ cần một client không dùng codec là bỏ qua được. Đo thẳng vào Gin (`tools/edge-publish.mjs`): 32 KB → 200, 32 KB+1 B → 200, 1 MB → 200, 3 MB → 200, chỉ 5 MB mới bị 413 `payload_too_large_or_bad_json` (trần `maxPayloadBytes = 4 MB`). Gửi thẳng JSON 101 tab cũng 200. **Gin không biết gì về trần 32 KB và trần 100 tab.** Nếu làm thật, phải kiểm lại ở server, không dựa vào codec phía client.

---

## AC2 — Byte mỗi viewer mỗi phút, tách riêng dòng SQL

Viewer là một tab Chromium thật, mọi request đi qua `rewrites` của Next sang Gin. Byte đếm bằng CDP `Network.dataReceived` (`encodedDataLength`, byte thân thật qua dây) cộng độ dài khối header phản hồi dựng lại từ `Network.responseReceived`. Không dùng `content-length` vì SSE không có header đó.

Host phát payload thật của AC1 (3.906 B) mỗi 10 giây. Cửa sổ danh nghĩa 60 giây, thực tế 63,1 giây (tính cả 3 giây chờ kết nối ổn định), 3 lần. Mọi số B/phút dưới đây đã chia cho **thời gian thật** của từng lần, không chia cho 60.

| Chế độ | Request | Byte thân | Byte header | Tổng | **B/viewer/phút** (thân+header) | **trong đó là SQL** | Nhãn |
|---|---:|---:|---:|---:|---:|---:|---|
| SSE, phòng có phát (lần 1) | 1 | 20.186 | 203 | 20.389 | 19.364,6 | 8.072,9 | Thật |
| SSE, phòng có phát (lần 2) | 1 | 20.231 | 203 | 20.434 | 19.429,5 | 8.082,2 | Thật |
| SSE, phòng có phát (lần 3) | 1 | 20.192 | 203 | 20.395 | 19.384,1 | 8.078,7 | Thật |
| **SSE, phòng có phát — trung vị** | 1 | 20.192 | 203 | 20.395 | **19.384,1** | **8.078,7** | Thật |
| SSE, phòng **đứng yên** (lần 1–3, giống nhau) | 1 | 162 | 203 | 365 | **347,3** | **0** | Thật |
| Polling 2 s, có phát (lần 1) | 32 | 23.857 | 4.454 | 28.311 | 26.906,9 | 9.694,1 | Thật |
| Polling 2 s, có phát (lần 2) | 32 | 23.852 | 4.464 | 28.316 | 26.907,0 | 9.692,4 | Thật |
| Polling 2 s, có phát (lần 3) | 32 | 23.863 | 4.486 | 28.349 | 26.952,8 | 9.697,7 | Thật |
| **Polling 2 s, có phát — trung vị** | 32 | 23.857 | 4.464 | 28.316 | **26.907,0** | **9.694,1** | Thật |

Polling: 32 request/phút, trong đó 6 trả 200 và 26 trả 304 (ETag `"vN"` hoạt động). SSE: **1 request cho cả phút** — một kết nối duy nhất giữ suốt cửa sổ.

**Dòng "trung vị" lấy trung vị riêng từng cột**, không phải một lần chạy cụ thể, nên các cột không cộng lại đúng bằng cột Tổng của chính dòng đó (polling: 23.857 + 4.464 = 28.321, trong khi trung vị cột Tổng là 28.316). Muốn một dòng tự cộng khớp thì đọc từng lần chạy ở trên.

**Một lỗi đo đã tìm ra và sửa, số cũ bị thay.** Lần đo đầu cho SSE **2 request** và polling **33**. Nguyên nhân: `app/viewer/page.tsx` khởi tạo `room = "r1"` rồi mới đọc `?room=` trong `useEffect`; ở lần render đầu trang mở một `EventSource` rác tới `/api/room/r1/events` trước khi nối phòng thật. Request rác đó mang **0 byte** nên không làm sai byte, nhưng làm sai **số request**. Đã sửa bằng cờ `ready` chặn hiệu ứng nối mạng ở lần render đầu, rồi **đo lại cả ba chế độ**. Bảng trên là số sau khi sửa. Con số request cũ (2 và 33) đã bị thay, không còn dùng.

**Dòng SQL tách riêng — và một lỗi tính đã sửa.** Cách tính đúng không dùng tỉ lệ phần trăm: AC1 đo trực tiếp **1.700 B là SQL của người dùng trong một payload** (phép trừ: payload có SQL so với payload thay SQL bằng chuỗi rỗng). Mỗi `snapshot` chở đúng một payload, nên:

```
byte SQL mỗi phút = số snapshot × 1.700 / cửa sổ × 60.000
```

**Không được nhân tỉ lệ SQL với toàn bộ byte thân**, vì thân còn chứa `hello` (một lần khi nối) và `ping` (heartbeat 15 giây) — hai loại này **không chở SQL**, và khung `event:…\ndata:…\n\n` cũng không. Nhân lên toàn bộ thổi số lên **1,2–3,5 %**. Số đã sửa:

- SSE, phòng có phát: **8.078,7 B/phút/viewer là SQL của người dùng** (cách tính cũ sai: 8.346,1)
- Polling 2 s: **9.694,1 B/phút/viewer là SQL của người dùng** (cách tính cũ sai: 9.860,7)
- SSE, phòng đứng yên: **0 B/phút/viewer** — phòng đứng yên **không gửi `snapshot` nào**, nên **không có byte SQL nào**. Con số 67,0 ghi ở bản trước là sai: nó nhân tỉ lệ SQL với 162 B thân, mà 162 B đó là `hello` + `ping`, không chứa SQL.

**Ba cái bẫy tính toán đã sửa, ghi lại để người sau không lặp:**

1. Nhân tỉ lệ SQL với **tổng** (thân + header) thay vì **thân** sẽ thổi số SQL lên: polling thành 11.706 thay vì 9.694,1 — sai 20,8 %. Header HTTP không chở SQL.
2. Nhân tỉ lệ SQL với **toàn bộ thân**, kể cả `hello`/`ping`/khung SSE, thổi số lên **1,2–3,5 %**. Chỉ byte của `snapshot` mới chở SQL.
3. Phòng đứng yên **không có SQL nào**. Đừng suy ra "byte nền × tỉ lệ SQL" — không có `snapshot` thì không có SQL.
4. Tỉ lệ SQL lấy từ **một lần AC1** nhưng nhân với byte của **một lần AC2** là trộn hai nguồn: payload dao động vài byte giữa các lần (3.909 / 3.901 / 3.906) vì `EXPLAIN (ANALYZE)` nhúng số đo thời gian thật vào plan. Dùng thẳng 1.700 B mỗi payload thì không có chỗ nào trộn.

Phép tính lại nằm ở `tools/sql-line.mjs`, đọc thẳng JSON thô và in ra cả số đúng lẫn số sai để đối chiếu.

Con số này là đầu vào cho quyết định Core Rule 7, và nó nói: SQL không chỉ rời khỏi trình duyệt một lần, nó **nằm lại trên server** và **được gửi lại cho từng viewer, mỗi lần host phát**. Không có đường nào để làm live room mà không gửi SQL, vì viewer phải thấy đúng câu SQL đang được thảo luận. Task159 **không** sửa Core Rule 7; đây chỉ là số.

**Phát hiện quan trọng: SSE không rẻ hơn polling.** Ở AC2, SSE ra 19.384 còn polling 26.907 B/phút — nhưng **khoảng chênh đó không phải chi phí giao thức**, nó là tạo tác của phép đo. Tách ra (lần 2, cửa sổ 63.142 ms), dùng kích thước khung đo thật bằng `tools/frame-size.mjs` (`snapshot` 3.991 B, polling 200 là 3.969 B, `hello` 26 B, `ping` 37 B):

| Thành phần chênh | B/phút | Nguồn |
|---|---:|---|
| Header HTTP | **+4.048,8** | đo được: SSE trả header **một lần** (193 B/phút); polling trả **32 lần** (4.241,9 B/phút) |
| Một `snapshot` thừa | **+3.771,5** | đo được: polling nhận **6** `snapshot`; SSE chỉ **5**, vì cửa sổ SSE đóng trước nhịp phát thứ 6 |
| Bớt `hello`+`ping` của SSE | **−165,4** | đo được: SSE gửi `hello` 26 B + ~4 `ping` 37 B; polling không có |
| Chưa giải thích được | **−177,4** | phần dư; nghi do số `ping` thực tế khác 4, chưa tách được |
| **Tổng** | **+7.477,5** | khớp đúng số đo thật `26.907,0 − 19.429,5` |

Kiểm chứng mô hình: `5 × 3.991 + 26 + 4 × 37 = 20.129` so với thân đo thật `20.231` (dư 102 B); `6 × 3.969 = 23.814` so với `23.852` (dư 38 B). Mô hình bám sát, phần dư nhỏ và đã ghi lại chứ không giấu.

**Không có nguyên nhân nào trong bảng trên là "SSE tiết kiệm băng thông".** Trên cùng một cửa sổ 10 phút và cùng nhịp phát (AC4), SSE 23.649,6 và polling 23.699,7 B/viewer/phút — **chênh 0,21 %**. Lý do: cả hai đều phải chở nguyên payload ~3.906 B mỗi lần phát, và đó là gần như toàn bộ chi phí thân. Nghĩa là **toàn bộ độ phức tạp của SSE không mua được gì về băng thông.** Nó chỉ mua độ trễ — và độ trễ đó đo được là 13 ms so với 2.000 ms, tức không đáng kể so với một lần phát mỗi 10 giây.

---

## AC3 — Plan và B-Tree có đi qua được mà không cần WASM không

Dữ liệu thật: index `orders_customer_id_idx` trên bảng 100.000 dòng, đọc bằng `pageinspect` thật (`bt_metap`, `bt_page_stats`, `bt_page_items`), qua đúng `readBTreeAdmin` của dự án.

### Byte (nhãn Thật)

| Số đo | Lần 1 | Lần 2 | Lần 3 | Trung vị | Nhãn |
|---|---:|---:|---:|---:|---|
| Plan đã chuẩn hóa (`normalizePostgres`) — JSON | 551 | 549 | 552 | **551 B** | Thật |
| Plan đã chuẩn hóa — gzip | 324 | 322 | 324 | **324 B** | Thật |
| Plan đã chuẩn hóa — payload `encodeSnapshot` | 434 | 432 | 434 | **434 B** | Thật |
| Plan JSON gốc của PostgreSQL — JSON | 2.255 | 2.251 | 2.252 | **2.252 B** | Thật |
| Plan JSON gốc — gzip | 612 | 606 | 609 | **609 B** | Thật |
| Số node trong plan | 3 | 3 | 3 | **3** | Thật |
| B-Tree `orders_customer_id_idx` — JSON | 18.775 | 18.775 | 18.775 | **18.775 B** | Thật |
| B-Tree `orders_customer_id_idx` — gzip | 5.941 | 5.941 | 5.941 | **5.941 B** | Thật |
| B-Tree `orders_customer_id_idx` — payload `encodeSnapshot` | 7.905 | 7.905 | 7.905 | **7.905 B** | Thật |
| B-Tree `orders_customer_id_idx` + đường đi — payload | 7.957 | 7.957 | 7.957 | **7.957 B** | Thật |
| B-Tree `orders_pkey` — payload | 2.653 | 2.653 | 2.653 | **2.653 B** | Thật |
| Số tầng / tổng số trang (`orders_customer_id_idx`) | 2 / 89 | 2 / 89 | 2 / 89 | **2 / 89** | Thật |
| Số trang đã đọc | 88 | 88 | 88 | **88** | Thật |
| Số khóa trong model | 2.087 | 2.087 | 2.087 | **2.087** | Thật |
| Kích thước index thật | 729.088 | 729.088 | 729.088 | **729.088 B** | Thật |
| Thời gian đọc cây | 57,8 | 59,2 | 50,1 | **57,8 ms** | Thật |
| Số tầng / tổng số trang (`orders_pkey`) | 2 / 276 | 2 / 276 | 2 / 276 | **2 / 276** | Thật |
| Số trang đã đọc (`orders_pkey`) | 3 | 3 | 3 | **3** | Thật |
| Kích thước index thật (`orders_pkey`) | 2.260.992 | 2.260.992 | 2.260.992 | **2.260.992 B** | Thật |

### Payload ĐẦY ĐỦ mà viewer cần (nhãn Thật)

Đây là số trả lời thẳng câu "0 MB WASM thì viewer cần bao nhiêu byte": snapshot 3 tab + plan + kết quả + model B-Tree của cả hai index.

| Số đo | Lần 1 | Lần 2 | Lần 3 | Trung vị | Nhãn |
|---|---:|---:|---:|---:|---|
| snapshot + plan + kết quả (không có B-Tree) | 3.506 | 3.506 | 3.506 | **3.506 B** | Thật |
| **+ model B-Tree 2 index** | 13.841 | 13.842 | 13.841 | **13.841 B** | Thật |
| + đường đi root→leaf | 13.892 | 13.894 | 13.892 | **13.892 B** | Thật |
| tỉ lệ so với bản không có B-Tree | 3,948 | 3,948 | 3,948 | **3,95×** | tính từ trên |
| chiếm trần cứng 32.768 B | 42,24 % | 42,24 % | 42,24 % | **42,24 %** | tính từ trên |
| chiếm ngưỡng cảnh báo 8.192 B | 168,96 % | 168,97 % | 168,96 % | **168,96 %** | tính từ trên |

**Văn kiện gốc hứa "Visual Snapshot JSON cho CDN (< 10KB)".** Đo được **13.841 B** cho một index 100k dòng cộng một index pkey. Con số hứa "10KB" có hai cách đọc, nên ghi cả hai: vượt **38,41 %** nếu 10 KB nghĩa 10.000 B, vượt **35,17 %** nếu nghĩa 10.240 B. Cách nào cũng vượt. Và đó mới là 100.000 dòng. Con số 13.841 B vẫn nằm dưới trần 32 KB, nhưng nó đã vượt ngưỡng cảnh báo 8 KB gần 1,7 lần, và bảng kết quả 10.000 dòng đã một mình vượt trần (AC1). Cây càng lớn thì model càng lớn: `orders_pkey` có 276 trang nhưng chỉ đọc 3, nên 2.653 B; đọc cả cây sẽ tốn hơn nhiều.

### Phần nào viewer xem được, phần nào không (nhãn Ước lượng)

Đây là suy luận từ cấu trúc dữ liệu và từ các số đo trên, không phải số đo trực tiếp.

**Viewer xem được mà không cần WASM** — vì đó chỉ là render dữ liệu đã nhận:
- Vẽ cây từ `BTreeModel.nodes`: 88 node, 2.087 khóa, đúng thứ tự khóa thật.
- Vẽ `hidden` dạng "+N trang": `orders_pkey` có 272 trang leaf bị ẩn, hiện thành "+272 node".
- Tô sáng đường đi root→leaf từ `BTreePath.pages` (2 trang cho `orders_customer_id_idx`).
- Hiện plan đã chuẩn hóa: 3 node, các số `actualRows`, `pagesRead`, `estimatedRows`.
- Hiện bảng kết quả 100 dòng.
- Chạy animation GSAP trên đúng dữ liệu đó (animation là hàm của một biến `p`, không cần engine).

**Chỉ engine tính được, viewer không tự có:**
- Trang nào chứa khóa nào, và khóa nào là ranh giới giữa hai trang. Đây là kết quả của việc đọc `bt_page_items` trên trang thật; không suy ra được từ danh sách khóa.
- Số tầng thật (2) và `totalPages` (89 / 276). Phải đo `bt_metap`.
- `indexBytes` (729.088 / 2.260.992 B). Phải hỏi `pg_class`/`bt_metap`.
- `actualRows`, `pagesRead`, `BUFFERS` của plan. Chỉ `EXPLAIN ANALYZE` mới có.
- Trạng thái "câu này có dùng index hay không". Chỉ planner trả lời.
- Bất cứ câu hỏi mới nào của viewer ("nếu tôi thêm index thì sao", "nếu dữ liệu 1 triệu dòng thì sao"). Đây là giới hạn thật: **viewer chỉ thấy đúng những gì host đã chạy**. Muốn thấy câu khác phải quay lại host.

**Kết luận AC3.** Câu "viewer 0 MB WASM vẫn xem Plan/B-Tree mượt" **đứng được về mặt kỹ thuật** — đo được 0 B WASM cho trang viewer (mục "Trọng lượng trang viewer" bên dưới), và model B-Tree 13.841 B là đủ để vẽ cây thật. Nhưng nó **không đứng được về mặt con số < 10KB**, và nó chỉ đúng cho một ảnh chụp: viewer mất khả năng tự trả lời bất kỳ câu hỏi nào mới. Đó không phải "mượt", đó là "xem lại". Với một công cụ mà giá trị cốt lõi là *sửa rồi chạy lại*, đây là mất mát lớn, không phải chi tiết nhỏ.

---

## AC4 — Fan-out: 30 viewer đồng thời trong 10 phút

Gin local (`:18160`) + `next start` local (`:3159`), 30 tab Chromium thật, mỗi tab một browser context riêng. Host phát payload thật mỗi 10 giây (60 lần trong 10 phút). 3 lần cho mỗi chế độ.

### SSE — 3 lần, mỗi lần 601 giây

| Số đo | Lần 1 | Lần 2 | Lần 3 | Trung vị | Nhãn |
|---|---:|---:|---:|---:|---|
| Thời gian cửa sổ | 601.149 ms | 601.125 ms | 601.069 ms | **601.125 ms** | Thật |
| Mở xong 30 viewer | 2.331 ms | 2.374 ms | 1.931 ms | **2.331 ms** | Thật |
| Request `publish` (host gọi) | 60 | 60 | 60 | **60** | Thật |
| Request `events` đếm được ở `/metrics` | **0** (xem ghi chú) | 0 | 0 | **0** | Thật |
| `sseOpen` (số stream đang mở) lúc đủ 30 viewer | 30 | 30 | 30 | **30** | Thật |
| Byte route `events` | 7.107.277 | 7.108.177 | 7.109.310 | **7.108.177 B** | Thật |
| Byte route `publish` | 1.251 | 1.281 | 1.320 | **1.281 B** | Thật |
| Tổng byte ra | 7.108.528 | 7.109.458 | 7.110.630 | **7.109.458 B** | Thật |
| **B/viewer/phút (chỉ byte của viewer)** | 23.645,6 | 23.649,6 | 23.655,6 | **23.649,6** | Thật |
| **trong đó là SQL** | 10.010,8 | 10.011,2 | 10.012,2 | **10.011,2** | Thật |
| Số sự kiện SSE đã đẩy — số **cộng dồn** đọc từ `/metrics` | 1.785 | 3.555 | 5.325 | — | Thật |
| Số sự kiện **mỗi lần chạy** = hiệu hai lần liền kề | không suy được (xem ghi chú) | 1.770 | 1.770 | **1.770** | tính từ trên |
| Goroutine lúc 30 viewer → lúc kết thúc | 63 → 63 | 63 → 63 | 63 → 63 | **63 → 63** | Thật |
| RAM Gin (RSS) 0 → 1 → 30 viewer | 11,2 → 11,2 → 12,4 MB | 14,9 → 14,9 → 15,1 MB | 15,2 → 15,2 → 15,2 MB | **14,9 → 14,9 → 15,1 MB** | Thật |
| Δ RAM Gin khi 0 → 30 viewer | +1,2 | +0,1 | 0,0 | **+0,1 MB** | tính từ trên |
| RAM Next (RSS) 0 → 1 → 30 viewer | 82,2 → 80,6 → 83,1 MB | 79,8 → 80,2 → 80,9 MB | 66,6 → 67,1 → 67,8 MB | **79,8 → 80,2 → 80,9 MB** | Thật |
| Δ RAM Next khi 0 → 30 viewer | +0,9 | +1,1 | +1,2 | **+1,1 MB** | tính từ trên |
| **Nhả kết nối sau khi đóng viewer** | 854 ms | 742 ms | 798 ms | **798 ms** | Thật |
| `sseOpen` sau khi đóng | 0 | 0 | 0 | **0** | Thật |
| Số sự kiện close ghi được | 30 | 30 | 30 | **30** | Thật |

**Vì sao dòng "Request `events`" bằng 0 mà vẫn có 30 viewer.** `count()` trong `server/main.go:146-157` chỉ cộng `ctr.req[route]++` **sau khi handler trả về**. Một handler SSE không trả về trong suốt cửa sổ đo, nên request của nó không bao giờ được đếm — đó là lý do `requests` chỉ có `{publish: 60}`. Số stream thật phải đọc bằng gauge `sseOpen` (30, cộng/trừ bằng `atomic` ngay khi mở/đóng, `main.go:261,267`), và byte của stream đọc được vì `countingWriter` cộng dần trong mỗi `Write`. **Không suy số request SSE từ `/metrics`.** Số 1 request/viewer/phút ở AC2 đo từ CDP phía trình duyệt, đó mới là số đúng.

### Polling 2 giây — 3 lần, mỗi lần 601 giây

| Số đo | Lần 1 | Lần 2 | Lần 3 | Trung vị | Nhãn |
|---|---:|---:|---:|---:|---|
| Thời gian cửa sổ | 601.024 ms | 600.972 ms | 600.876 ms | **600.972 ms** | Thật |
| Mở xong 30 viewer | 2.327 ms | 2.124 ms | 1.644 ms | **2.124 ms** | Thật |
| Request `poll` (viewer) | 9.037 | 9.038 | 9.043 | **9.038** | Thật |
| Request `publish` (host) | 60 | 60 | 60 | **60** | Thật |
| Trong đó `poll` trả 200 / 304 | 1.800 / 7.237 | 1.800 / 7.238 | 1.800 / 7.243 | **1.800 / 7.238** | Thật |
| Byte route `poll` | 7.120.530 | 7.121.430 | 7.122.600 | **7.121.430 B** | Thật |
| Byte route `publish` | 1.251 | 1.281 | 1.320 | **1.281 B** | Thật |
| Tổng byte ra | 7.121.781 | 7.122.711 | 7.123.920 | **7.122.711 B** | Thật |
| **B/viewer/phút (chỉ byte của viewer)** | 23.694,7 | 23.699,7 | 23.707,4 | **23.699,7** | Thật |
| **trong đó là SQL** | 10.182,6 | 10.183,5 | 10.185,1 | **10.183,5** | Thật |
| Goroutine lúc 30 viewer → lúc kết thúc | 19 → 19 | 19 → 19 | 19 → 19 | **19 → 19** | Thật |
| RAM Gin (RSS) 0 → 1 → 30 viewer | 42,0 → 42,0 → 41,3 MB | 43,3 → 43,3 → 43,3 MB | 43,6 → 43,6 → 43,7 MB | **43,3 → 43,3 → 43,3 MB** | Thật |
| Δ RAM Gin khi 0 → 30 viewer | −0,8 | 0,0 | 0,0 | **0,0 MB** | tính từ trên |
| RAM Next (RSS) 0 → 1 → 30 viewer | 129,9 → 126,8 → 128,1 MB | 129,4 → 129,7 → 130,5 MB | 128,6 → 129,0 → 128,8 MB | **129,4 → 129,0 → 128,8 MB** | Thật |
| Δ RAM Next khi 0 → 30 viewer | −1,8 | +1,0 | +0,2 | **+0,2 MB** | tính từ trên |
| Nhả kết nối sau khi đóng viewer | 683 ms | 352 ms | 803 ms | **683 ms** | Thật |

**Cách tính lại dòng B/viewer/phút.** Bản ghi thô của `ac4.mjs` chia **tổng** byte (gồm cả route `publish` do host gọi) cho 30 viewer. Route `publish` không phải lưu lượng của viewer, nên số thô cao hơn thực tế. Bảng trên chỉ dùng byte của viewer (`events` hoặc `poll`), tính lại bằng `tools/ac4-recompute.mjs`. Số thô là 23.653,8 (SSE) và 23.704,0 (polling); số đúng là 23.649,6 và 23.699,7. Chênh nhỏ nhưng đã sửa cho đúng nguồn.

**Hai trường trong JSON thô không được dùng:**

- `ac4_poll.json` vẫn mang trường `sse*` di sản (`sseTotal: 93`, `sseEvents: 5325`) do `ac4.mjs` ghi chung một khuôn cho cả hai chế độ. Chế độ polling **không mở stream** nên hai số đó vô nghĩa ở đây — **đừng đọc**.
- `ramEnd` (RAM đo **sau khi đóng** 30 tab) là rác: lần chạy 3 ra `gin` 42,0 MB và `next` 116,3 MB, cao hơn cả `ram30`, vì phép đo rơi đúng lúc trình duyệt đang dọn. Bảng RAM ở trên chỉ dùng `ram0 → ram1 → ram30`, **không dùng `ramEnd`**.

**Lỗi đếm sự kiện SSE, đã tìm ra và ghi lại.** `POST /metrics/reset` của spike xóa `req`, `bytes`, `status` và `closes` nhưng **không** xóa `sseTotal`/`sseEvents` (`server/main.go:337-347`). Vì vậy số `sseEvents` đọc được là **cộng dồn qua các lần chạy**: 1.785 rồi 3.555 rồi 5.325. Số sự kiện **mỗi lần** là hiệu hai lần liền kề: `3.555 − 1.785 = 1.770` và `5.325 − 3.555 = 1.770`. Hai hiệu khớp nhau nên con số 1.770 là đúng, nhưng **lần chạy 1 không suy được** vì không có mốc trước đó — ghi "chưa xác định", không đoán. Đây là lỗi của dụng cụ đo, không phải của server fan-out; nó không ảnh hưởng byte hay request (những bộ đếm đó có reset). Nếu chạy lại thì phải reset cả hai biến đó.

**Vì sao AC2 ra 19.384 còn AC4 ra 23.650 — nguyên nhân thật, đã kiểm bằng số.**

1. **AC2 nhận ít bản tin hơn trên mỗi phút.** AC2 có 3 giây chờ kết nối ổn định *trước* khi vòng phát bắt đầu, và cửa sổ đóng trước khi lần phát thứ 6 kịp tới. Kết quả: **5 `snapshot` trong 63,17 giây = 4,75 bản tin/phút**. AC4 phát đều 10 giây/lần suốt 601 giây: **59 `snapshot`/viewer = 5,89 bản tin/phút**. Tỉ lệ **1,24×**. Đây là nguyên nhân chính.

   **Một chênh lệch nhỏ phải nói rõ:** SSE ra **59 `snapshot`/viewer**, polling ra **60**. Số 59 là **suy ra**, không đo trực tiếp: bộ đếm `sseEvents` cộng dồn qua các lần chạy nên mỗi lần chỉ lấy được bằng hiệu hai lần liền kề, và **lần chạy 1 không có mốc trước** — `tools/sql-line.mjs` lấy hiệu của lần 2 cho cả lần 1, và đánh dấu bằng cờ `snapshotsInferred: true`. Polling đếm trực tiếp từ số phản hồi 200 nên chắc chắn là 60. Chênh 1 bản tin này làm dòng SQL của SSE thấp hơn khoảng 1,7 % so với nếu là 60 — nằm trong cùng bậc với các sai số khác và **không đổi kết luận**, nhưng đây là lý do SSE ra 10.011,2 còn polling ra 10.183,5.
2. **AC2 đếm thêm header HTTP** (203 B/phút cho SSE), AC4 đọc `/metrics` của Gin nên chỉ có byte thân. Đây là nguyên nhân phụ, nhỏ.

Kiểm chứng: `5 × 3.906 = 19.530` B thân cho 5 bản tin, cộng `656` B bản tin `hello` và `203` B header ra `20.389` B — khớp đúng số đo `20.389`. Vậy phép tách là đúng, không phải suy đoán.

Hệ quả phải nói rõ: **AC2 đo ở mật độ phát thấp hơn thực tế một chút, nên 19.384 là số thấp hơn** so với nhịp 10 giây đều. Con số dùng để quyết định là **AC4** (cửa sổ 10 phút, nhịp đúng, ổn định). AC2 dùng để tách dòng SQL và để so SSE với polling trên cùng một dụng cụ đo.

Một chi tiết nữa: `viewerEvents` của SSE đếm **cả** sự kiện `hello` (trang viewer tăng biến đếm trong handler `hello`), còn `sseEvents` phía server chỉ đếm `snapshot`. Nên "6 sự kiện" của SSE là **5 snapshot + 1 hello**, không phải 6 bản tin. Hai bộ đếm không cùng định nghĩa; đã đối chiếu để không cộng sai.

### RAM: 0 / 1 / 30 viewer

Trả lời thẳng câu hỏi của task: **30 viewer không làm RAM server khác biệt có ý nghĩa.**

- Gin: **+0,1 MB** (SSE) và **0,0 MB** (polling) khi đi từ 0 lên 30 viewer.
- Next: **+1,1 MB** (SSE) và **+0,2 MB** (polling).

Lưu ý trung thực: RAM nền giữa hai chế độ khác nhau (Gin ~14,9 MB lúc SSE so với ~43,3 MB lúc polling; Next ~79,8 MB so với ~129,4 MB) vì cùng một tiến trình phục vụ cả hai lượt đo và heap đã phình sau lượt trước. **Chỉ số Δ trong cùng một lượt mới có nghĩa**, không được đọc số tuyệt đối giữa hai bảng. Số tuyệt đối cũng không dùng để suy ra RAM Render (khác máy, khác Go runtime, khác Next build). Đơn vị ở đây là MB = 10⁶ byte, đúng như `ac4.mjs` in ra (`rssOf` trả byte, script chia 1e6).

Và phải nói thêm: **các Δ này nằm trong nhiễu đo.** Ba lần cho ra `+1,2 / +0,1 / 0,0` (Gin SSE) và `−0,8 / 0,0 / 0,0` (Gin polling) — có lần **giảm**. RSS của một tiến trình Go trượt theo GC và theo trang bộ nhớ đã cấp phát, nên chênh lệch dưới ~1 MB không phân biệt được với dao động nền. Kết luận đúng là: **không thấy RAM tăng theo số viewer ở mức 30**, chứ không phải "tốn thêm 0,1 MB". Đừng trích con số Δ như một định lượng chi phí.

RAM **không** phải nút cổ chai. Nút cổ chai là số giờ Render (AC5).

### Rò kết nối

- Đóng bình thường (gọi `__viewerStop()` rồi đóng context): `sseOpen` về 0 sau **798 ms** (SSE, `closesRecorded` = 30/30) và **683 ms** (polling), goroutine không tăng. **Polling không ghi sự kiện close** (`closesRecorded` = 0, `livedMs` = `[]`) vì chế độ polling không mở stream, nên con số 683 ms chỉ dựa trên gauge `sseOpen`, không có sự kiện close đối chiếu.
- **Giết đột ngột** (`taskkill /T /F` cả cây Chromium, không có FIN sạch) — 3 lần, `tools/edge.mjs kill`:

| Số đo | Lần 1 | Lần 2 | Lần 3 | Trung vị | Nhãn |
|---|---:|---:|---:|---:|---|
| `sseOpen` trước khi giết | 1 | 1 | 1 | **1** | Thật |
| **Nhả kết nối sau** | 211 ms | 209 ms | 225 ms | **211 ms** | Thật |
| `sseOpen` sau khi giết | 0 | 0 | 0 | **0** | Thật |
| Sự kiện close ghi được | 1 | 1 | 1 | **1** | Thật |

Server nhả kết nối trong **211 ms** khi client chết không báo trước. Không rò. Đây là hành vi đúng của `c.Request.Context().Done()`.

### SSE có sống qua `rewrites` của Next 16.4.4 không

**Có, nhưng lý do không phải `compress: false` như `CLAUDE.md` đang ghi.** Đây là chỗ tài liệu dự án cần sửa.

Phép đo tách hai biến: `compress` của Next (`NEXT_COMPRESS=1` hoặc không) và header `Cache-Control: no-transform` của server (tham số `?nt=0` bỏ nó đi). Mỗi tổ hợp 3 lần, đo thời điểm chunk đầu tiên và thời điểm sự kiện `snapshot` tới trình duyệt.

| Next `compress` | Server `no-transform` | TTFB | `content-encoding` | Sự kiện tới sau | Stream sống? | Nhãn |
|---|---|---:|---|---:|---|---|
| **false** | có | 15,6 ms | không có | **13 ms** | **có** | Thật |
| **false** | **không** | 15,5 ms | không có | **9 ms** | **có** | Thật |
| **true** | có | 15,1 ms | không có | **13 ms** | **có** | Thật |
| **true** | **không** | 39,3 ms | **gzip** | **không bao giờ** | **KHÔNG** | Thật |

Đối chứng rằng `NEXT_COMPRESS=1` thật sự bật nén (`tools/compress-check.mjs`): với `compress: true`, HTML có `content-encoding: gzip` và `transfer-encoding: chunked`; với `compress: false`, HTML có `content-length: 6242` và không nén. Vậy phép thử có hiệu lực, không phải "nén chưa từng chạy".

**Bằng chứng "gzip giết stream" nằm ở đâu — đọc đúng file.** Nó nằm ở `results/sse_flush_compress-true.json`, **nhánh `no-transform=0`**: 3/3 lần có `contentEncoding: "gzip"`, `cacheControl: "no-cache"` (mất `no-transform`), `snapshotArrivedMs: null`, `streamed: false`. **Đừng** lấy `results/sse_through_compress-true-big_300000.json` làm bằng chứng cho điều này: file đó ghi `streamed: true` vì nó chạy ở nhánh **còn** `no-transform`, tức đúng trường hợp stream sống — đọc nhầm file đó sẽ thấy mâu thuẫn không có thật.

**Đọc bảng này cho đúng:**

1. `compress: false` một mình **không** phải điều kiện. Với `compress: true` mà server gửi `no-transform`, SSE vẫn stream bình thường (13 ms). Next tôn trọng `no-transform` và bỏ nén.
2. Thứ thật sự quyết định là **header `Cache-Control: no-transform` của server**. Bỏ nó đi trong khi Next bật nén thì stream **chết hẳn**: `content-encoding: gzip`, không một sự kiện nào tới trong 20 giây, 3/3 lần. Đó là gom đệm.
3. Với `compress: false`, bỏ `no-transform` cũng không sao (9 ms) — vì không có gì để nén.

Nghĩa là có **hai** lớp bảo vệ độc lập, và mỗi lớp một mình đều đủ. `CLAUDE.md` ghi "phải đặt `compress: false`" là đúng nhưng thiếu: header `no-transform` ở phía Gin cũng là lớp bảo vệ thật, và nếu chỉ dựa vào `no-transform` thì không cần `compress: false`. Điều này có ý nghĩa thực tế: trên Vercel, nền tảng nén ở tầng ngoài và ta không đặt được `compress: false`, nhưng `no-transform` do Gin gửi vẫn đi qua. **Task014 và `CLAUDE.md` nên được sửa lại cho đúng cơ chế.** (Ghi ở mục Phát sinh, không tự sửa `CLAUDE.md`.)

Mã thật của dự án đã có header này: `api/internal/ai/ai.go:349` đặt `Cache-Control: no-cache, no-transform`. Tức lớp bảo vệ đúng đã có sẵn trong sản phẩm.

### Độ trễ trên mạng 3G chậm

Profile CDP: 400 kbps xuống, 400 kbps lên, latency 400 ms. Payload 3.881 B mỗi sự kiện. 5 mẫu × 3 lần.

| Số đo | Lần 1 | Lần 2 | Lần 3 | Trung vị | Nhãn |
|---|---|---:|---:|---:|---|
| Độ trễ từng sự kiện (ms) | 63, 79, 95, 63, 96 | 80, 79, 94, 61, 91 | 63, 79, 92, 63, 77 | — | Thật |
| **Trung vị độ trễ mỗi lần** | 79 ms | 80 ms | 77 ms | **79 ms** | Thật |

**Kiểm chứng phép đo có thật sự chậm** (`tools/throttle-control.mjs`, 3 lần): tải `initdb.wasm` 300.109 B, không hạn chế 19,9 ms, có hạn chế **15.221,7 ms** — chậm hơn **764,9×**. Vậy `emulateNetworkConditions` có tác dụng thật.

Và 79 ms khớp với tính toán: 3.881 B ÷ (400 kbps ÷ 8 = 51.200 B/s) = 75,8 ms. Độ trễ đo được đúng bằng thời gian truyền payload. **Không có đệm: sự kiện tới ngay khi truyền xong.** Đây là tin tốt cho SSE trên mạng chậm — nhưng cũng cho thấy chi phí: mỗi lần host phát, viewer trên 3G mất ~79 ms chỉ để nhận một bản tin, và nếu host phát nhanh hơn 79 ms một lần thì viewer sẽ tụt lại vĩnh viễn.

---

## AC5 — Chi phí giờ Render

Nhãn **Ước lượng**. Vì sao: task cấm gọi Render thật, và giờ instance chỉ hiện trong dashboard Render. Đây là phép tính từ lịch `keep-awake.yml` thật và trần 750 giờ, không phải số đo trên Render.

Đầu vào, đọc từ `.github/workflows/keep-awake.yml`:

| Đầu vào | Giá trị | Nguồn |
|---|---|---|
| `cron` | `*/10 0-16 * * *` | file thật, dòng 6 |
| Ping đầu tiên (UTC) | phút 0 | suy từ cron |
| Ping cuối cùng (UTC) | phút 1.010 (= 16:50 UTC) | suy từ cron |
| Render ngủ sau | 15 phút | gói free, ghi ở `CLAUDE.md` |
| Trần giờ | 750 h/tháng | gói free |
| Số ngày | 30 | giả định |

Công thức:

```
giờ_thức_mỗi_ngày   = (phút_ping_cuối − phút_ping_đầu + 15) / 60
                    = (1010 − 0 + 15) / 60 = 17,0833 h
giờ_nền_mỗi_tháng   = 17,0833 × 30      = 512,5 h
giờ_còn_lại         = 750 − 512,5       = 237,5 h
giờ_thêm_mở_ngoài   = ((1440 − 1025) / 60) × 30 = 207,5 h
giờ_thêm_mở_trong   = 0 h  (máy đã thức sẵn)
```

| Trường hợp | Giờ/tháng | % trần 750 h | Vượt trần? | Nhãn |
|---|---:|---:|---|---|
| Nền hiện tại (không có live room) | 512,5 | 68,33 % | không | Ước lượng |
| Phòng live mở **trong** khung 07:00–23:50 | 512,5 (**+0**) | 68,33 % | không | Ước lượng |
| Phòng live mở **ngoài** khung, một lần 30 phút | 513,25 (**+0,75**) | 68,43 % | không | Ước lượng |
| Phòng live mở **suốt đêm** (415 phút/đêm) | 720 (**+207,5**) | 96,00 % | **không, nhưng sát** | Ước lượng |
| Thêm một service Render thứ hai cho realtime | 1.025 | **136,67 %** | **CÓ** | Ước lượng |

**Trả lời thẳng câu hỏi của AC5:** một phòng live mở **trong** khung thức tốn **0 giờ thêm** — máy đã thức vì `keep-awake` ping. Mở **ngoài** khung tốn **0,75 h** cho một lần 30 phút, và **207,5 h/tháng** nếu mở suốt đêm, đẩy tổng lên **96 % trần**.

**Ba điều phải nói kèm, nếu không con số 0 giờ là con số dối:**

1. **0 giờ thêm chỉ đúng nếu phòng live nằm trên chính service Gin đang có.** Nếu dựng service thứ hai cho realtime (WebSocket/SSE riêng), tổng thành 1.025 h = **136,67 % trần**, vượt ngay. Đây là bẫy dễ sập nhất.
2. **Chưa biết Render có tính một kết nối SSE đang mở là "có lưu lượng" hay không.** Nếu CÓ, phòng live mở qua đêm tự giữ máy thức và trường hợp 207,5 h thành hiện thực. Nếu KHÔNG, SSE đứt sau 15 phút và phòng live ngoài khung thức **không dùng được**. Cả hai nhánh đều là tin xấu, và đây là điều phải đo trên Render thật trước khi làm.
3. Cron GitHub Actions chạy trễ vài phút tới vài chục phút lúc cao điểm, nên khung thức thực tế có thể **ngắn hơn**, tức 512,5 h là **cận trên** của số giờ nền — nhưng cũng có nghĩa phòng live có thể bị đứt bất ngờ.

Băng thông Render free là 100 GB/tháng. Với 23.649,6 B/viewer/phút × 60 = **1.418.976 B/viewer/giờ**, 100 GB đủ khoảng:

- **70.473 giờ-viewer/tháng** nếu 100 GB = 10¹¹ byte (cách Render thường ghi)
- **75.670 giờ-viewer/tháng** nếu 100 GB = 100 GiB = 107.374.182.400 byte

Chia cho 720 giờ một tháng, tức khoảng **98–105 viewer mở liên tục 24/7**. Ở quy mô V1 đó chưa phải nút cổ chai, nhưng nó **không phải "unlimited"**: quá ~100 viewer thường trực là hết băng thông. (Chưa đo được Render tính GB theo 10⁹ hay 2³⁰ — ghi cả hai, không chọn con số có lợi.)

---

## Trọng lượng trang viewer — kiểm chứng "0 MB WASM"

Văn kiện gốc hứa "0MB WASM Engine!" cho viewer. Đây là phép đo, không phải lời hứa. Đo bằng `performance.getEntriesByType("resource")` **cả trong page lẫn trong worker** — request do Web Worker phát ra không hiện trong CDP session của trang, nên nếu chỉ đếm ở trang thì trang có bật PGlite cũng báo 0 B WASM. Dùng `/ac1` (trang CÓ bật engine) làm đối chứng: nếu `/ac1` ra 0 B thì phép đo hỏng.

3 lần, kết quả giống hệt nhau:

| Trang | Tổng byte | Byte WASM | Số worker | Nhãn |
|---|---:|---:|---:|---|
| `/viewer` (trang viewer, không engine) | **462.569 B** (không nén) / **139.361 B** (nén) | **0 B** | **0** | Thật |
| `/ac1` (đối chứng, CÓ engine) | 16.692.968 B / 9.988.009 B | **15.637.266 B** / 9.674.266 B | **1** | Thật |

Đối chứng đạt: `/ac1` tải **15,6 MB** WASM + data trong một worker; `/viewer` tải **0 B** và **0 worker**. Phép đo chứng minh được (`instrumentProven: true`).

**Vậy câu "0 MB WASM cho viewer" là ĐÚNG, và đây là lần đầu nó được đo.** Nhưng phải đọc kèm: trang viewer vẫn nặng **462.569 B** (chưa nén) hoặc **139.361 B** (nén) — đó là bundle Next + React của chính trang. "0 MB WASM" không có nghĩa "trang nhẹ"; nó có nghĩa "không tải engine". Và 139 KB nén vẫn là một trang web bình thường, không phải "siêu nhẹ" như văn kiện mô tả.

---

## AC6 — Kết luận go/no-go

### (a) Live Rooms có rẻ hơn đáng kể so với link `/share` hiện có không?

**Không. Live Rooms đắt hơn, và đắt hơn rất nhiều.**

| | Link `/share` hiện có | Live Rooms (đo được) |
|---|---|---|
| Byte để viewer thấy nội dung | **1.860 B, một lần** | **23.649,6 B/viewer/phút**, liên tục |
| Máy chủ tham gia | không có | Gin + Next, 2 tiến trình |
| Dữ liệu rời khỏi máy người dùng | **không** (nằm trong URL fragment) | **có**, SQL nằm trên server |
| SQL gửi lại cho mỗi viewer | không | **10.011,2 B/phút/viewer** (SSE) |
| Giờ Render | 0 | 0 trong khung thức, +207,5 h/tháng nếu mở đêm |
| Chạy được câu mới của viewer | **có** (engine trong trình duyệt viewer) | **không** (chỉ thấy ảnh chụp) |

Một phiên xem 1 giờ: `/share` gửi **1.860 B**; live room gửi **1.419.000 B** cho một viewer (gấp **763×**), và **42,6 MB** cho 30 viewer. Đổi lại, viewer nhận được một thứ `/share` không có: nội dung cập nhật theo host. Nhưng cái giá là băng thông tăng 763 lần, một tầng server mới, và SQL rời khỏi máy.

**Phép so 763× này phải đọc kèm một điều kiện, nếu không là không công bằng với `/share`.** `/share` rẻ vì nó **không chạy engine**: muốn xem cây B-Tree hay plan thì viewer phải bấm "Chạy thử", và lúc đó tải engine. Đo ở `/ac1`: **16.692.968 B** cho một lần tải engine (WASM 15.637.266 B). Số đó bằng **11,8 giờ stream** của live room cho một viewer, hoặc **0,4 giờ** nếu chia cho 30 viewer xem cùng lúc. Nên 763× chỉ đúng khi viewer **chỉ xem, không chạy**; nếu mỗi viewer đều bấm "Chạy thử" thì khoảng cách hẹp lại rất nhiều, và với 30 viewer cùng chạy thì `/share` thậm chí **đắt hơn** trong giờ đầu.

Điều đó **không đổi kết luận**, vì hai lý do đo được: (1) `/share` tải engine **một lần rồi thôi**, còn live room trả 1.419.000 B **mỗi giờ, mỗi viewer**, không có điểm dừng — sau khoảng 12 giờ stream thì hoà, sau đó live room đắt mãi; (2) cái mất đi khi chọn live room không phải byte mà là **quyền chạy câu mới** — viewer thành người xem ảnh chụp, và SQL phải nằm trên server. Nói cách khác: 763× là con số của chế độ "chỉ xem", và chính chế độ đó là chế độ duy nhất live room làm được.

Con số quyết định: **`/share` đã giải quyết đúng bài toán "cho người khác xem" với 1.860 B và 0 đồng hạ tầng.** Live Rooms không rẻ hơn ở bất kỳ chiều nào **khi viewer chỉ xem** — và khi viewer muốn chạy, `/share` làm được còn Live Rooms thì không.

### (b) Phần nào của văn kiện gốc đứng được với số đo

| Khẳng định trong `Y_TUONG_TEAM_MULTIPLAYER_COLLABORATION.md` | Số đo | Đứng được? |
|---|---|---|
| "**0MB WASM Engine!** Chỉ render SVG/DOM tĩnh" (dòng 44) | Viewer tải **0 B WASM, 0 worker**; `/ac1` đối chứng tải 15,6 MB | **ĐÚNG** — lần đầu được đo |
| "Snapshot nén Brotli, **< 10KB**" (dòng 152, 177) | Payload đầy đủ có B-Tree = **13.841 B**; chỉ 3 tab + plan + 100 dòng = 3.906 B | **SAI** cho trường hợp có B-Tree (vượt 38,41 % nếu 10 KB = 10.000 B; 35,17 % nếu 10.240 B); đúng nếu bỏ B-Tree. Thêm: đo được là **gzip**, không phải Brotli |
| "Chỉ kéo dữ liệu **một chiều** qua Edge CDN" (dòng 43) | SSE stream sống qua `rewrites` (13 ms); polling 304 cũng chạy | **ĐÚNG về kỹ thuật**, nhưng "qua Edge CDN" chưa đo được (cấm gọi Cloudflare) |
| "**Hoàn toàn MIỄN PHÍ (Unlimited Free Viewers)**" (dòng 45) | 23.649,6 B/viewer/phút, tuyến tính theo viewer và thời gian; 30 viewer = 42,6 MB/giờ; trần băng thông 100 GB ≈ 98–105 viewer thường trực | **SAI** — "unlimited" không tồn tại; byte và giờ đều có hạn |
| "Xem Plan/B-Tree **mượt** trên mobile" (dòng 154, 228) | Model B-Tree 13.841 B render được, 0 B WASM; nhưng chỉ là ảnh chụp, không trả lời được câu mới | **ĐÚNG một nửa** — vẽ được, nhưng mất khả năng "sửa rồi chạy lại" |
| "SSE **siêu nhẹ**" (dòng 227) | SSE 23.649,6 so với polling 23.699,7 B/viewer/phút — chênh **0,2 %** | **SAI** — SSE không nhẹ hơn polling; nó chỉ nhanh hơn 13 ms so với 2 s |
| "Thu tiền Seat $15–30/tháng" là mô hình cũ (dòng 45) | không đo | ngoài phạm vi |

Phần **đứng vững nhất** là "0 MB WASM": đó là một quan sát kiến trúc đúng, và giờ có số. Phần **sai rõ nhất** là "unlimited free viewers": byte scale tuyến tính, và mỗi viewer là một khoản chi phí thật.

### (c) Đề xuất: **no-go** cho Live Rooms như một tính năng của V1

Kết luận: **không nên làm.** Đây là kết quả thành công của cổng đo, không phải thất bại.

Lý do, mỗi lý do kèm số:

1. **Không rẻ hơn `/share`, mà đắt hơn 763 lần băng thông cho một phiên 1 giờ** (1.860 B một lần so với 1.419.000 B/giờ/viewer). Không có luận điểm nào trong văn kiện gốc sống sót qua phép so này.
2. **Phải gửi SQL của người dùng lên server và giữ ở đó.** Đo được **10.011,2 B/phút/viewer là SQL** (SSE, 30 viewer), gửi lại mỗi lần host phát. Core Rule 7 đang **nợ**, và đây chính là chi phí của việc trả nợ đó. Live Rooms không thể tồn tại mà không phá Core Rule 7.
3. **Viewer mất khả năng tự chạy.** Đây là mất mát lớn nhất và nó không hiện ra trong bất kỳ bảng byte nào: sản phẩm được xây quanh "sửa rồi chạy lại", còn viewer chỉ xem được ảnh chụp do host chạy. Giá trị cốt lõi bị cắt, không phải được tối ưu.
4. **SSE không mua được gì.** Chênh 0,2 % băng thông so với polling 2 s, đổi lấy một tầng giao thức, một ràng buộc `no-transform`/`compress` dễ vỡ (đo được: bỏ header là stream chết 3/3 lần), và một chế độ lỗi mới.
5. **Chi phí hạ tầng không phải 0 như văn kiện nói.** Trong khung thức là 0 giờ thêm, nhưng dựng service thứ hai là **136,67 % trần**. Và chưa biết Render có tính SSE đang mở là lưu lượng — nếu có, phòng mở đêm đẩy lên **96 %** trần.
6. **Cái đúng thì đã có sẵn.** `/share` hiện có đã gửi đúng 1.860 B và không cần server. Phần giá trị thật của ý tưởng — "người khác xem được" — đã được giải quyết.

**Nếu chủ dự án vẫn muốn một phần của ý tưởng, đề xuất hẹp nhất có số chống lưng:** làm một **"share ảnh chụp có Plan/B-Tree"** — mở rộng `/share` để mang thêm plan và model B-Tree, đo được **13.841 B**, vẫn dưới trần 32 KB. Việc này: không cần server, không cần SSE, không cần giờ Render, **không gửi SQL đi đâu** (vẫn nằm trong URL fragment), và cho viewer xem đúng thứ văn kiện gốc muốn họ xem. Đây là **go có điều kiện** cho một tính năng nhỏ hơn nhiều, không phải cho Live Rooms.

**Điều kiện để đổi thành go cho Live Rooms:** cần đo trên Render thật hai điều chưa đo được — (i) Render có tính SSE đang mở là lưu lượng hay không, (ii) giờ instance thật so với 750 h. Cộng thêm: chủ dự án phải quyết trả nợ Core Rule 7. Chưa có ba điều đó thì không nên làm.

---

## Chưa đo được

Ghi rõ, không thay bằng số khác:

| Việc | Vì sao chưa đo |
|---|---|
| Giờ Render thật, hành vi ngủ/thức khi có SSE mở | Task cấm gọi Render thật; giờ instance chỉ hiện trong dashboard |
| SSE qua Cloudflare/CloudFront Edge CDN | Task cấm gọi Cloudflare; chưa đăng ký dịch vụ |
| SSE qua `rewrites` trên Vercel thật | Chưa deploy; `compress` trên Vercel do nền tảng quyết, không đặt được |
| Brotli so với gzip | Codec SP022 chỉ dùng `CompressionStream("gzip")`; trình duyệt không có Brotli qua Web Streams. Con số 13.841 B là gzip, **không phải** Brotli như văn kiện gốc giả định |
| Hành vi khi hơn 30 viewer | Task yêu cầu đúng 30; chưa đo trên 30. Không ngoại suy tuyến tính vì chưa biết điểm gãy |
| MySQL | Ngoài phạm vi task (chỉ PostgreSQL/PGlite) |
| `DE_XUAT_STORY_SP024_TEAM_MULTIPLAYER.md` | File **không có trong worktree này** vì nhánh `task/Task159` tách trước commit `d60afab`; file **có trên `main`**. Nên phần phản biện trong đó chưa được đối chiếu ở lượt đo này (task159.md dòng 45 có nhắc) |

---

## Phát sinh

1. **`CLAUDE.md` dòng 244 và báo cáo Task014 ghi sai cơ chế.** Ghi "phải đặt `compress: false`". Đo được: `no-transform` một mình cũng đủ, và thiếu `no-transform` thì `compress: false` mới là thứ cứu. Cần sửa thành "hai lớp bảo vệ, mỗi lớp một mình đủ". Không tự sửa `CLAUDE.md` vì ngoài phạm vi task.
2. **`SP999/README.md` dòng 36** ghi `compress: false` "chưa đưa vào `web/next.config.ts`" — vẫn đúng, và giờ biết thêm là `no-transform` ở `api/internal/ai/ai.go:349` đã che phần lớn rủi ro đó. Cần ghi lại khi có dịp.
3. **`encodeSnapshot` chặn trần 32 KB và 100 tab ở client, Gin không kiểm.** Đo được: gửi 3 MB thẳng vào `/publish` vẫn 200. Nếu làm live room thật, phải kiểm ở server. Ghi vào `SP999`.
4. **Core Rule 7 cần chủ dự án quyết trước mọi story gửi SQL qua mạng.** Số đầu vào: **10.011,2 B/phút/viewer là SQL** (SSE, 30 viewer; polling 10.183,5). Không sửa Core Rule 7 trong task này.
5. **`DE_XUAT_STORY_SP024_TEAM_MULTIPLAYER.md` có trên `main` nhưng thiếu trong worktree `Task159`** (nhánh tách trước `d60afab`), nên lượt đo này không đối chiếu được phần phản biện 5 điểm trong đó. Sau khi merge thì file có mặt; ai đọc báo cáo này nên mở nó ra đối chiếu — đặc biệt mục 2 (3 tầng có cổng) và mục 6.1 (hướng A/B), vì kết luận no-go ở đây chỉ nói về **Tầng 1**, không nói Tầng 2/3 có nên làm hay không.
6. **Hai script đo từng tính sai dòng SQL và byte mỗi viewer; đã sửa tại chỗ, số cũ giữ lại để đối chiếu.** Hai việc khác nhau, hai script khác nhau:
   - **Byte mỗi viewer** → `tools/ac4-recompute.mjs`. `ac4.mjs` chia **tổng** byte cho số viewer, gồm cả byte của host gọi `publish`.
   - **Dòng SQL** → `tools/sql-line.mjs`. `ac2.mjs` và `ac4.mjs` nhân tỉ lệ SQL với **toàn bộ** byte thân, kể cả `hello`/`ping` không chở SQL — thổi số lên **1,2–3,5 %**. `ac4-recompute.mjs` **cũng** từng làm vậy, nên nó **không** phải nguồn của dòng SQL; trường `sqlBpm` ở đó đã đổi tên thành `sqlBpm_naiveWrong`.
   - **JSON trong `results/` sinh trước khi sửa, nên vẫn mang số sai ở trường tên sạch** `sqlBytesPerViewerPerMinute` (`ac4_sse.json` trung vị 10.286,910; `ac4_poll.json` 10.308,710) và `sqlBytesPerMinute`. **Đừng đọc hai trường đó.** Số đúng ở `results/sql_line.json`.
7. **`ac2.mjs` từng báo `publishesInWindow` theo danh nghĩa, không theo thực tế.** Nó tính `floor(elapsed / 10000)`, nên ở chế độ **phòng đứng yên** (không phát gì) vẫn báo `6` lần phát. Đã sửa thành đếm thật (`publishesDone++` sau mỗi lần `publish()`). Không ảnh hưởng số byte đã báo (byte đo từ CDP), nhưng nếu ai đọc trường đó để suy số `snapshot` thì sẽ sai — và đúng là đã suy sai một lần trong quá trình tự kiểm.

---

## File và cách chạy lại

Spike tự chứa trong `spikes/live-rooms/`:

- `server/` — Gin fan-out. `go vet ./... && go build ./...` đều exit 0. Cổng 18160.
- `web/` — Next 16.4.4. `npm run build` rồi `npx next start -p 3159`. Biến `API_ORIGIN`, `NEXT_COMPRESS=1` để bật nén khi đối chứng.
- `web/tools/` — 20 script đo cộng `lib.mjs` dùng chung (21 file `.mjs`). Mỗi script ghi JSON vào `web/results/`.
- `web/results/` — toàn bộ số thô của báo cáo này, đã commit.

Chạy lại toàn bộ:

```
cd spikes/live-rooms/server && go build -o liverooms.exe . && ./liverooms.exe
cd spikes/live-rooms/web && npm run build && npx next start -p 3159
cd spikes/live-rooms/web && node tools/ac1.mjs && node tools/ac3.mjs && node tools/ac3-full.mjs
node tools/ac2.mjs sse && node tools/ac2.mjs poll && PUBLISH=0 node tools/ac2.mjs sse
node tools/ac4.mjs sse 30 10 && node tools/ac4.mjs poll 30 10 && node tools/ac4-recompute.mjs && node tools/sql-line.mjs
node tools/edge.mjs kill && node tools/edge.mjs slow3g && node tools/edge-publish.mjs
node tools/sse-flush.mjs compress-false && node tools/weight.mjs compress-false && node tools/ac5.mjs && node tools/frame-size.mjs
```

Mọi mã trong `web/lib/`, `web/ac3/`, `web/contracts/` là bản sao nguyên văn từ `web/src/`, để phép đo đi đúng code của sản phẩm chứ không phải bản viết lại. Đối chiếu ngày 2026-11-23, cả 9 file **giống hệt từng byte** (SHA256 của bản trong spike = của bản sản phẩm):

| File trong spike | File sản phẩm | SHA256 (giống nhau) |
|---|---|---|
| `lib/codec.ts` | `web/src/modules/share/codec.ts` | `B55144222A16A7A312A9E4554AABDFD7BF46FB58843C2F57EAC366475784C233` |
| `lib/snapshot.ts` | `web/src/modules/share/snapshot.ts` | `87F3E289B2FEEAA2A97BAEF093AB7AA964AD74E7E6FDD62958CDDE84BD6A54EA` |
| `lib/normalize/postgres.ts` | `web/src/modules/plan-runner/normalize/postgres.ts` | `3530E099E1AA3947B175E1F430B75B5B820E8A1F9EFE343CBDEBC196B89A5181` |
| `ac3/btree-read.ts` | `web/src/engines/postgres/btree-read.ts` | `EBD380A0F2A03B3D7128230E13E43FFC1326F6E0EFBF392A57EEBF75699DB43A` |
| `ac3/btree-key.ts` | `web/src/engines/postgres/btree-key.ts` | `52F64E65ADC7DCDFA3FD9E39B5478C6B60F8E5CACFE754243AEC09B74F043AC3` |
| `contracts/btree.ts` | `web/src/contracts/btree.ts` | `78ACE5FE58D11F055E1F2F840F89307E7E3662C9AB33C3BFC64E04AB21F4A9CC` |
| `contracts/conclusion.ts` | `web/src/contracts/conclusion.ts` | `AA493D68150FE3E94DD163D8C074EE920A1B709028F5DC63EB197768800AC064` |
| `contracts/engine.ts` | `web/src/contracts/engine.ts` | `AA8B1C1A4E9858356D18C66AA6B64FBCEF7DBC37CBCD08470A8103B8591EC9CF` |
| `contracts/plan.ts` | `web/src/contracts/plan.ts` | `41A3D7D6F8BCBFD24C30521EB5C2DCA52F96AD9474FCB73B27E7D6D07398AFE1` |

Ba file `lib/fixture.ts`, `lib/measure.ts`, `ac3/btree.worker.ts` là mã riêng của spike, không chép từ sản phẩm. Sửa bản gốc thì phải chép lại và cập nhật bảng này; đừng sửa tay bản trong spike.
