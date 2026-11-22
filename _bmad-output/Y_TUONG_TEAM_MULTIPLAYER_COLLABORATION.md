# ĐỀ XUẤT Ý TƯỞNG & KIẾN TRÚC: SQLLENS TEAM MULTIPLAYER COLLABORATION
## Đưa SQLLens Từ Công Cụ Cá Nhân Thành Nền Tảng Cộng Tác Thời Gian Thực Cho Đội Ngũ Kỹ Thuật Dữ Liệu (Figma & Google Docs Model for Databases)

> **Mã văn kiện:** `Y_TUONG_TEAM_MULTIPLAYER_COLLABORATION.md`  
> **Phiên bản:** 2.5 (Bản chốt kiến trúc toàn diện sau phản biện chiến lược của Sếp Admin: Phân quyền Figma, CDN Caching, Concurrency, Deadlock & Bộ Giải pháp Hiện thực hóa)  
> **Tác giả:** Hội đồng BMAD (Winston - Architect, Amelia - Lead Dev, John - PM, Sally - UX, Mary - BA)  
> **Người phê duyệt phản biện:** Sếp Admin  
> **Ngày cập nhật:** 22/11/2026  
> **Trạng thái:** ĐÃ CHỐT PHƯƠNG ÁN KIẾN TRÚC (Sẵn sàng cho việc lập kế hoạch Epic/Story)  

---

## 1. TỔNG QUAN & TẦM NHÌN SẢN PHẨM (PRODUCT VISION)

### 1.1. Bối cảnh & Nỗi đau hiện tại
Hiện nay, SQLLens đã hoàn thành xuất sắc sứ mệnh của một phòng thí nghiệm SQL cá nhân (SP001 - SP018):
- Cho phép 1 lập trình viên tự học, tự tối ưu hóa query với động cơ PGlite (PostgreSQL WASM) và MySQL Sandbox thật.
- Khám phá cấu trúc vật lý B-Tree, trực quan hóa Execution Plan và mô phỏng tranh chấp khóa (Conflict Simulator).

**Tuy nhiên, trong môi trường doanh nghiệp và đội ngũ phần mềm:**
1. **Thảo luận rời rạc và lỗi thời:** Khi Tech Lead và các Developer muốn review một câu SQL phức tạp, một schema mới hay một kịch bản migration nguy hiểm, họ phải copy-paste qua Slack, chụp ảnh mờ gửi qua Meet, hoặc chạy trên Staging chung làm bẩn dữ liệu.
2. **Onboarding và đào tạo nội bộ tốn kém:** Giải thích cho Junior về Bookmark Lookup, Sequential Scan, Index Skew phải dùng bảng vẽ ngoài hoặc nói chay.

### 1.2. Tầm nhìn: "Figma for Database Engineering"
Biến SQLLens thành **Collaborative Database War Room** — nơi một team (từ 2 đến 100 kỹ sư) có thể:
- Cùng mở chung một phòng làm việc (Live Room).
- Nhìn thấy con trỏ chuột của đồng đội (Multi-cursor Presence).
- Cùng thảo luận trên cùng một sơ đồ B-Tree, sơ đồ Plan đồ họa, hoặc cùng diễn tập kịch bản Deadlock thời gian thực.
- Mở ra con đường thương mại hóa **B2B SaaS (Team/Enterprise Plan)** với mô hình **Free Unlimited Viewers + Paid Editor Seats**.

---

## 2. BÀI HỌC CỐT LÕI TỪ FIGMA: PHÂN QUYỀN RBAC RÕ RÀNG & PHÂN PHỐI QUA CDN

*(Ghi nhận đóng góp xuất sắc của Sếp Admin: Xóa bỏ điểm mù coi mọi người dùng trong phòng là Peer ngang hàng).*

Trong Figma, 90% người dùng trong một tổ chức là **Viewers** (PM, Stakeholders, QA, Developers vào inspect CSS/Tokens), chỉ có 10% là **Editors** (Designers thực thụ). Phân tách rõ ràng hai nhóm này giúp hệ thống đạt hiệu năng vô hạn với chi phí tối thiểu:

| Tiêu chí | Nhóm Editor (Người sửa) | Nhóm Viewer (Người xem) |
| :--- | :--- | :--- |
| **Tỷ lệ trong team** | ~10% (Tech Lead, Senior Dev) | ~90% (Junior Devs, PM, QA, Học viên) |
| **Quyền hạn** | Sửa SQL, tạo Schema, bấm `Run Query`, điều phối phòng | Chỉ xem, thả Emoji, ghim Comment (Annotation) |
| **Hạ tầng kết nối** | Mở kết nối WebSocket/Presence hai chiều tới Multiplayer Coordinator | **Chỉ kéo dữ liệu một chiều qua Edge CDN (Cloudflare/CloudFront)** |
| **Tài nguyên Client** | Chạy Engine (PGlite WASM / Worker) | **0MB WASM Engine!** Chỉ render SVG/DOM tĩnh cực nhẹ |
| **Mô hình tính phí** | **Thu tiền Seat ($15 - $30/tháng)** | **Hoàn toàn MIỄN PHÍ (Unlimited Free Viewers)** |

---

## 3. BẺ CONG CÁC ẢO TƯỞNG CÔNG NGHỆ VÀ TỬ HUYỆT V1

Hội đồng BMAD đã mổ xẻ và bẻ gãy 3 giả định sai lầm nghiêm trọng trong bản thảo ban đầu:

1. **Ảo tưởng "WebRTC P2P 0 đồng cho số đông":**  
   - *Thắt cổ chai băng thông (Host Upstream Saturation):* Nếu phòng có 20 người xem, Host phải upload 20 luồng P2P song song. Một query trả ra 150KB $\rightarrow$ Host phải tải lên 3MB trên mạng nội bộ. Máy Host sẽ lag giật, rớt gói tin ngay lập tức.
   - *Chi phí ẩn của TURN:* 15-20% mạng doanh nghiệp chặn P2P bằng Symmetric NAT, buộc phải relay qua TURN với chi phí băng thông không hề "0 đồng".
2. **Cơn ác mộng "State Drift" khi dùng CRDT Text ngây thơ:**  
   - Text đồng bộ qua Yjs nhưng database thì mỗi máy tự chạy PGlite riêng. Khi Dev A chạy `ALTER TABLE` thêm cột mới, Yjs sync chữ sang Dev B, nhưng PGlite của Dev B chưa từng chạy câu DDL đó $\rightarrow$ Dev B viết câu `INSERT` vào cột mới sẽ lập tức bị crash! Hai người nhìn chung một màn hình text nhưng đứng ở hai thực tại database hoàn toàn lệch nhau.
3. **Ảo tưởng "Broadcast Schema Dump":**  
   - Bấm nút dump DDL/Data gửi qua mạng để đồng bộ PGlite của người khác sẽ làm sập Web Worker của máy nhận nếu dữ liệu lớn, làm mất toàn bộ lịch sử undo/redo và đóng băng giao diện.

---

## 4. ĐÀO SÂU TỬ HUYỆT CONCURRENCY, TRANH CHẤP KHÓA & CÁC KỊCH BẢN DEADLOCK

Khi cho phép nhiều hơn 1 Editor cùng làm việc trên cùng một phòng, hệ thống đối mặt với 5 hiểm họa Concurrency ở tầng Database Engine:

```mermaid
sequenceDiagram
    autonumber
    actor DevA as 🟢 Dev A (Editor 1)
    participant Engine as ⚙️ PGlite / Shared Engine
    actor DevB as 🟠 Dev B (Editor 2)

    Note over DevA, DevB: Kịch bản 1: Cướp Transaction (Session Poisoning)
    DevA->>Engine: BEGIN; UPDATE accounts SET balance = balance - 100 WHERE id = 1;
    Note over Engine: Session đang mở Transaction của Dev A
    DevB->>Engine: INSERT INTO logs VALUES ('done'); COMMIT;
    Note over Engine: Lệnh COMMIT của B vô tình COMMIT luôn lệnh dở dang của A!
    Engine-->>DevA: Transaction đã đóng ngoài ý muốn!

    Note over DevA, DevB: Kịch bản 2: Deadlock vòng tròn (Circular Row Lock)
    DevA->>Engine: UPDATE inventory SET stock = stock - 1 WHERE id = 'A'; (Giữ Lock A)
    DevB->>Engine: UPDATE inventory SET stock = stock - 1 WHERE id = 'B'; (Giữ Lock B)
    DevA->>Engine: UPDATE inventory SET stock = stock + 1 WHERE id = 'B'; (Chờ B nhả)
    DevB->>Engine: UPDATE inventory SET stock = stock + 1 WHERE id = 'A'; (Chờ A nhả)
    Note over Engine: 💥 DEADLOCK PHÁT SINH! Cả 2 máy đều bị treo chờ nhau!
```

### 4.1. Tử huyệt 1: PGlite chỉ có DUY NHẤT 1 Session trong Web Worker (Session Poisoning)
PGlite là mã nguồn C PostgreSQL biên dịch sang WASM đơn luồng, không hỗ trợ multi-connection độc lập trong cùng worker.
- Nếu 2 Editor cùng gửi lệnh: Câu lệnh của người này sẽ lọt thẳng vào transaction dở dang của người kia.
- **Accidental Commit:** Dev A đang mở `BEGIN...` để thử nghiệm, Dev B chạy câu lệnh có `COMMIT` $\rightarrow$ Toàn bộ dữ liệu chưa kiểm tra của Dev A bị commit vĩnh viễn.

### 4.2. Tử huyệt 2: Hàng đợi khóa DDL vs DML làm tê liệt cả phòng (Lock Queue Starvation)
1. Dev A chạy phân tích dài 5s: `SELECT * FROM big_orders` (Giữ `AccessShareLock`).
2. Dev B gõ: `ALTER TABLE big_orders ADD COLUMN status INT;` và bấm Run $\rightarrow$ Yêu cầu `AccessExclusiveLock`. Lệnh bị hoãn, đứng đầu hàng đợi khóa.
3. **Thảm họa:** Để chống đói khóa, Postgres **chặn đứng tất cả các câu `SELECT` tiếp theo của bất kỳ ai trong phòng đụng tới `big_orders`**. Cả phòng bị đóng băng, spinner quay vô tận!

### 4.3. Tử huyệt 3: Kịch bản Deadlock vòng tròn giữa 2 Editor
- Dev A giữ Lock Hàng 1, đòi Lock Hàng 2.
- Dev B giữ Lock Hàng 2, đòi Lock Hàng 1.
- Nếu không xử lý chuẩn tín hiệu ngắt (interrupt) trong Web Worker, event loop JS bị treo cứng, làm đơ toàn bộ tab trình duyệt của Host.

### 4.4. Tử huyệt 4: "Human Deadlock" (Khóa do con người quên COMMIT)
- Dev A mở `BEGIN; SELECT * FROM products FOR UPDATE;` rồi bỏ đi ăn trưa trong 20 phút. Toàn bộ bảng bị khóa chặt, không ai trong phòng có thể làm việc tiếp.

### 4.5. Tử huyệt 5: Xung đột phạm vi chạy (Selection Race Condition)
- Dev A đặt con trỏ ở dòng 1-4 nhấn `Ctrl+Enter` (chạy câu tại con trỏ). Đúng mili-giây đó Dev B bôi đen toàn bộ từ dòng 1-20 nhấn `Ctrl+Enter`. Hai câu lệnh xé rách trạng thái thực thi (Torn Execution State), kết quả trả về bị trộn lẫn.

---

## 5. BỘ GIẢI PHÁP KỸ THUẬT & KIẾN TRÚC ĐÃ CHỐT (THE FINAL BLUEPRINT)

Dưới đây là 5 giải pháp cốt lõi đã được Hội đồng BMAD thống nhất toàn diện để triệt tiêu mọi vấn đề đã nêu:

```mermaid
graph TD
    subgraph EditorsRoom ["KHÔNG GIAN BIÊN TẬP (1-2 Editors)"]
        DevA["🟢 Dev A (Editor 1)"] <-->|Yjs CRDT Text Sync| DevB["🟠 Dev B (Editor 2)"]
        DevA -->|Yêu cầu Run| FloorGate{"🔑 The Floor Token<br>(Ephemeral Lease 3s)"}
        FloorGate -->|Được cấp quyền| RunnerHost["Host Engine (PGlite)"]
        RunnerHost -->|Bọc an toàn| SafeTx["BEGIN ... ROLLBACK<br>idle_timeout = 5s"]
        RunnerHost -->|Tạo Visual Snapshot < 10KB| Emitter["Signal Emitter"]
    end

    subgraph EdgeDistribution ["HẠ TẦNG PHÂN PHỐI DUAL-CHANNEL"]
        Emitter -->|1. SSE Dirty Signal 20 bytes| EdgeBroker["Edge Pub/Sub Broker"]
        Emitter -->|2. HTTP PUT Snapshot| CloudflareCDN["Global Edge CDN Cache (Brotli)"]
        EdgeBroker -->|Broadcast signal| Viewers
    end

    subgraph ViewersSwarm ["NHÓM NGƯỜI XEM (10-100 Viewers)"]
        Viewers["👀 Viewers (Mobile / Laptop)"] -->|3. HTTP GET Snapshot (15ms)| CloudflareCDN
        Viewers -.->|0MB WASM Engine - Tải cực nhẹ| Viewers
    end
```

### 5.1. Cơ chế cấp quyền Run: "The Floor Token" với Ephemeral Heartbeat Lease
- **Nguyên tắc:** Text thì gõ chung tự do (Yjs CRDT), nhưng **Nút Run chỉ duy nhất 1 người được giữ tại một thời điểm**.
- **Cơ chế hoạt động:**
  - Máy chủ Relay/Edge giữ một khóa trạng thái nhẹ: `room:{id}:runner = { userId: "DevA", expiresAt: timestamp + 3000 }`.
  - Khi Dev A bấm Run, client A gửi tín hiệu xin Lease. Trong lúc chạy, mỗi 1 giây client gửi heartbeat gia hạn.
  - Nút Run của Dev B chuyển sang xám kèm avatar của A: *"🟢 Dev A đang chạy (1.2s)..."*.
  - **Chống rớt mạng / kẹt khóa:** Nếu Dev A rớt mạng hoặc tắt tab, sau đúng **3000ms**, Lease tự động hết hạn (TTL Expire), nút Run tự động nhả cho người khác. Không bao giờ có chuyện phòng bị treo vĩnh viễn!

### 5.2. Kiến trúc phân phối Dual-Channel cho Viewers qua CDN
- **Kênh 1 - Tín hiệu (Signaling Channel - ~20 bytes):**  
  Sử dụng Server-Sent Events (SSE) hoặc WebSocket relay cực nhẹ từ Cloudflare Worker. Khi Host chạy xong query, chỉ phát một event tí hon:  
  `{ event: "snapshot_ready", version: 104, hash: "a8f3b" }`.
- **Kênh 2 - Dữ liệu (Data Channel - CDN Caching):**  
  Toàn bộ Viewers nhận tín hiệu sẽ gửi request `HTTP GET /rooms/{id}/snapshots/104.json` đến CDN gần nhất.
  - Snapshot nén bằng **Brotli**, dung lượng cực nhỏ **< 10KB** (chứa: SQL text, Plan AST minified < 40 tokens theo Task119, B-Tree nodes, 10 dòng kết quả mẫu).
  - Tận dụng `Cache-Control: public, max-age=60, s-maxage=300`. Kể cả 100 người cùng xem thì server gốc cũng chỉ tốn đúng 1 lần render của Host, 99 người còn lại rút từ Edge Cache trong 15ms.
  - **0MB WASM:** Trình duyệt Viewer không cần nạp PGlite, xem mượt mà trên cả điện thoại.

### 5.3. Rào chắn Database Engine Watchdog & Auto-Rollback
- **Chống Session Poisoning:** Mọi câu lệnh chạy trong Live Room mặc định được bọc ngầm trong `BEGIN ... ROLLBACK`, timeout tối đa 3000ms. Chỉ có Host bấm nút *"Publish Schema"* thì DDL mới được commit chính thức.
- **Diệt trừ Human Deadlock:** Cưỡng chế cấu hình:  
  `SET idle_in_transaction_session_timeout = '5000ms';`  
  `SET statement_timeout = '3000ms';`  
  Nếu bất kỳ ai mở transaction rồi bỏ đi pha cà phê quá 5 giây, engine tự động hủy câu lệnh, `ROLLBACK` và nhả khóa ngay lập tức!

### 5.4. Trực quan hóa Xung đột & Deadlock (Interactive Deadlock Visualizer)
- Thay vì ném lỗi đỏ thô `ERROR: deadlock detected` khiến người dùng bối rối, SQLLens biến sự cố thành bài học trực quan:
  - Bật giao diện **Split-Screen** highlight 2 câu lệnh gây xung đột của 2 bên.
  - Đồ thị Cytoscape vẽ trực quan đường nối đỏ giữa 2 Transaction và Hàng dữ liệu bị tranh chấp.
  - Cung cấp nút giải cứu: *"Bấm để Abort Transaction của Dev A"* hoặc *"Thử lại với Savepoint"*.

### 5.5. Tách nhánh độc lập: Fork to Local Sandbox (Instant Clone)
- Khi một Editor muốn tự do chạy thử nghiệm các câu lệnh phá hoại dữ liệu (`DROP TABLE`, benchmark vòng lặp lớn):
- Cung cấp nút **"Tách nhánh Sandbox (Fork to Local)"**: Nhân bản toàn bộ schema và dữ liệu hiện tại sang một Web Worker PGlite riêng rẽ trên máy của người đó. Người đó có thể thỏa sức phá hoại mà không ảnh hưởng tới phòng chung.

---

## 6. ĐẶC TẢ GIAO THỨC & DỮ LIỆU (CONTRACT SPECIFICATIONS)

### 6.1. Cấu trúc Visual Snapshot JSON cho CDN (< 10KB)
```json
{
  "room_id": "room_live_9921",
  "version": 104,
  "timestamp": 1732300800000,
  "host": { "id": "u_lead_01", "name": "TechLead" },
  "active_tab": {
    "id": "tab_01",
    "title": "Optimization.sql",
    "sql": "SELECT id, total FROM orders WHERE customer_id = 42;",
    "cursor": { "line": 1, "ch": 35 }
  },
  "execution": {
    "status": "success",
    "duration_ms": 1.4,
    "plan_minified": {
      "node": "IndexScan",
      "relation": "orders",
      "index": "idx_orders_customer",
      "cost": 8.2,
      "rows": 3
    },
    "result_sample": {
      "columns": ["id", "total"],
      "rows": [[101, 250.0], [105, 80.0], [210, 1200.0]],
      "total_rows": 3
    }
  }
}
```

### 6.2. Cấu trúc Lease Token (The Floor Token)
```json
{
  "event": "lease_granted",
  "holder_id": "u_dev_02",
  "holder_name": "Amelia",
  "granted_at": 1732300805100,
  "expires_at": 1732300808100,
  "ttl_ms": 3000
}
```

---

## 7. LỘ TRÌNH TRIỂN KHAI ĐỀ XUẤT (ROADMAP)

1. **Giai đoạn 1 (Spike & MVP - Đề xuất Epic SP024):**
   - Triển khai **Live War Room Presentation** (1 Host - N Viewers).
   - Tích hợp phát tín hiệu SSE siêu nhẹ và phân phối Visual Snapshot qua Cloudflare Edge CDN.
   - Hoàn thành giao diện Viewer siêu nhẹ (0MB WASM, xem Plan/B-Tree mượt trên mobile).
2. **Giai đoạn 2 (Pair-Programming có kiểm soát - Đề xuất Epic SP025):**
   - Tích hợp Yjs Text CRDT trên CodeMirror 6 cho tối đa 2-3 Editors.
   - Hiện thực hóa rào chắn **"The Floor Token"** với Ephemeral Heartbeat Lease 3s.
   - Kích hoạt cơ chế an toàn `idle_in_transaction_session_timeout` và Sandbox Fork.
3. **Giai đoạn 3 (Team Deadlock Arena - Đề xuất Epic SP026):**
   - Đưa tính năng mô phỏng tranh chấp khóa thành trò chơi tương tác đa người dùng.
   - Trực quan hóa Deadlock bằng Cytoscape và AI Mentor phân tích nguyên nhân.
   - Đóng gói thành sản phẩm thương mại B2B cho Doanh nghiệp & Giáo dục.

---

## 8. KẾT LUẬN & SẴN SÀNG BÀN GIAO

Bản thiết kế này đã được hoàn thiện chặt chẽ, giải quyết dứt điểm các nghịch lý kiến trúc và tạo ra lợi thế cạnh tranh áp đảo. Tài liệu đã sẵn sàng để Sếp Admin mang đi thảo luận, phản biện chéo với các phiên Agent khác (Architect, Tech Lead, Security Reviewer).

---
*(Văn kiện lưu trữ vĩnh viễn tại `_bmad-output/Y_TUONG_TEAM_MULTIPLAYER_COLLABORATION.md`).*