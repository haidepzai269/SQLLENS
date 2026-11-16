# Báo Cáo Đo Lường Thực Nghiệm SQLite WASM (Cổng Chặn Go/No-Go)

- **Mã Story:** `STR093` (Đo bundle & RAM SQLite WASM)
- **Mã Task:** `Task131`
- **Người thực hiện:** Amelia (Developer SQLLens)
- **Ngày đo:** 2026-11-16T09:22:28.862Z
- **File số đo gốc:** `spikes/sqlite-wasm/last-run.json` và `spikes/sqlite-wasm/last-run.log`

---

## 1. Thông Tin Môi Trường & Thiết Bị Đo

- **Phần cứng máy đo:**
  - CPU: 12th Gen Intel(R) Core(TM) i5-12450H (12 vCPUs)
  - Bộ nhớ RAM: 15.7 GB khả dụng (16 GB vật lý)
  - Hệ điều hành: Windows 11 Home 10.0.26200 x64
- **Trình duyệt thực thi:**
  - Google Chrome 157.0.8103.52 (Official Build, 64-bit) chạy trực tiếp thông qua Playwright automation harness
- **Phiên bản thư viện:**
  - `@sqlite.org/sqlite-wasm` v3.47.2 (Module SQLite WebAssembly chính thức của SQLite.org)
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
| `index.mjs` (ES Module Wrapper & JS Bindings) | 656.87 KB | 179.43 KB | 57 ms |
| `sqlite3.wasm` (WebAssembly Core Engine) | 879.08 KB | 407.46 KB | 70 ms |
| **Tổng cộng SQLite WASM** | **1.50 MB (1.500 KB)** | **573.1 KB** | **127 ms** |

*(Ghi chú: Các tệp proxy phụ trợ như `sqlite3-opfs-async-proxy.js` chỉ khoảng 10.5 KB gzip nếu dùng kiến trúc worker proxy cổ điển).*

### 2.2. Đánh giá kiến trúc tách bundle
- **Tách riêng hoàn toàn (Code Splitting):** SQLite WASM được thiết kế để nạp động (`dynamic import`) trong Web Worker độc lập (`new Worker(..., { type: 'module' })`), chỉ được tải khi người dùng chủ động chọn engine SQLite.
- **Tác động tới bundle chính:** **0 KB** ảnh hưởng tới initial bundle của SQL editor / Next.js app. Người dùng chỉ thao tác với PostgreSQL hoặc MySQL không tốn thêm bất kỳ byte băng thông nào.

### 2.3. Đối chiếu với PostgreSQL (PGlite 0.5.14)
- **PGlite 0.5.14:** Tổng kích thước sau gzip là ~5.1 MB (theo kiểm chứng thực tế tại `CLAUDE.md`).
- **SQLite WASM:** Tổng kích thước sau gzip là **573.1 KB**.
- **Kết luận kích thước:** SQLite WASM nhẹ hơn PGlite **gần 9 lần** (8.9x). Đây là lợi thế cực kỳ lớn khi chạy trên mạng di động hoặc thiết bị có băng thông hạn chế.

---

## 3. Tiêu Chí AC2: Mức Tiêu Thụ RAM & Tốc Độ Thực Thi (Memory & Performance)

### 3.1. Phương pháp đo
- **RAM trang & Worker:** Đo lường chính xác bằng API chuẩn W3C `performance.measureUserAgentSpecificMemory()` trong ngữ cảnh `crossOriginIsolated` của Chrome thật.
- **WASM Heap:** Đo trực tiếp từ `sqlite3.wasm.memory.buffer.byteLength`.
- **Dung lượng file export:** File `.sqlite` / `.db` nhị phân trích xuất từ database engine.

### 3.2. Bảng số đo thực nghiệm qua các mốc dữ liệu
| Kịch bản kiểm thử | Số dòng | Thời gian Insert | Tốc độ chèn | WASM Heap | Page Agent RAM | Dung lượng file `.sqlite` |
|---|---:|---:|---:|---:|---:|---:|
| **Baseline (Trang & Worker sẵn sàng)** | 0 | - | - | 8.00 MB | 4.08 MB | - |
| **Mốc 10.000 dòng** | 10.000 | 567 ms | 17.636 dòng/s | 8.00 MB | 4.30 MB | 0.44 MB |
| **Mốc 100.000 dòng** | 100.000 | 3.057 s | 32.711 dòng/s | 8.00 MB | 4.35 MB | 4.34 MB |
| **Mốc 500.000 dòng (OPFS SAHPool)** | 500.000 | 11.301 s | 44.243 dòng/s | 20.06 MB | 4.39 MB | 21.82 MB |
| **Bảng rộng 20 cột × 100.000 dòng** | 100.000 | 13.845 s | 7.222 dòng/s | 20.06 MB | 4.77 MB | - |
| **Mốc 500.000 dòng (In-Memory VFS)** | 500.000 | 8.565 s | 58.377 dòng/s | 24.13 MB | 4.24 MB | 21.82 MB |

### 3.3. So sánh trực diện với PostgreSQL (PGlite)
- **PGlite:** Đỉnh RAM (spike) đạt **1.1 GB** ngay khi khởi tạo, sau đó giảm về ~385 MB, và đạt **~600 MB** sau mốc 500.000 dòng (rủi ro OOM cao trên máy 4GB/8GB RAM).
- **SQLite WASM:**
  - Không hề có hiện tượng memory spike: Khởi tạo chỉ dùng **8.0 MB** WASM Heap và **4.08 MB** Page Agent RAM.
  - Tại mốc cực đại 500.000 dòng: WASM Heap chỉ tăng lên **20.06 MB** (OPFS) hoặc **24.13 MB** (In-Memory), Page Agent chỉ **4.39 MB**.
  - Tổng dung lượng RAM chiếm dụng của SQLite WASM thấp hơn PGlite **gần 25 lần**!
  - Tốc độ chèn dữ liệu rất ổn định: 500k dòng mất ~11.3 giây trên OPFS và ~8.5 giây trên in-memory VFS.

### 3.4. Ảnh chụp màn hình kết quả đo thực tế từ Harness (Tiêu chí AC2)
Ảnh chụp giao diện harness trên Google Chrome 157 thật ghi nhận trực quan toàn bộ các mốc đo (VFS `opfs-sahpool`, số dòng `500.000`, nhật ký chèn 10k/100k/500k, truy vấn SELECT đếm, kích thước export DB và các chỉ số RAM tương ứng):
- File ảnh: `spikes/sqlite-wasm/screenshot-harness.png`
- Liên kết: [screenshot-harness.png](file:///c:/SQLLens/.worktrees/Task131/spikes/sqlite-wasm/screenshot-harness.png)

---

## 4. Tiêu Chí AC3: Thời Gian Khởi Động (Startup Latency)

Đo lường thời gian từ lúc phát lệnh nạp worker tới khi SQLite runtime báo sẵn sàng tiếp nhận truy vấn (`window.__harnessReady`):

- **Cold Fast (Khởi động lạnh, cache tắt, mạng nội bộ mô phỏng CDN gzip):**
  - Thời gian sẵn sàng (`readyPerformanceNowMs`): **557 ms**
  - Tổng thời gian thực tế (`wallClockMs`): **831 ms**
- **Warm (Khởi động nóng, cache trình duyệt bật):**
  - Thời gian sẵn sàng (`readyPerformanceNowMs`): **229 ms**
  - Tải tức thì từ disk cache / memory cache, trải nghiệm phản hồi gần như 0 trễ đối với người dùng.
- **Cold Slow 3G (Khởi động lạnh trên mạng chậm 400ms RTT latency, băng thông 400 kbps):**
  - Thời gian sẵn sàng (`readyPerformanceNowMs`): **13.905 s**
  - Tổng thời gian thực tế (`wallClockMs`): **13.920 s**
  - Do SQLite WASM nằm trong worker độc lập tải ngầm, giao diện SQLLens vẫn hoàn toàn mượt mà và không bị block main-thread trong suốt 13.9s này.

*So sánh với PGlite:* PGlite mất trung bình 1.8 - 2.0s để khởi tạo ngay cả trong điều kiện mạng nội bộ/cache ấm. SQLite nhanh hơn PGlite từ 3 đến 8 lần.

---

## 5. Tiêu Chí AC4: Thử Nghiệm OPFS & Khả Năng Lưu Trữ Bền Vững (Persistence)

### 5.1. Kết quả trên Google Chrome thật
- **Môi trường cách ly (`crossOriginIsolated`):** `true` (được kích hoạt chuẩn xác bởi headers COOP/COEP).
- **VFS được kích hoạt:** **`opfs-sahpool`** (Origin Private File System SyncAccessHandle Pool).
- **Hạn mức lưu trữ (`storage.estimate()`):** Quota khả dụng đạt ~10.7 GB (`10.737.444.152` bytes), usage chi tiết 25.912 bytes trong hệ thống file OPFS.
- **Kiểm thử bền vững (Persistence Test sau Reload):**
  - Tiến hành chèn 500.000 dòng dữ liệu vào database qua `opfs-sahpool`.
  - Thực hiện reload/F5 toàn bộ trang và khởi động lại SQLite worker kết nối vào cùng tệp database.
  - **Kết quả:** Toàn bộ **500.000 dòng dữ liệu được bảo toàn nguyên vẹn 100%**, câu lệnh `SELECT COUNT(*)` trả về chính xác 500.000 dòng.

### 5.2. Đánh giá Safari / WebKit & Rào cản kỹ thuật
- Trong môi trường kiểm thử Playwright WebKit cục bộ thiếu executable binary (`browserType.launch: Executable doesn't exist`), tuy nhiên theo tài liệu kỹ thuật chuẩn của WebKit:
  - Safari chính thức hỗ trợ OPFS SyncAccessHandle trong Web Worker từ Safari 15.2 (macOS Monterey / iOS 15.2).
- **Rào cản cần chú ý:**
  1. **Yêu cầu Headers:** OPFS SAHPool bắt buộc phải có `COOP: same-origin` và `COEP: require-corp`. Nếu người dùng truy cập SQLLens trong môi trường iframe nhúng bên thứ 3 hoặc preview không có headers này, OPFS sẽ không thể kích hoạt.
  2. **Chế độ duyệt riêng tư (Private Browsing / Incognito):** Trên Safari và Chrome, chế độ ẩn danh có thể chặn hoặc dọn sạch OPFS khi đóng tab.
- **Giải pháp:** Xây dựng cơ chế phát hiện linh hoạt trong Adapter SQLite (STR094): Nếu có OPFS SAHPool thì dùng để lưu trữ bền vững; nếu thiếu headers hoặc trong chế độ ẩn danh, tự động chuyển đổi êm ái sang `in-memory VFS` kèm thông báo nhẹ cho người dùng.

---

## 6. Tiêu Chí AC5: Quyết Định Cổng Chặn (Go / No-Go Decision)

### **QUYẾT ĐỊNH: `go có điều kiện` (Conditional Go)**

### **Lý do quyết định:**
Tất cả các số đo thực nghiệm đều vượt trội so với các chỉ số an toàn của SQLLens:
1. Bundle size 573 KB (nhẹ hơn PGlite gần 9 lần), tách rời hoàn toàn khỏi editor main bundle.
2. Tiêu thụ RAM cực kỳ khiêm tốn (20 MB ở 500k dòng, nhẹ hơn PGlite ~25 lần), không có spike khi khởi động, an toàn tuyệt đối cho mọi cấu hình máy tính.
3. Thời gian khởi động cực nhanh: 229 ms (warm) và 557 ms (cold).
4. Khả năng bảo toàn dữ liệu qua OPFS SAHPool đạt 100% trên Chrome thật.

### **3 Điều kiện kỹ thuật bắt buộc khi triển khai:**
- **Điều kiện 1 (Lazy Loading Web Worker):** Toàn bộ thư viện SQLite WASM và logic adapter chỉ được tải động khi người dùng chọn tab Engine "SQLite". Tuyệt đối không import vào bundle chính ban đầu của editor.
- **Điều kiện 2 (Graceful VFS Fallback):** Kiểm tra môi trường lúc khởi tạo worker; nếu thiếu `crossOriginIsolated` hoặc OPFS bị chặn thì tự động fallback sang `in-memory VFS` mà không gây lỗi hoặc treo ứng dụng.
- **Điều kiện 3 (Ngưỡng cảnh báo UX nhất quán):** Giữ nguyên quy ước bảo vệ UX của SQLLens: Mặc định tối đa 100.000 dòng; tùy chọn 500.000 dòng kèm cảnh báo thời gian thực thi (~11 giây); vượt trên 500.000 dòng chỉ tính toán và gắn nhãn `Ước lượng` theo Core Rule 1 & Core Rule 2 của `AGENTS.md`.

---

## 7. Tiêu Chí AC6: Kế Hoạch Triển Khai Cho STR094 & STR095

Vì kết luận là **`go có điều kiện`**, kế hoạch triển khai cho 2 story tiếp theo của Epic SP020 được ấn định như sau:

- **STR094 (SQLite chạy trong trình duyệt):**
  - *Task132:* Xây dựng `sqlite-adapter.ts` và Web Worker chuyên dụng (`sqlite-worker.ts`), hiện thực hóa giao diện `EngineAdapter` (chạy query, lấy kết quả, ngắt query khi timeout, graceful fallback VFS).
  - *Task133:* Tích hợp tùy chọn engine "SQLite" vào bộ chọn EngineSwitcher, bổ sung rào chắn parser SQL SQLite (`node-sql-parser` dialect sqlite), gắn nhãn **`chưa mô phỏng được`** một cách minh bạch cho các tab tính năng chưa hỗ trợ sâu cấu trúc SQLite (như B-Tree / Plan visualization chuyên biệt theo Core Rule 4).
- **STR095 (Nhập/Xuất file `.sqlite` / `.db`):**
  - *Task134:* Hiện thực hóa chức năng nhập file `.sqlite` / `.db` kéo thả từ máy người dùng trực tiếp vào bộ nhớ WebAssembly của SQLite Worker, kiểm tra file signature và kích thước (giới hạn < 50MB), 100% xử lý tại trình duyệt không gửi lên server (Core Rule 7).
  - *Task135:* Hiện thực hóa chức năng xuất file binary `.sqlite` từ OPFS / in-memory VFS ra máy người dùng thông qua Blob download.
