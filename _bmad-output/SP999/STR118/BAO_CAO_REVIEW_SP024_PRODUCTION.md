# Báo Cáo Nghiệm Thu Đa Người Dùng SP024 Trên Production Thật

- **Ngày kiểm thử:** 2026-11-25
- **Môi trường:**
  - Frontend: `https://sqllens-bice.vercel.app` (Vercel)
  - Backend: `https://sqllens.onrender.com` (Render)
  - Database: Neon PostgreSQL Production
- **Công cụ:** `agent-browser` với 2 phiên OAuth thật cô lập (`host` tài khoản VIP, `editor` tài khoản non-VIP), kết hợp truy vấn `SELECT` kiểm chứng trực tiếp trên Neon.
- **Nguyên tắc:** Không sửa code; không ghi cookie `sid` hay `DATABASE_URL` vào báo cáo.

---

## Tổng Quan Kết Quả (K1–K7)

| Kịch bản | Tên kịch bản | Kết quả | Tóm tắt ngắn |
|---|---|---|---|
| **K1** | Mời, Gia nhập & Thu hồi quyền | **FAIL (Partial)** | Tạo dự án, lưu Cloud, tạo link mời 24h, Editor gia nhập `/vi/join?token=...` tự mở đúng phòng, Host thấy Editor trong danh sách thành viên; **nhưng `InviteDialog` thiếu UI nút thu hồi quyền**. |
| **K2** | Đồng biên tập Yjs P2P & WebSocket `signal-ticket` | **FAIL** | `POST /signal-ticket` trả `200` và `wss://sqllens.onrender.com/.../signal?ticket=...` mở thành công (`onopen`); **nhưng Yjs không đồng bộ văn bản** vì 2 lỗi: (1) `GET /members` trả `403` cho Editor khiến Editor bị fallback thành `viewer` (`readOnly`), (2) `tabId` khi Editor pull về bị sinh UUID mới khác với `tabId` của Host. |
| **K3** | The Baton thuần P2P DataChannel | **FAIL** | Do lỗi `403 /members` ở trên, Editor bị ép `viewer` nên **mất cả nút Chạy lẫn nút Xin quyền chạy**; không kích hoạt được luồng `<BatonRequestToast />`. Ngoài ra trên Host (chủ phòng) lại **hiện dư nút `Xin quyền chạy`**. |
| **K4** | Broadcast Kết quả P2P & NAT Banner | **BLOCKED (một phần)** | Không test được Editor chạy query phát kết quả P2P sang Host do K3 fail. `<NatWarningBanner />` không hiện sai lúc idle. |
| **K5** | Fork phòng về Local IndexedDB | **PASS** | Editor mở `ForkDialog` → Fork về Local Sandbox thành công; tạo dự án local mới tách biệt hoàn toàn cloud (`roomFork` có, `cloud` không có). |
| **K6** | Deadlock Arena & AI Mentor VIP | **PASS** | Host mở `/vi/arena?roomId=...&role=host` (VIP), Editor mở `/vi/arena?roomId=...&role=viewer` (non-VIP). Host đi Bước 1→4 kịch bản `deadlock_reverse_order`, Cytoscape Wait-For Graph render 3 canvas + 4 màu trạng thái, Editor tự đồng bộ Bước 4/5 trong ≤ 5s. AI Mentor hiện & gọi `POST /api/ai/inline-complete` `200` trên Host, **ẩn** trên Editor. Nhãn **Mô phỏng** hiện đầy đủ. |
| **K7** | Zero-Log Transit trên Neon & Mobile 390px | **PASS** | Neon: `room_invite_tokens` và `room_baton` không có cột SQL (`0 byte SQL`); `sp024_yjs_live_only_7721` không xuất hiện trong `cloud_tabs` (`yjs_leak_tabs=0`), `sp024_probe_9941` xuất hiện `1` dòng. Viewport `390x844` trên `/vi/arena`, `/vi` Lab và `InviteDialog` đều `scrollWidth (390) <= innerWidth (390)`. |

---

## Chi Tiết Từng Kịch Bản

### K1 — Mời, Gia nhập & Thu hồi quyền (`FAIL — thiếu UI thu hồi quyền`)
- **URL thực tế:** `https://sqllens-bice.vercel.app/vi` → `https://sqllens-bice.vercel.app/vi/join?token=dHsG9gBXE7V6yzPEAFH4sGpJvWW_TEFPIsmc0Jwk9rA` → `https://sqllens-bice.vercel.app/vi`
- **Bước thực hiện & Bằng chứng:**
  1. `host` tạo dự án `[TEST-SP024] Review Room`, gõ `CREATE TABLE sp024_probe_9941(id int);`, bấm **Lưu vào Cloud** (`POST /api/v1/cloud/projects` → `201`, `remoteId = 5e50543f-3712-4772-a24a-94bc0bdebca3`).
  2. `host` mở `InviteDialog`, bấm **Tạo liên kết mời** (`POST .../invite` → `200`), nhận link `/vi/join?token=...` có hạn 24h với vai trò biên tập.
  3. `editor` mở link `/vi/join?token=...`, bấm **Tham gia phòng** → tự chuyển về `/vi`, mở đúng dự án `[TEST-SP024] Review Room` kèm nội dung `CREATE TABLE sp024_probe_9941(id int);`.
  4. `host` mở lại `InviteDialog`, danh sách **Thành viên** hiển thị đủ 2 người: `Hải Nguyễn Hoàng (bạn) — Chủ phòng` và `Hải Nguyễn Hoàng — Biên tập`.
- **Lỗi phát hiện:**
  - **LỖI K1-1:** Trong `InviteDialog`, danh sách thành viên chỉ hiển thị tên và vai trò dạng text tĩnh, **không có nút thu hồi quyền / xóa thành viên** (dù backend có endpoint `DELETE /members/:uid`).

### K2 — Đồng biên tập Yjs P2P & WebSocket `signal-ticket` (`FAIL`)
- **Bước thực hiện & Bằng chứng:**
  1. Cả `host` và `editor` đều gọi `POST /api/v1/cloud/projects/5e50543f-3712-4772-a24a-94bc0bdebca3/signal-ticket` → `200`.
  2. Kiểm tra mở trực tiếp `WebSocket` tới `wss://sqllens.onrender.com/api/v1/cloud/projects/5e50543f-3712-4772-a24a-94bc0bdebca3/signal?ticket=...` từ phiên `host` trả về `status: "open"` (`onopen` thành công).
  3. `host` gõ thêm dòng `-- sp024_yjs_live_only_7721` (không bấm Lưu Cloud). Sau >2.5s, editor của `editor` vẫn chỉ có `CREATE TABLE sp024_probe_9941(id int);`.
  4. Thử gõ trên `editor` không thay đổi nội dung; `document.querySelector('.cm-content')?.getAttribute('contenteditable')` trên `editor` trả về `"false"`.
- **Lỗi phát hiện (2 lỗi gốc rễ):**
  - **LỖI K2-1 (`403 /members` ép Editor thành Viewer):** Network log trên `editor` ghi nhận `GET /api/v1/cloud/projects/5e50543f-3712-4772-a24a-94bc0bdebca3/members` trả về **`403`**. Trong `use-lab-room-collab.ts`, khi `!res.ok`, `fetchRoomMembers` rơi về `fallback` với `myRole: "viewer"`, làm CodeMirror của Editor bị khóa `readOnly` (`contenteditable="false"`).
  - **LỖI K2-2 (Lệch `tabId` giữa Host và Editor):** Đọc IndexedDB `sqllens-workspace` cho thấy `tabId` của dự án `[TEST-SP024] Review Room` trên `host` là `6bf3b0d9-aaa7-4e7f-b35d-a11bdabe07b4`, trong khi trên `editor` sau khi pull là UUID mới `8a01e917-46b8-4610-9058-dc590606be64`. Do `createTabCollabExtension` gắn `Y.Text` theo `activeTabId` local nên 2 peer không đồng bộ vào cùng `Y.Text`.

### K3 — The Baton thuần P2P DataChannel (`FAIL`)
- **Bước thực hiện & Bằng chứng:**
  1. Trên `editor`, vì bị lỗi K2-1 ép thành `myRole: "viewer"`, cả nút **Chạy** (`[data-testid="lab-run-button"]`) và nút **Xin quyền chạy** đều bị ẩn; không thể bấm Xin quyền để kích hoạt `<BatonRequestToast />` trên `host`.
  2. Trên `host` (Chủ phòng), snapshot ghi nhận **hiện đồng thời** cả `button "Chạy"` lẫn `button "Xin quyền chạy"` (`reqDisabled: false`).
- **Lỗi phát hiện:**
  - **LỖI K3-1:** Hệ quả từ lỗi K2-1 khiến `editor` mất toàn bộ UI Baton (`Chạy` disabled + tooltip, `Xin quyền chạy`).
  - **LỖI K3-2:** Trên `host` (owner đang giữ Baton / chủ phòng), nút `Xin quyền chạy` vẫn hiển thị ở trạng thái enabled thay vì ẩn đi.

### K4 — Broadcast Kết quả P2P & NAT Banner (`BLOCKED`)
- **Bằng chứng:**
  - Không thể cho `editor` giữ Baton và chạy query PGlite để kiểm tra broadcast P2P sang `host` do K3 fail.
  - Quan sát trong suốt phiên bình thường: `<NatWarningBanner />` không hiển thị nhầm.

### K5 — Fork phòng về Local IndexedDB (`PASS`)
- **Bước thực hiện & Bằng chứng:**
  1. Trên `editor`, bấm nút **Fork về máy** → mở modal `Fork phòng sang Local Sandbox` → bấm **Fork về Local Sandbox**.
  2. Toast hiển thị: `"Đã fork 1 tab về Local Sandbox"`.
  3. Kiểm tra IndexedDB `sqllens-workspace`: xuất hiện dự án mới `id = 1c7bb654-c70c-48a5-8e58-bb1fdb06e7ac`, tên `"[TEST-SP024] Review Room — Fork 2026-11-25 14:09"`, có `roomFork: { forkedAt: 1795615786021, projectId: "5e50543f-3712-4772-a24a-94bc0bdebca3" }` và **không có** trường `cloud` (tách biệt cloud).

### K6 — Deadlock Arena & AI Mentor VIP (`PASS`)
- **URL thực tế:**
  - `host`: `https://sqllens-bice.vercel.app/vi/arena?roomId=5e50543f-3712-4772-a24a-94bc0bdebca3&role=host`
  - `editor`: `https://sqllens-bice.vercel.app/vi/arena?roomId=5e50543f-3712-4772-a24a-94bc0bdebca3&role=viewer`
- **Bằng chứng:**
  1. `host` thấy đủ 5 kịch bản, nhãn **Mô phỏng**, các nút điều khiển bước và nút **Phân tích với AI Mentor**.
  2. `editor` (`role=viewer`, non-VIP) thấy nhãn **Mô phỏng**, thông báo `"Đang đồng bộ bước từ Host mỗi 3 giây (chỉ xem)."`, **ẩn** nút điều khiển bước và **ẩn** hoàn toàn AI Mentor.
  3. `host` chọn kịch bản `Deadlock do cập nhật ngược thứ tự`, bấm **Bước sau** 3 lần lên `Bước 4 / 5` (`deadlock detected (40P01)`). Đồ thị Wait-For Graph render `3` `<canvas>` cùng 4 chú giải màu (`Đang chạy`, `Đang chờ khóa`, `Bị hủy (Aborted)`, `Chờ`).
  4. Sau 5s, `editor` tự động cập nhật sang `BƯỚC HIỆN TẠI: 4` (`deadlock detected (40P01)`).
  5. `host` bấm **Phân tích với AI Mentor** → `POST /api/ai/inline-complete` trả `200`, hiển thị khung `PHÂN TÍCH TỪ AI MENTOR` kèm nhãn **Mô phỏng** và nội dung giải thích deadlock.

### K7 — Zero-Log Transit trên Neon & Mobile 390px (`PASS`)
- **Bằng chứng Neon PostgreSQL (chạy `SELECT` trực tiếp):**
  - `room_invite_tokens` (`1` dòng): cột `[token_hash:bytea, project_id:uuid, role:text, expires_at:timestamp with time zone]` → **0 byte SQL**.
  - `room_baton` (`1` dòng): cột `[project_id:uuid, holder_id:uuid, updated_at:timestamp with time zone, arena_step:integer]` → **0 byte SQL**.
  - `cloud_tabs` (`[id:uuid, project_id:uuid, name:text, sql:text, position:integer, updated_at:timestamp with time zone]`):
    - `SELECT count(*) FROM cloud_tabs WHERE sql LIKE '%sp024_yjs_live_only_7721%'` → **`0`** (nội dung gõ live P2P không bấm Push cloud không lọt lên DB).
    - `SELECT count(*) FROM cloud_tabs WHERE sql LIKE '%sp024_probe_9941%'` → **`1`** (chỉ có bản chủ động Lưu vào Cloud ở K1).
- **Bằng chứng Mobile `390x844`:**
  - `/vi/arena`: `scrollWidth = 390`, `innerWidth = 390` (`ok: true`).
  - `/vi` (Lab): `scrollWidth = 390`, `innerWidth = 390` (`ok: true`).
  - `InviteDialog` trên `/vi`: `docScrollW = 390`, `innerWidth = 390` (`ok: true`).

---

## Danh Sách Lỗi Cần Khắc Phục Trước Khi Chốt SP024

1. **[Chí mạng] `GET /api/v1/cloud/projects/:id/members` trả `403` cho thành viên (`editor`/`viewer`)**: khiến `fetchRoomMembers` fallback về `myRole: "viewer"`, khóa `readOnly` Editor và vô hiệu hóa toàn bộ luồng đồng biên tập K2 + The Baton K3. Cần cho phép thành viên trong phòng đọc danh sách thành viên (hoặc trả vai trò của chính mình qua endpoint riêng / `members`).
2. **[Chí mạng] Lệch `tabId` khi `pullProject` tạo UUID mới**: Editor pull dự án về tạo `tabId` khác Host nên `createTabCollabExtension` gắn `Y.Text` theo `activeTabId` local không khớp với Host. Cần giữ đồng bộ `tabId` chuẩn theo `cloud_tabs.id` hoặc ánh xạ khóa `Y.Text` nhất quán giữa các peer.
3. **[Trung bình] Nút `Xin quyền chạy` hiển thị trên Host (Owner)**: Cần kiểm tra điều kiện hiển thị nút `Xin quyền chạy` khi `myRole === 'owner'` hoặc `holderId === userId`.
4. **[Trung bình] `InviteDialog` thiếu nút thu hồi quyền thành viên**: Backend đã có `DELETE /members/:uid` nhưng UI `InviteDialog` chưa có nút thu hồi/xóa thành viên khỏi phòng.
