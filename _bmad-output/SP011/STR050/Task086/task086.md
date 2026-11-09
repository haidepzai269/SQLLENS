# Task086: Tranh chấp 2 Connection thật trên MySQL qua SSE & 4 Kịch bản Thực chiến

## 1. Mục tiêu & Bối cảnh
- **Story:** SP011 / STR050 (Tranh chấp 2 connection MySQL).
- **Bối cảnh:**
  - Ở PostgreSQL, phòng Lab dùng state machine mô phỏng logic trong browser mang nhãn `Mô phỏng` (đã đối chiếu golden test CI).
  - Ở MySQL, chúng ta có 2 connection thật (`a` và `b`) kết nối vào cùng container MySQL 8.4 trên Azure VM thông qua Sandbox Agent và Gin backend.
  - Thay vì short-polling gây quá tải mạng và làm cạn kiệt quota Upstash Redis (20 req/phút), hệ thống ứng dụng **SSE (Server-Sent Events)** streaming trực tiếp các sự kiện thay đổi khóa từ `performance_schema.data_lock_waits`, làm nền tảng realtime thống nhất cho cả phòng Lab lẫn AI Mentor/AI Chaos sau này.
  - Thoát ly các bài tập mẫu giáo trình, hệ thống xây dựng **4 kịch bản thực chiến "đắt giá"** phản ánh những bài học xương máu của dân backend: Gap Lock làm tê liệt bảng, Deadlock chuyển khoản ngân hàng, Cuộc chiến Flash Sale (Lost Update) & Chữa bằng `FOR UPDATE`, và Dirty Read ở `READ UNCOMMITTED`.
  - Triệt tiêu hoàn toàn nguy cơ hiểu lầm "thiết kế này ổn" (Nguyên tắc 2) bằng hệ thống Tooltip chuẩn mực giải nghĩa tường minh cho MỌI nhãn kết luận (`Thật`, `Mô phỏng`, `Ước lượng`, `Chưa mô phỏng được`).

---

## 2. Tiêu chí nghiệm thu chi tiết (Acceptance Criteria)

### AC1: Điều phối 2 Connection Thật độc lập trong Container MySQL
- Sandbox agent điều phối 2 connection `a` và `b` độc lập trong cùng một phiên sandbox.
- Mỗi connection duy trì transaction mở dở giữa các bước lệnh (không tự động commit hay đóng socket giữa các request).
- Câu lệnh gửi lên connection A hoặc B được thực thi độc lập, không block luồng xử lý của connection kia.

### AC2: Hạ tầng Realtime SSE Stream & Giám sát Khóa Thời gian Thực
- Cung cấp endpoint stream sự kiện SSE (Server-Sent Events) từ backend: `GET /api/mysql/sessions/:id/events` (kèm fallback đọc `/locks` an toàn).
- Cơ chế stream phát các sự kiện:
  - `:keepalive\n\n` định kỳ (15 giây) để chống ngắt kết nối do proxy idle timeout.
  - `event: lock_change` mang cấu trúc JSON: các cặp chờ khóa trong `data_lock_waits`, các khóa đang giữ trong `data_locks`, và danh tính thread ID của connection `a` và `b`.
  - `event: deadlock` khi MySQL engine phát hiện chu trình khóa và trả về lỗi `1213: Deadlock found`.
  - `event: released` khi transaction commit hoặc rollback giải phóng khóa.
- Phía Frontend: Lắng nghe SSE stream, cập nhật đồ thị Cytoscape và timeline tức thì (< 50ms) mà không cần gửi polling lặp lại nhiều request, bảo vệ 100% quota Upstash Redis.

### AC3: 4 Kịch bản Thực chiến "Đắt giá" & Cơ chế Tự Dọn Dẹp
Hệ thống cung cấp sẵn 4 kịch bản điển hình kèm nút chạy từng bước (Next Step), chạy tự động (Play), và Reset dữ liệu ban đầu:
1. **Kịch bản 1 — "Bí ẩn Gap Lock làm tê liệt bảng" (Next-Key Lock ở REPEATABLE READ):**
   - Session A chạy `UPDATE` trên cột có non-unique index (`WHERE user_id = 10`).
   - Session B chạy `INSERT INTO ... VALUES (user_id = 15)` và bị block do rơi vào Gap Lock `(10, 20)`.
   - Đồ thị Cytoscape và lời giải thích làm sáng tỏ hiện tượng "câu lệnh vô tội bị vạ lây".
2. **Kịch bản 2 — "Deadlock Chuyển tiền Ngân hàng" (Error 1213):**
   - Session A: Chuyển tiền Ví 1 -> Ví 2 (lock Ví 1, chờ Ví 2).
   - Session B: Chuyển tiền Ví 2 -> Ví 1 (lock Ví 2, chờ Ví 1).
   - MySQL engine tự động abort 1 transaction với mã lỗi `1213 (40001)`.
   - Đồ thị Cytoscape chuyển sang màu đỏ rực cảnh báo chu trình Deadlock, session bị ngắt hiển thị viền đỏ đứt nét rõ ràng.
3. **Kịch bản 3 — "Cuộc chiến Flash Sale / Bán âm tồn kho" (Lost Update Race Condition):**
   - Cùng đọc `stock = 1`, cả hai session cùng trừ tồn kho dẫn đến mất mát cập nhật hoặc âm hàng.
   - Minh họa cách chữa bằng kỹ thuật Khóa bi quan (Pessimistic Locking): `SELECT ... FOR UPDATE` khiến Session B xếp hàng chờ văn minh.
4. **Kịch bản 4 — "Đọc bẩn (Dirty Read) ở READ UNCOMMITTED":**
   - Session B hạ mức cô lập xuống `READ UNCOMMITTED`.
   - Session A update dữ liệu nhưng ROLLBACK. Session B trót đọc được dữ liệu rác chưa commit.
   - Đối chiếu bài học nhận thức: vì sao Postgres không bao giờ bị Dirty Read, còn MySQL thì có.
- **Tự dọn dẹp & Reset:** Mỗi kịch bản có script DDL chuẩn bị bảng mẫu (`lab_accounts`, `lab_orders`, `lab_items`) và dữ liệu ban đầu nhỏ (< 50 dòng) để bảo vệ 50MB disk quota của container.

### AC4: Hệ thống Tooltip Tường Minh cho MỌI Nhãn Kết luận
- Bọc toàn bộ các nhãn kết luận trên giao diện (`Thật`, `Mô phỏng`, `Ước lượng`, `Chưa mô phỏng được`) bằng component `Tooltip` của shadcn/ui.
- Nội dung Tooltip song ngữ Vi/En giải thích tường minh: nguồn gốc dữ liệu, độ tin cậy, và **tuyệt đối không mang hàm ý đánh giá thiết kế tốt hay xấu** theo đúng Nguyên tắc cốt lõi 2.
- Nhãn `Thật` giải thích rõ: *"Kết quả được thực thi và đo đạc trực tiếp trên engine database thật (MySQL 8.4 trên Azure VM hoặc PGlite trong Web Worker). Đây là phản ứng vật lý của database, không mang hàm ý đánh giá thiết kế này tốt hay xấu."*

### AC5: Chất lượng Code & Bộ Test Kiểm thử Toàn diện
- Unit tests cho module runner SSE, parser sự kiện khóa, và định nghĩa kịch bản.
- Playwright E2E tests: file `web/e2e/mysql-conflict.spec.ts` kiểm thử đầy đủ luồng tranh chấp MySQL, bắt lock wait, bắt deadlock, kiểm tra tooltip nhãn, chạy trên cả Desktop 1440px và Mobile 390px, song ngữ `/vi` và `/en`.
- `npm run check` (typecheck + lint + unit tests) đạt 100% không lỗi.

---

## 3. Danh sách File Tác động & Tạo mới

### Backend Go (Render & Agent):
- `api/internal/mysql/mysql.go` & `api/internal/mysql/client.go`: Thêm route stream SSE `/mysql/sessions/:id/events` (hoặc proxy stream từ agent) với heartbeat `:keepalive`.
- `sandbox/agent/server.go` & `sandbox/agent/query.go`: Hỗ trợ route stream SSE sự kiện khóa hoặc endpoint long-poll theo dõi `data_lock_waits`.

### Frontend Web:
- `web/src/engines/mysql/conflict-runner.ts` (Tạo mới): Quản lý luồng thực thi 2 connection `a`/`b` và kết nối SSE stream.
- `web/src/engines/mysql/scenarios.ts` (Tạo mới): Định nghĩa 4 kịch bản thực chiến MySQL và script DDL khởi tạo.
- `web/src/engines/mysql/adapter.ts`: Mở rộng adapter hỗ trợ `simulateConflict` cho MySQL.
- `web/src/modules/conflict-sim/ui/conflict-panel.tsx`: Tích hợp phân nhánh hiển thị kịch bản MySQL, kích hoạt SSE runner và nhãn `Thật`.
- `web/src/components/ui/conclusion-badge.tsx` (hoặc component nhãn tương đương): Thêm Tooltip chuẩn hóa cho 4 nhãn.
- `web/messages/vi/conflictSim.json` & `web/messages/en/conflictSim.json`: Bổ sung bản dịch song ngữ cho 4 kịch bản và tooltip nhãn.
- `web/e2e/mysql-conflict.spec.ts` (Tạo mới): Bộ test Playwright E2E tự động.
