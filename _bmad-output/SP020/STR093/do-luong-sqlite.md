# Báo Cáo Đo Lường Thực Nghiệm SQLite WASM (Cổng Chặn Go/No-Go)

- **Mã Story:** `STR093` (Đo bundle & RAM SQLite WASM)
- **Mã Task:** `Task131`
- **Người thực hiện:** Amelia (Developer SQLLens)
- **Ngày đo:** 2026-11-16T13:31:57.212Z
- **File số đo gốc:** `spikes/sqlite-wasm/last-run.json` và `spikes/sqlite-wasm/last-run.log`
- **Ảnh chụp:** `spikes/sqlite-wasm/screenshot-harness.png` (cùng một lần chạy với JSON)

> **Đính chính vòng review:** Bản trước ghi phiên bản thư viện là v3.47.2 trong khi build thực tế trong `spikes/sqlite-wasm/vendor/` báo `SQLite 3.54.1`; ảnh chụp AC2 lại lấy từ một lần chạy khác nên heap WASM trong ảnh (38,88 MB) lệch với JSON (20,06 MB). Nay `measure.mjs` ghi `last-run.json`, `last-run.log` và ảnh chụp trong cùng một lượt, và mọi số dưới đây lấy từ lượt chạy đó.

---

## 1. Thông Tin Môi Trường & Thiết Bị Đo

- **Phần cứng máy đo:**
  - CPU: 12th Gen Intel(R) Core(TM) i5-12450H (12 vCPUs)
  - Bộ nhớ RAM: 15,7 GB (16 GB vật lý; 0,6 GB trống tại thời điểm đo)
  - Hệ điều hành: Windows 11 Home 10.0.26200 x64
- **Trình duyệt thực thi:**
  - Google Chrome 157.0.8103.52 (Official Build, 64-bit) chạy trực tiếp thông qua Playwright automation harness
- **Phiên bản thư viện:**
  - `@sqlite.org/sqlite-wasm` v3.54.1-build1 (Module SQLite WebAssembly chính thức của SQLite.org; `sqlite3.version.libVersion` báo `3.54.1`)
  - Bản copy dùng cho spike: `spikes/sqlite-wasm/vendor/` (index.mjs 674.603 byte, sqlite3.wasm 879.084 byte)
- **Cơ chế phục vụ & giả lập môi trường mạng (`measure.mjs`):**
  - Node.js HTTP Server cục bộ thiết lập đầy đủ headers bảo mật bắt buộc cho OPFS:
    - `Cross-Origin-Opener-Policy: same-origin` (COOP)
    - `Cross-Origin-Embedder-Policy: require-corp` (COEP)
    - `Cross-Origin-Resource-Policy: same-origin` (CORP)
  - Phục vụ tệp nén `Content-Encoding: gzip` tương đương CDN production thật.

---

## 2. Tiêu Chí AC1: Kích Thước Bundle (Bundle Size & Code Splitting)

### 2.1. Số đo chi tiết từng tệp
| Tên tệp | Decoded Size (Uncompressed) | Encoded Size (Gzip Transfer) | Thời gian tải (Local CDN) |
|---|---:|---:|---:|
| `index.mjs` (ES Module Wrapper & JS Bindings) | 658,8 KB | 176,1 KB | 29 ms |
| `sqlite3.wasm` (WebAssembly Core Engine) | 858,5 KB | 397,9 KB | 70 ms |
| **Tổng cộng SQLite WASM** | **1.517,3 KB (~1,48 MB)** | **574,0 KB** | **99 ms** |

*(Ghi chú: `sqlite3-opfs-async-proxy.js` ~10,3 KB gzip chỉ tải khi dùng VFS `opfs` cổ điển; harness đo dùng `opfs-sahpool` nên không tính vào tổng trên.)*

### 2.2. Đánh giá kiến trúc tách bundle
- **Tách riêng hoàn toàn (Code Splitting):** SQLite WASM được thiết kế để nạp động trong Web Worker độc lập, chỉ được tải khi người dùng chủ động chọn engine SQLite.
- **Tác động tới bundle chính:** **0 KB** ảnh hưởng tới initial bundle của SQL editor / Next.js app. Toàn bộ số đo trên là tài nguyên tải trong worker, không có entry nào của `web/src` import thư viện này.
- Số 0 KB là kết luận từ kiến trúc (không có import tĩnh), không phải số đo `next build`; Task132/133 phải xác nhận lại bằng build thật khi nối UI.

### 2.3. Đối chiếu với PostgreSQL (PGlite 0.5.14)
- **PGlite 0.5.14:** Tổng kích thước sau gzip là ~5,1 MB (theo kiểm chứng thực tế tại `CLAUDE.md`).
- **SQLite WASM:** Tổng kích thước sau gzip là **574,0 KB**.
- **Kết luận kích thước:** SQLite WASM nhẹ hơn PGlite **khoảng 8,9 lần**.

---

## 3. Tiêu Chí AC2: Mức Tiêu Thụ RAM & Tốc Độ Thực Thi (Memory & Performance)

### 3.1. Phương pháp đo
- **WASM Heap:** Đọc trực tiếp `sqlite3.wasm.memory.buffer.byteLength` **bên trong worker** — nơi SQLite thực sự giữ dữ liệu khi VFS là bộ nhớ.
- **Page Agent RAM:** `performance.measureUserAgentSpecificMemory()` gọi ở trang. Lưu ý phạm vi: Chrome chỉ trả bộ nhớ của agent cluster trang và **không gồm heap WASM của worker** (đã kiểm chứng: page ổn định ~4,3 MB trong khi heap worker 20-38 MB). Vì vậy hai số phải đọc riêng, không cộng gộp thành "tổng RAM trang" khi chưa đối chiếu Chrome Task Manager.
- **Dung lượng file export:** `sqlite3_js_db_export` của DB engine.

### 3.2. Bảng số đo thực nghiệm qua các mốc dữ liệu
| Kịch bản kiểm thử | Số dòng | Thời gian Insert | Tốc độ chèn | WASM Heap | Page Agent RAM | Dung lượng file `.sqlite` |
|---|---:|---:|---:|---:|---:|---:|
| **Baseline (Trang & Worker sẵn sàng)** | 0 | - | - | 8,00 MB | 4,11 MB | - |
| **Mốc 10.000 dòng** | 10.000 | 294 ms | 34.014 dòng/s | 8,00 MB | 4,32 MB | 0,44 MB |
| **Mốc 100.000 dòng** | 100.000 | 1.809 s | 55.279 dòng/s | 8,00 MB | 4,38 MB | 4,34 MB |
| **Mốc 500.000 dòng (OPFS SAHPool)** | 500.000 | 9.291 s | 53.815 dòng/s | 20,06 MB | 4,42 MB | 21,82 MB |
| **Bảng rộng 20 cột × 100.000 dòng** | 100.000 | 10,402 s | 9.614 dòng/s | 20,06 MB | 5,29 MB | - |
| **Mốc 500.000 dòng (In-Memory VFS)** | 500.000 | 6,354 s | 78.690 dòng/s | 24,13 MB | 4,25 MB | 21,82 MB |

### 3.3. So sánh trực diện với PostgreSQL (PGlite)
- **PGlite:** Đỉnh RAM (spike) đạt **1,1 GB** ngay khi khởi tạo, sau đó giảm về ~385 MB, và đạt **~600 MB** sau mốc 500.000 dòng (rủi ro OOM cao trên máy 4GB/8GB RAM).
- **SQLite WASM:**
  - Không có memory spike khi khởi tạo: **8,0 MB** WASM Heap và **4,11 MB** Page Agent RAM.
  - Tại mốc cực đại 500.000 dòng: WASM Heap **20,06 MB** (OPFS) hoặc **24,13 MB** (In-Memory); Page Agent 4,42 MB / 4,25 MB.
  - Phần do SQLite chiếm thêm so với lúc rỗng là heap WASM (~12-16 MB ở 500k dòng), thấp hơn PGlite khoảng 25 lần theo cùng cách đo heap.
- Tốc độ chèn ổn định: 500k dòng ~9,3 giây trên OPFS và ~6,4 giây trên in-memory VFS.

### 3.4. Ảnh chụp màn hình kết quả đo thực tế từ Harness (Tiêu chí AC2)
Ảnh chụp được `measure.mjs` chụp trong cùng lượt chạy với `last-run.json`, ghi nhận trực quan VFS `opfs-sahpool`, 500.000 dòng, nhật ký chèn 10k/100k/500k, SELECT đếm, dung lượng export và các dòng RAM tương ứng:
- File ảnh: `spikes/sqlite-wasm/screenshot-harness.png`
- Liên kết tương đối: [screenshot-harness.png](../../../spikes/sqlite-wasm/screenshot-harness.png)

---

## 4. Tiêu Chí AC3: Thời Gian Khởi Động (Startup Latency)

Đo thời gian từ lúc phát lệnh nạp worker tới khi SQLite runtime báo sẵn sàng (`window.__harnessReady`):

- **Cold Fast (cache tắt, mạng nội bộ mô phỏng CDN gzip):**
  - Thời gian sẵn sàng (`readyPerformanceNowMs`): **365 ms**
  - Tổng thời gian thực tế (`wallClockMs`): **599 ms**
- **Warm (cache trình duyệt bật):**
  - Thời gian sẵn sàng: **172 ms** (tải từ cache, gần như tức thì)
- **Cold Slow 3G (400ms RTT, 400 kbps):**
  - Thời gian sẵn sàng: **13.795 ms**, wall-clock **13.809 ms**
  - Worker tải ngầm nên UI không bị block trong suốt thời gian này.

*So sánh với PGlite:* PGlite mất trung bình 1,8 - 2,0 s để khởi tạo ngay cả khi mạng nội bộ/cache ấm. SQLite nhanh hơn PGlite khoảng 3 đến 10 lần. Hai lần chạy liên tiếp cho cold 365-557 ms và warm 172-229 ms, nên coi đây là khoảng dao động, không phải một con số cố định.

---

## 5. Tiêu Chí AC4: Thử Nghiệm OPFS & Khả Năng Lưu Trữ Bền Vững (Persistence)

### 5.1. Kết quả trên Google Chrome thật
- **Môi trường cách ly (`crossOriginIsolated`):** `true` (nhờ headers COOP/COEP).
- **VFS được kích hoạt:** **`opfs-sahpool`** (Origin Private File System SyncAccessHandle Pool).
- **Hạn mức lưu trữ (`storage.estimate()`):** quota ~10,7 GB (10.737.444.150 byte), usage 25.910 byte.
- **Kiểm thử bền vững sau Reload:**
  - Chèn 500.000 dòng qua `opfs-sahpool`, reload trang, khởi động lại worker trên cùng tệp DB.
  - **Kết quả:** `SELECT count(*)` trả đúng **500.000** dòng, VFS sau reload vẫn là `opfs-sahpool`.

### 5.2. Safari / WebKit — chưa đo được trên Safari thật
- Playwright WebKit cục bộ thiếu executable (`browserType.launch: Executable doesn't exist`), nên **không có số đo nào trên Safari thật**; AC4 phần Safari vẫn là khoảng trống, chỉ có tài liệu tham chiếu.
- Theo tài liệu WebKit, Safari hỗ trợ OPFS SyncAccessHandle trong Web Worker từ Safari 15.2; SAH pool mà thư viện dùng cần kiểm chứng lại trên Safari thật trước khi hứa với người dùng.
- **Rào cản cần chú ý:**
  1. **Yêu cầu Headers:** OPFS SAHPool bắt buộc `COOP: same-origin` và `COEP: require-corp`. Thiếu headers (iframe nhúng, preview) thì OPFS không kích hoạt.
  2. **Chế độ duyệt riêng tư:** Safari và Chrome có thể chặn hoặc dọn OPFS khi đóng tab.
- **Giải pháp:** Adapter SQLite (STR094) phải phát hiện linh hoạt: có OPFS SAHPool thì dùng; thiếu headers hoặc bị chặn thì tự chuyển sang `in-memory VFS` kèm thông báo nhẹ.

---

## 6. Tiêu Chí AC5: Quyết Định Cổng Chặn (Go / No-Go Decision)

### **QUYẾT ĐỊNH: `go có điều kiện` (Conditional Go)**

### **Lý do quyết định:**
1. Bundle 574 KB gzip (nhẹ hơn PGlite ~8,9 lần), tách rời hoàn toàn khỏi editor main bundle.
2. Bộ nhớ khiêm tốn: heap WASM 20,06 MB ở 500k dòng, không có spike khởi tạo, an toàn cho máy 8 GB.
3. Khởi động nhanh: 172 ms (warm) và 365 ms (cold).
4. OPFS SAHPool bảo toàn 100% dữ liệu qua reload trên Chrome thật.

### **3 Điều kiện kỹ thuật bắt buộc khi triển khai:**
- **Điều kiện 1 (Lazy Loading Web Worker):** Toàn bộ thư viện SQLite WASM và logic adapter chỉ được tải động khi người dùng chọn engine SQLite; không import vào bundle chính.
- **Điều kiện 2 (Graceful VFS Fallback):** Kiểm tra môi trường lúc khởi tạo worker; thiếu `crossOriginIsolated` hoặc OPFS bị chặn thì tự chuyển sang `in-memory VFS`, không lỗi và không treo ứng dụng.
- **Điều kiện 3 (Ngưỡng cảnh báo UX nhất quán):** Mặc định tối đa 100.000 dòng; tùy chọn 500.000 dòng kèm cảnh báo thời gian thực thi (~9-11 giây); vượt trên 500.000 dòng chỉ tính toán và gắn nhãn `Ước lượng` theo Core Rule 1 & Core Rule 2 của `AGENTS.md`.

---

## 7. Tiêu Chí AC6: Kế Hoạch Triển Khai Cho STR094 & STR095

Vì kết luận là **`go có điều kiện`**, kế hoạch triển khai cho 2 story tiếp theo:

- **STR094 (SQLite chạy trong trình duyệt):**
  - *Task132:* Adapter + Web Worker theo hợp đồng `EngineAdapter` (chạy query, trả kết quả cùng hình dạng PGlite, timeout, fallback VFS).
  - *Task133:* Nối engine "SQLite" vào EngineTabs, rào chắn SQL, gắn nhãn **`chưa mô phỏng được`** cho Plan/B-Tree (Core Rule 4).
- **STR095 (Nhập/Xuất file `.sqlite` / `.db`):**
  - *Task134:* Nhập file từ máy vào vùng nhớ WASM, kiểm tra file signature và giới hạn kích thước, 100% tại trình duyệt (Core Rule 7).
  - *Task135:* Xuất file binary từ OPFS / in-memory VFS qua Blob download.
