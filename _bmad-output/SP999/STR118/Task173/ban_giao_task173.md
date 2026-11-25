# Bàn giao Task173: Cắm dây WebSocket `/signal` xuyên Vercel ↔ Render (`signal-ticket`)

- **Epic / Story:** SP999 / STR118 — Cắm dây SP024 lên Production
- **Trạng thái:** Hoàn thành 100% AC1–AC6

## 1. Phạm vi file đã thay đổi / tạo mới
1. `api/internal/httpapi/room_signal.go`
   - Thêm `signalTicketStore` in-memory (`sync.Mutex`, TTL **30 giây**, trần **4096** ticket, dọn rác hết hạn khi cấp mới, sinh token ngẫu nhiên 32 bytes qua `crypto/rand` + `base64.RawURLEncoding`, `consume` kiểm tra phòng + hạn dùng và xóa ngay 1-lần-dùng).
   - Đăng ký `POST /api/v1/cloud/projects/:id/signal-ticket` với `guard` (`RequireUser`): kiểm tra UUID (`400 codeCloudInvalidID`), kiểm tra quyền `canJoin` (`404 codeCloudNotFound` cho người ngoài), trả `200 {"ticket":"...","expiresIn":30}`, 0 byte ticket/SQL trong log.
   - Cập nhật `GET /api/v1/cloud/projects/:id/signal`: bỏ `guard` cứng ở router; khi có `?ticket=...` thì gọi `tickets.consume(ticket, room)` (không hợp lệ → `401 auth_required`) và kiểm tra lại `canJoin`; khi không có `ticket` thì chạy `guard(c)` (cookie `sid`) để giữ tương thích ngược local dev & 16 test Task163.
2. `api/internal/httpapi/room_signal_test.go`
   - Bổ sung `TestRoomSignalTicketIssue`, `TestRoomSignalTicketHandshakeAndOneTime`, `TestRoomSignalTicketExpired`, `TestSignalTicketStoreCapAndPrune`.
3. `web/src/modules/room/collab/signal-ticket.ts` *(tạo mới)*
   - `requestSignalTicket(projectId, fetchImpl)` gọi `POST /api/v1/cloud/projects/${projectId}/signal-ticket` với `credentials: "same-origin"`, `cache: "no-store"`.
   - `buildDirectSignalUrl(projectId, ticket, wsOrigin)` ưu tiên `wsOrigin ?? process.env.NEXT_PUBLIC_WS_ORIGIN`, chuẩn hóa `https://` → `wss://`, `http://` → `ws://`, bỏ trailing slash, fallback `window.location`, gắn `?ticket=...`.
4. `web/src/modules/room/collab/signal-ticket.test.ts` *(tạo mới)*
   - Phủ `NEXT_PUBLIC_WS_ORIGIN` (`https`/`http`/`wss`, trailing slash), fallback `window.location`, và `requestSignalTicket` (`200`, `401`, `404`, payload thiếu `ticket`).
5. `web/src/modules/room/collab/types.ts`
   - Thêm `resolveSignalUrl?: () => Promise<string>` vào `RoomCollabProviderOptions`.
   - Thêm `iceConnectionState?: string` vào `PeerConnectionLike` (giữ nguyên signature `addEventListener`/`removeEventListener` để tương thích ngược `MockPeerConnection` ở các module khác).
   - Thêm `onPeerCountChange` và `onIceFailed` vào `RoomCollabProvider`.
6. `web/src/modules/room/collab/room-provider.ts`
   - Hỗ trợ `resolveSignalUrl` async trong `connect()`, chống race condition bằng `connectSeq`/`connecting` khi `disconnect()` hoặc `destroy()` được gọi giữa chừng.
   - Phát sự kiện `onPeerCountChange` khi peer được thêm/xóa và `onIceFailed` (tối đa 1 lần/peer) khi `connectionState === "failed"` hoặc `iceConnectionState === "failed"`.
7. `web/src/modules/room/collab/room-provider.test.ts`
   - Bổ sung test cho `resolveSignalUrl` async (kể cả hủy bằng `disconnect()` giữa chừng) và `onPeerCountChange` + `onIceFailed`.

## 2. Kết quả kiểm chứng thực tế (AC1–AC6)
- **Backend Go (`go test -p 1 ./internal/httpapi/...` với Postgres 18 `t163-pg` tại `127.0.0.1:54494/app163`):**
  - Chạy `go test -p 1 ./internal/httpapi/... -v` (`RLS_TEST_DSN`): **20/20 test `RoomSignal`/`SignalTicket` + 7/7 test cơ bản PASS** (`9.923s`).
  - Chạy toàn bộ package với cả `RLS_TEST_DSN` & `T150_DATABASE_URL`: **`ok github.com/haidepzai269/SQLLENS/api/internal/httpapi 20.212s`** (PASS 100%, không hồi quy `cloud_projects_test.go` và `live_rooms_test.go`).
- **Frontend (`cd web && npm run check`):**
  - `check:i18n`: PASS.
  - `lint` (`eslint`): PASS (0 errors).
  - `typecheck` (`tsc --noEmit`): PASS (0 errors).
  - `test` (`vitest run`): **138/140 file passed (2 skipped), 1584/1602 tests passed (18 skipped)** trong `282.61s` — trong đó `signal-ticket.test.ts` (3/3 PASS) và `room-provider.test.ts` (8/8 PASS).

## 3. Đối chiếu AC1–AC6
- **AC1:** `TestRoomSignalTicketIssue` PASS (`200` owner/member, `404` người ngoài, `401` chưa đăng nhập, `400` UUID sai).
- **AC2:** `TestRoomSignalTicketHandshakeAndOneTime` & `TestRoomSignalTicketExpired` PASS (`GET /signal?ticket=...` không cần cookie, dùng lại lần 2 → `401`, hết hạn 30s → `401`, sai phòng → `401`, 16 test Task163 vẫn PASS).
- **AC3:** `TestRoomSignalTicketHandshakeAndOneTime` xác minh log Gin không chứa giá trị ticket lẫn `ZZSIGNALSQL`.
- **AC4:** `signal-ticket.test.ts` (3/3 PASS).
- **AC5:** `room-provider.test.ts` (8/8 PASS).
- **AC6:** `go test -p 1 ./internal/httpapi/...` và `npm run check` PASS 100%, đã lập `ban_giao_task173.md`.
