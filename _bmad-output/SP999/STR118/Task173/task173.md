# Task173: Cắm dây WebSocket `/signal` xuyên Vercel ↔ Render (`signal-ticket`)

- **Epic / Story:** SP999 / STR118 — Cắm dây SP024 lên Production
- **Mục tiêu:** Giải quyết triệt để vấn đề `window.location.host` trên Vercel không hỗ trợ proxy WebSocket (`Upgrade: websocket`), còn gọi thẳng Render (`wss://sqllens.onrender.com`) bị cross-origin không gửi kèm cookie `sid`. Thêm cơ chế cấp `signal-ticket` 1-lần-dùng (TTL 30s) qua Vercel rewrite rồi mở WebSocket thẳng tới Render, giữ 100% Zero-Log Transit và tương thích ngược với toàn bộ test Task163.

## Phạm vi file (tuyệt đối không chạm ngoài danh sách)
- `api/internal/httpapi/room_signal.go`
- `api/internal/httpapi/room_signal_test.go`
- `web/src/modules/room/collab/signal-ticket.ts` *(tạo mới)*
- `web/src/modules/room/collab/signal-ticket.test.ts` *(tạo mới)*
- `web/src/modules/room/collab/types.ts`
- `web/src/modules/room/collab/room-provider.ts`
- `web/src/modules/room/collab/room-provider.test.ts` *(bổ sung test)*

## Hợp đồng kỹ thuật chi tiết

### 1. Backend Go (`api/internal/httpapi/room_signal.go`)
- Thêm `signalTicketStore` in-memory (`sync.Mutex`, map `ticket -> {uid, room, expiresAt}`):
  - TTL **30 giây**, trần tối đa **4096** ticket đang lưu (dọn rác hết hạn khi cấp mới hoặc khi đầy).
  - Sinh ticket ngẫu nhiên bằng `crypto/rand` (32 bytes, `base64.RawURLEncoding`).
  - `consume(ticket, room) (uid string, ok bool)`: chỉ hợp lệ nếu tồn tại, chưa hết hạn và khớp `room`; xóa ngay lập tức sau khi kiểm tra (1-lần-dùng).
- Đăng ký route mới `POST /api/v1/cloud/projects/:id/signal-ticket` với `guard` (`RequireUser`):
  - Kiểm tra `cloudIDRe.MatchString(room)` → 400 `codeCloudInvalidID`.
  - Kiểm tra `h.canJoin(ctx, uid, room)` → 404 `codeCloudNotFound` nếu không phải owner/member.
  - Cấp ticket và trả `200 {"ticket":"...","expiresIn":30}`.
  - Tuyệt đối **không** log giá trị ticket hay bất kỳ nội dung SQL nào.
- Cập nhật `GET /api/v1/cloud/projects/:id/signal`:
  - Không gắn cứng `guard` ở router vì client cross-origin đi qua `?ticket=...` không có cookie `sid`.
  - Trong `h.signal(c)`:
    - Nếu `ticket := c.Query("ticket"); ticket != ""`: gọi `h.tickets.consume(ticket, room)` → nếu `!ok` trả `401 auth_required`; nếu `ok` lấy `uid` từ ticket và vẫn kiểm tra `h.canJoin` (phòng trường hợp vừa bị thu hồi quyền trong 30s).
    - Nếu không có query `ticket`: chạy `guard(c)` (cookie `sid` như cũ) để giữ 100% tương thích local dev và 16 test Task163; nếu `c.IsAborted()` hoặc `h.uid(c) == ""` thì dừng.

### 2. Frontend TypeScript
- **`web/src/modules/room/collab/signal-ticket.ts`:**
  - `requestSignalTicket(projectId: string, fetchImpl?: typeof fetch): Promise<{ ticket: string; expiresIn: number }>`: gọi `POST /api/v1/cloud/projects/${encodeURIComponent(projectId)}/signal-ticket` với `credentials: "same-origin"`, `cache: "no-store"`. Ném lỗi rõ ràng kèm HTTP status nếu `!res.ok` hoặc payload thiếu `ticket`.
  - `buildDirectSignalUrl(projectId: string, ticket?: string, wsOrigin?: string): string`: ưu tiên `wsOrigin ?? process.env.NEXT_PUBLIC_WS_ORIGIN`; chuẩn hóa `https://` → `wss://`, `http://` → `ws://`, bỏ trailing slash; nếu rỗng thì fallback về `window.location` (`wss:`/`ws:` + `window.location.host`) như cũ; gắn `?ticket=...` nếu có `ticket`.
- **`web/src/modules/room/collab/types.ts` & `room-provider.ts`:**
  - Thêm `resolveSignalUrl?: () => Promise<string>` vào `RoomCollabProviderOptions`. Khi `connect()` được gọi: nếu có `resolveSignalUrl` thì `await` lấy URL trước khi tạo `WebSocket`; nếu `disconnect()`/`destroy()` được gọi trong lúc đang `await` thì bỏ qua, không mở socket.
  - Thêm `onPeerCountChange?: (cb: (count: number) => void) => () => void` và `onIceFailed?: (cb: () => void) => () => void` vào `RoomCollabProvider` (bắn `onIceFailed` khi `pc.connectionState === "failed"` hoặc `iceConnectionState === "failed"`).

## Tiêu chí nghiệm thu (AC1–AC6)
- **AC1:** `POST /signal-ticket` trả `200` cho owner/member, `404` cho người ngoài, `401` khi chưa đăng nhập, `400` khi UUID sai.
- **AC2:** `GET /signal?ticket=...` mở WebSocket thành công không cần cookie; dùng lại ticket lần 2 → `401`; ticket hết hạn → `401`; ticket phòng A dùng cho phòng B → `401`; không có ticket + có cookie vẫn chạy như cũ (16 test cũ PASS).
- **AC3:** Zero-Log Transit: log Gin chứa 0 byte ticket và 0 byte SQL.
- **AC4:** `signal-ticket.test.ts` phủ đủ `NEXT_PUBLIC_WS_ORIGIN` (`https`/`wss`/trailing slash), fallback local, lỗi `401`/`404`.
- **AC5:** `room-provider.test.ts` phủ `resolveSignalUrl` async (kể cả hủy giữa chừng) và `onIceFailed`/`onPeerCountChange`.
- **AC6:** `go test -p 1 ./internal/httpapi/...` và `npm run check` PASS 100%, lập `ban_giao_task173.md` tại `_bmad-output/SP999/STR118/Task173/ban_giao_task173.md`.
