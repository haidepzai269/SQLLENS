# Spike Đo Lường SQLite WASM (Task 131 / STR093)

Thư mục này chứa mã nguồn harness và công cụ đo lường thực nghiệm độc lập cho WebAssembly SQLite (`@sqlite.org/sqlite-wasm`), phục vụ cổng chặn quyết định **go / no-go** trước khi phát triển Engine SQLite thứ 3 cho SQLLens (STR094 & STR095 thuộc Epic SP020).

> **Lưu ý:** Toàn bộ mã nguồn trong thư mục này là công cụ kiểm chứng thực nghiệm (spike), hoàn toàn độc lập và **không phải code sản phẩm**, không làm thay đổi bundle hay thêm dependency vào `web/package.json`.

---

## 1. Mục Đích & Bối Cảnh Đo Lường

Theo quy trình phát triển của SQLLens và đặc tả kiến trúc `SPEC-WORKSPACE-EXPORT-SHARE`, SQLLens cần bổ sung SQLite làm engine CSDL thứ ba (sau PostgreSQL PGlite và MySQL Container Sandbox). 

Trước khi code tính năng, Task 131 đặt ra cổng chặn kỹ thuật bắt buộc phải có số liệu đo đạc thực tế trên trình duyệt Chrome thật:
1. **Bundle size:** Kích thước tải về JS + WASM sau nén gzip; xác nhận tải động qua Web Worker mà không làm tăng bundle ban đầu của SQL Editor.
2. **Mức tiêu thụ RAM & Tốc độ:** Đo qua `performance.measureUserAgentSpecificMemory()` tại các mốc 10.000, 100.000 và 500.000 dòng dữ liệu, đối chiếu trực tiếp với PGlite.
3. **Thời gian khởi động:** Độ trễ sẵn sàng khi nạp lạnh (Cold), nạp nóng từ cache (Warm) và qua mạng di động Slow 3G.
4. **Độ bền vững OPFS (Persistence):** Kiểm tra khả năng lưu trữ qua Origin Private File System (`opfs-sahpool`) có bảo toàn 100% dữ liệu sau khi reload trang hay không.
5. **Quyết định Go / No-Go:** Đưa ra kết luận có căn cứ số liệu khoa học.

---

## 2. Cấu Trúc Thư Mục

```text
spikes/sqlite-wasm/
├── index.html                  # Giao diện harness trực quan để đo đạc và thao tác thủ công
├── harness.mjs                 # Controller điều phối harness trên luồng giao diện chính (Main Thread)
├── harness-worker.mjs          # Web Worker chạy SQLite WASM độc lập (nạp VFS OPFS SAHPool/In-memory)
├── measure.mjs                 # Script tự động hóa toàn diện qua Playwright (kèm mini HTTP server COOP/COEP)
├── last-run.json               # Kết quả số đo mới nhất dạng JSON máy đọc được
├── last-run.log                # Nhật ký console chi tiết thời gian chạy từng bước
├── screenshot-harness.png      # Ảnh chụp màn hình giao diện harness với kết quả đo thực tế
├── vendor/                     # Bản phân phối module SQLite WASM chính thức (@sqlite.org/sqlite-wasm v3.47.2)
│   ├── index.mjs               # ES module wrapper & API bindings
│   ├── sqlite3.wasm            # Binary WebAssembly của SQLite core
│   ├── sqlite3.mjs             # Runtime helper
│   ├── sqlite3-worker1.mjs     # Worker1 API wrapper
│   └── sqlite3-opfs-async-proxy.js # Proxy cho OPFS cổ điển
└── README.md                   # Tài liệu hướng dẫn này
```

---

## 3. Hướng Dẫn Chạy Đo Tự Động (Automated Benchmark)

Script `measure.mjs` khởi tạo một HTTP server cục bộ với cấu hình nén gzip (giống CDN thật), thiết lập đầy đủ headers bảo mật `COOP`/`COEP` và điều khiển Google Chrome thật thông qua Playwright để tự động chạy qua toàn bộ 8 kịch bản đo đạc.

### Yêu cầu tiên quyết:
- Đã cài đặt dependencies của dự án tại thư mục `web/` (đã có sẵn `playwright`).
- Hệ thống đã cài Google Chrome thật hoặc Chromium browser của Playwright.

### Lệnh thực thi:
Từ thư mục gốc của repository (hoặc trong worktree `Task131`), chạy lệnh:

```bash
node spikes/sqlite-wasm/measure.mjs
```

Sau khi chạy xong:
- Toàn bộ kết quả số đo chi tiết sẽ được in ra console dạng JSON.
- Tệp `spikes/sqlite-wasm/last-run.json` và `spikes/sqlite-wasm/last-run.log` sẽ ghi lại dữ liệu đo đạc mới nhất.
- Tệp `spikes/sqlite-wasm/screenshot-harness.png` sẽ được tự động chụp lại từ giao diện harness.

---

## 4. Hướng Dẫn Chạy & Đo Thủ Công Trên Trình Duyệt Thật

Bạn có thể mở giao diện `index.html` trực tiếp trên bất kỳ trình duyệt nào để kiểm tra tương tác và số đo thủ công.

### Yêu cầu bắt buộc về HTTP Headers:
SQLite WASM với VFS `opfs-sahpool` (SyncAccessHandle Pool) và API `performance.measureUserAgentSpecificMemory()` **bắt buộc** browsing context phải ở trạng thái `crossOriginIsolated = true`. Máy chủ HTTP phục vụ file phải trả về các headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

### Các cách khởi động server thủ công:

#### Cách 1: Sử dụng server tích hợp sẵn trong `measure.mjs`
Chạy server Node.js phục vụ thư mục spikes với COOP/COEP headers:
```bash
node -e "import('./spikes/sqlite-wasm/measure.mjs')"
```

#### Cách 2: Sử dụng công cụ `serve` / `http-server` hoặc Python có custom headers
Nếu sử dụng công cụ phục vụ tĩnh bất kỳ, hãy đảm bảo inject đủ 2 headers `Cross-Origin-Opener-Policy: same-origin` và `Cross-Origin-Embedder-Policy: require-corp`.

Sau đó truy cập vào địa chỉ:
```text
http://127.0.0.1:4173/?autostart=1
```
*(Thêm `&memory=1` nếu muốn ép buộc sử dụng In-Memory VFS thay vì OPFS)*.

---

## 5. Giải Thích Giao Diện & Các Nút Bấm Trên Harness

Giao diện `index.html` được thiết kế tối giản, trực quan phục vụ việc đo đạc:

### 5.1. Khối "Trạng thái" (Status Panel)
- **VFS:** Hiển thị loại File System đang hoạt động (`opfs-sahpool (OPFS có sẵn)` hoặc `memory (không có OPFS)`).
- **Số dòng:** Tổng số bản ghi hiện có trong bảng CSDL `metrics`.
- **Status text:** Thông báo tiến trình thực thi (ví dụ: `Đang chèn 500.000 dòng...`).

### 5.2. Khối "Thao tác" (Action Controls)
- **Nạp DB (`#btn-init`):** Khởi tạo Web Worker, tải WebAssembly binary và thiết lập kết nối CSDL SQLite với VFS phù hợp.
- **Tạo bảng (`#btn-reset`):** Thực thi DDL tạo bảng `metrics` (`id INTEGER PRIMARY KEY, k INT, v TEXT, payload TEXT, created_at TEXT`).
- **Chèn 10k (`#btn-10k`):** Chèn 10.000 bản ghi bằng transaction theo lô (batch insert), đo thời gian hoàn thành tính bằng milliseconds.
- **Chèn 100k (`#btn-100k`):** Chèn 100.000 bản ghi, kiểm tra độ ổn định bộ nhớ.
- **Chèn 500k (`#btn-500k`):** Chèn 500.000 bản ghi (ngưỡng cực đại trong quy ước của SQLLens).
- **SELECT đếm (`#btn-count`):** Chạy truy vấn `SELECT COUNT(*) FROM metrics` để xác thực toàn vẹn dữ liệu.
- **Xuất file (`#btn-export`):** Trích xuất toàn bộ CSDL nhị phân SQLite dưới dạng `Uint8Array` và tính toán dung lượng MB của tệp `.sqlite`.
- **Đo RAM (`#btn-memory`):** Kích hoạt đo lường đồng thời cả bộ nhớ WebAssembly Heap trong Worker và Page Agent RAM qua `performance.measureUserAgentSpecificMemory()`.

### 5.3. Khối "Nhật ký" (Console Log)
Hiển thị timestamp chi tiết từng thao tác, thời gian tải module, thời gian chèn từng đợt, dung lượng file xuất và chi tiết bộ nhớ RAM.
