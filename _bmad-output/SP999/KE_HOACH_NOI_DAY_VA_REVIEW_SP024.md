# Kế hoạch Cắm dây Production & Review Đa Người Dùng SP024

> **Ngày lập:** 2026-11-25 (chốt trong phiên Party Mode)
> **Phạm vi:** `SP999 / STR118` — Cắm dây toàn bộ mảnh hở của SP024 lên Production (`Vercel` + `Render` + `Neon`), sau đó dùng sub-agent đóng vai nhiều người dùng thật để nghiệm thu toàn trình.
> **Trạng thái:** Đã chốt phương án, chờ băm Task & triển khai Chặng 1.

---

## 1. Quyết định đã chốt (2026-11-25)

1. **Thứ tự thực hiện:** Cắm dây các lỗ hổng/mảnh hở của SP024 lên Production **trước**, sau đó mới thả sub-agent vào đo và review cho công bằng.
2. **3 luồng Baton ghi nợ từ Task164 (`/baton/request`, `/baton/grant`, `/baton/heartbeat`):** **KHÔNG viết REST** lên Gin. Giữ gọn thuần **WebRTC DataChannel P2P** để tiết kiệm tối đa request Render; chỉ giữ `GET /api/v1/cloud/projects/:id/baton` và `POST /api/v1/cloud/projects/:id/baton/claim` đã có cho bước khởi tạo và cứu hộ (recovery).
3. **Công cụ Review Test cho sub-agent:** **Hybrid nhẹ** để tối ưu token và quota:
   - **Tầng tương tác nhiều người dùng (UI/UX/Flow):** `vercel-labs/agent-browser` (Rust CLI + persistent Node daemon qua CDP). Dùng `snapshot -i` (Accessibility Tree gắn `@e1`, `@e2`...) để giảm 4x–15x token so với Playwright MCP, chạy nhiều session cô lập song song (`--session host`, `--session editor`, `--session viewer`).
   - **Tầng kiểm chứng ngầm:** Lệnh kiểm tra stdout log Render/Gin và truy vấn bảng Neon để chứng minh **Zero-Log Transit** (0 byte SQL rời máy vào DB/log server).
4. **Môi trường kiểm thử:** **Production thật** đã deploy trên **Vercel** (`https://sqllens-bice.vercel.app`) và **Render** (`https://sqllens.onrender.com`). Vì production dùng OAuth (Google/GitHub), Admin sẽ đăng nhập sẵn 2–3 tài khoản thật vào các session cô lập của `agent-browser` (lưu state ở máy local, gitignored) để sub-agent vận hành như người dùng thật.

---

## 2. Mục tiêu thực sự của SP024 (Chuẩn đối chiếu nghiệm thu)

- **Tầng 2 — Pair-Programming + The Baton + P2P Broadcast + Fork:**
  - Host tạo phòng (cloud project) và sinh link mời 24h theo vai trò (`editor` / `viewer`).
  - Thành viên mở link `/[locale]/join?token=...`, đăng nhập OAuth, gia nhập phòng và tự mở đúng dự án trong Lab.
  - Nhiều người cùng biên tập SQL theo thời gian thực qua **Yjs trên WebRTC DataChannel P2P** (`viewer` ở chế độ chỉ đọc `readOnly`).
  - **The Baton:** Tại một thời điểm chỉ 1 người giữ Baton được bấm Chạy (PGlite local); người khác bấm Xin quyền → Host/Holder nhận toast chấp nhận/từ chối qua P2P DataChannel; kết quả chạy được broadcast P2P cho mọi người trong phòng; tự trả Baton sau 30s; hiện `<NatWarningBanner />` nếu ICE failed / quá 10s không kết nối được peer.
  - **Fork:** Thành viên có thể fork phòng về Local IndexedDB (trần **512KB UTF-8**, tối đa **5 phòng fork**).
  - **Zero-Log Transit:** **0 byte SQL** của người dùng lưu vào Neon và **0 dòng log SQL** trong Gin/Render.
- **Tầng 3 — Deadlock Arena:**
  - Host bấm nút Arena trên Stage → `/[locale]/arena?roomId=...&role=host`; Viewer mở cùng phòng với `role=viewer`.
  - Chọn đủ 5 kịch bản `conflict-sim`, đồ thị Cytoscape Wait-For Graph hiển thị 4 màu trạng thái + vòng deadlock, Host chuyển bước → Viewer tự đồng bộ sau tối đa **3 giây** (polling 3s, ~100 req/5 phút dưới trần `CloudSync`).
  - **AI Mentor** chỉ hiển thị khi `isVip === true`, chỉ gửi ngữ cảnh `conflict-sim` (0 byte SQL workspace).
  - Nhãn **Mô phỏng** bắt buộc xuất hiện ở mọi màn hình Arena.

---

## 3. Chặng 1 — Cắm dây Production (`SP999 / STR118`)

### Mảnh 1: Đường WebSocket `/signal` xuyên Vercel ↔ Render
- **Vấn đề hiện tại:** `web/src/modules/room/collab/room-provider.ts:45-53` dựng URL WebSocket theo `window.location.host` (domain Vercel). Vercel rewrites **không hỗ trợ proxy `Upgrade: websocket`**, còn gọi thẳng `wss://sqllens.onrender.com` thì cross-origin không gửi kèm cookie `sid`.
- **Hướng cắm dây:**
  1. Gin thêm endpoint `POST /api/v1/cloud/projects/:id/signal-ticket` (sau `RequireUser` + kiểm tra thành viên phòng) cấp ticket 1-lần-dùng sống 30 giây (lưu in-memory trên Gin).
  2. `GET /api/v1/cloud/projects/:id/signal` (hoặc `/v1/.../signal`) chấp nhận xác thực bằng `?ticket=...` (tái sử dụng kiểm tra quyền phòng) bên cạnh cookie `sid` cho local dev.
  3. Frontend lấy ticket qua Vercel rewrite (có cookie `sid`), rồi mở WebSocket thẳng tới `NEXT_PUBLIC_WS_ORIGIN` (`wss://sqllens.onrender.com/.../signal?ticket=...`).

### Mảnh 2: Nối Yjs P2P + Baton + ResultBroadcaster vào `lab-workspace.tsx`
- **Vấn đề hiện tại:** `lab-workspace.tsx` mới đọc `useBatonStore` và render `<BatonRequestToast />` + `<NatWarningBanner />`, chưa khởi tạo `createRoomCollabProvider`, `createTabCollabExtension`, `createResultBroadcaster`, và chưa có nguồn phát `setNatWarning` (dòng nợ Task172 trong `SP999/README.md`).
- **Hướng cắm dây:**
  1. Khi dự án active có `cloud.remoteId`, khởi tạo `RoomCollabProvider` + gắn `createTabCollabExtension` vào CodeMirror cho từng tab + đồng bộ `useBatonStore` (`setRoom`, `setMemberNames`, `syncFromServer`, `setTransport`).
  2. Khởi tạo `createResultBroadcaster` qua kênh control DataChannel P2P: phát kết quả chạy P2P, tự trả Baton sau 30s, nối sự kiện ICE failed / timeout 10s vào `setNatWarning(true/false)`.
  3. Khóa luồng Baton **thuần P2P DataChannel** cho `requestBaton` / `grantBaton` / `returnBaton` (không gọi 3 REST endpoint chưa tồn tại).
  4. Dọn vòng đời (`dispose` provider/broadcaster khi đổi dự án hoặc rời Lab).

### Mảnh 3: Hạ tầng Neon & Deploy Vercel / Render
- Xác minh Migration `006_live_rooms.sql` và `007_room_api.sql` đã chạy trên Neon Production thật.
- Áp dụng `REVOKE CREATE ON SCHEMA public FROM PUBLIC` trên Neon thật (mục treo từ `SP999/README.md:166`).
- Cấu hình biến môi trường `NEXT_PUBLIC_WS_ORIGIN=wss://sqllens.onrender.com` trên Vercel và deploy sạch cả FE (Vercel) lẫn BE (Render).

---

## 4. Chặng 2 — Bản Review Test Đa Người Dùng cho Sub-Agent (`agent-browser` Hybrid)

### 4.1. Chuẩn bị môi trường & phiên đăng nhập
1. Cài đặt `vercel-labs/agent-browser` CLI trên máy chạy review (`npm i -g agent-browser` hoặc `npx`).
2. Tạo thư mục state local gitignored (ví dụ `.tmp/review-sessions/`) — **tuyệt đối không commit cookie/session**.
3. Admin mở trình duyệt qua `agent-browser` ở chế độ hiển thị, đăng nhập OAuth thật vào:
   - `--session host`: Tài khoản chính (VIP, đóng vai chủ phòng).
   - `--session editor`: Tài khoản phụ 1 (đóng vai thành viên `editor`).
   - `--session viewer` *(tuỳ chọn nếu có tài khoản thứ 3)*: Tài khoản phụ 2 (đóng vai `viewer`).

### 4.2. Bộ 7 Kịch bản Kiểm thử Người Dùng Thật trên Production

| Mã | Tên kịch bản | Session tham gia | Kỳ vọng PASS |
|---|---|---|---|
| **K1** | **Mời, Gia nhập & Thu hồi quyền** | `host`, `editor` | Host tạo/đẩy dự án cloud → mở `InviteDialog` tạo link 24h → Editor mở link `/vi/join?token=...` → tự mở đúng dự án → Host thấy Editor trong danh sách → Host thử thu hồi quyền và mời lại. |
| **K2** | **Đồng biên tập SQL Yjs P2P** | `host`, `editor`, `viewer` | Host gõ `CREATE TABLE t(id int);` → Editor thấy chữ xuất hiện real-time trên editor của mình; Editor sửa tiếp → Host thấy theo; Viewer bị khóa `readOnly`, không sửa được. |
| **K3** | **The Baton thuần P2P DataChannel** | `host`, `editor`, `viewer` | Lúc đầu Host giữ Baton → nút Chạy của Editor bị disable kèm tooltip tên Host. Editor bấm Xin quyền → Host thấy `<BatonRequestToast />` và bấm Cho phép → Editor chạy được query trên PGlite local. Viewer không thấy nút Xin quyền/Chạy. Test thêm nút `claimBaton` (cứu hộ) của Host. |
| **K4** | **Broadcast Kết quả P2P, Auto-return 30s & NAT Banner** | `host`, `editor` | Khi Editor giữ Baton và bấm Chạy → Host nhận kết quả bảng/log qua DataChannel P2P. Chờ 30s không thao tác → Baton tự trả về Host. Thử ngắt mạng / chặn ICE → `<NatWarningBanner />` bật sau 10s. |
| **K5** | **Fork phòng về Local IndexedDB** | `editor` | Editor mở `ForkDialog` → Fork phòng về máy → xuất hiện dự án local mới tách biệt cloud (`0 byte SQL` gửi lên server). Kiểm tra biên: nội dung > 512KB UTF-8 bị chặn kèm số byte thật; tạo đủ 5 phòng fork thì lần thứ 6 bị khóa. |
| **K6** | **Deadlock Arena & AI Mentor VIP** | `host` (VIP), `viewer` (non-VIP) | Host bấm nút Arena trên Stage → `/vi/arena?roomId=...&role=host`. Viewer mở cùng `roomId` với `role=viewer`. Host chọn `deadlock_reverse_order` và bấm Bước 1→2→3 → đồ thị Cytoscape hiện vòng deadlock, máy Viewer tự đồng bộ sau ≤ 3s. Host (VIP) thấy và gọi được AI Mentor; Viewer (non-VIP) không thấy AI Mentor. Nhãn **Mô phỏng** hiện rõ ở mọi màn hình. |
| **K7** | **Zero-Log Transit & Mobile 390px** | `host`, `editor` + kiểm tra Neon/Render | Sau toàn bộ K1–K6: truy vấn Neon (`cloud_projects`, `cloud_tabs`, `room_invite_tokens`, `room_baton`) và soi log Render xác nhận **0 byte SQL** của phiên Live Room lọt vào DB/log. Mở `InviteDialog`, `/join`, Lab và `/arena` ở viewport `390x844` không tràn ngang. |

### 4.3. Quy chuẩn thực thi & báo cáo cho Sub-Agent
- Sub-agent chỉ dùng `agent-browser snapshot -i` và các lệnh tương tác (`click`, `fill`, `get text`, `wait`) theo từng session; **không** sửa code trong lúc review.
- Mỗi kịch bản K1–K7 phải ghi rõ: `PASS` / `FAIL` / `BLOCKED`, URL thực tế, bước tái hiện ngắn gọn, và bằng chứng rút gọn (không dump cả DOM).

---

## 5. Bảng theo dõi tiến độ

- [x] **Chặng 1.1:** Băm & hoàn thành Task nối WebSocket `signal-ticket` (Gin + Frontend `room-provider.ts`) — **Task173 PASS 100%** (`reviewer-173` nghiệm thu 0 lỗi).
- [x] **Chặng 1.2:** Băm & hoàn thành Task nối Yjs P2P + `ResultBroadcaster` + `natWarning` vào `lab-workspace.tsx` — **Task174 PASS 100%** (`reviewer-174` re-review 0 lỗi, đã nối `requestSignalTicket` + `buildDirectSignalUrl` vào `use-lab-room-collab.ts`).
- [x] **Chặng 1.3:** Xác minh Neon Migration `006/007` + `REVOKE CREATE` + cấu hình `NEXT_PUBLIC_WS_ORIGIN` & deploy Vercel/Render (`a8a0219`, `VERCEL_TICKET_STATUS=401`, `RENDER_TICKET_STATUS=401`, `VERCEL_ARENA_STATUS=200`).
- [x] **Chặng 2.1:** Cài `agent-browser` + Admin nạp 2–3 session OAuth thật (`host` VIP, `editor` thường).
- [x] **Chặng 2.2:** Chạy sub-agent review toàn trình K1–K7 trên Production thật & nghiệm thu báo cáo ([BAO_CAO_REVIEW_SP024_PRODUCTION.md](file:///c:/SQLLens/_bmad-output/SP999/STR118/BAO_CAO_REVIEW_SP024_PRODUCTION.md)): **3 PASS** (K5, K6, K7), **3 FAIL** (K1, K2, K3), **1 BLOCKED** (K4) — phát hiện 4 lỗi thật (`403 /members` cho Editor, lệch `tabId` khi `pullProject`, nút `Xin quyền chạy` dư trên Host, `InviteDialog` thiếu nút thu hồi quyền).
