# Task166 — WebRTC DataChannel: Broadcast kết quả P2P + cảnh báo NAT

Thuộc: SP024 / STR114
Mục tiêu: Broadcast kết quả thực thi SQL qua WebRTC DataChannel P2P (`RoomCollabProvider` kênh control), tự động trả Baton về Host sau 30 giây khi Driver mất kết nối, và hiển thị banner cảnh báo Symmetric NAT sau 10 giây nếu WebRTC kết nối thất bại.
Phạm vi: `web/src/modules/room/p2p/` (mới: `types.ts`, `result-broadcaster.ts`, `result-broadcaster.test.ts`), `web/src/modules/room/components/nat-warning-banner.tsx` (mới) + `nat-warning-banner.test.tsx`, `web/messages/{vi,en}/room.json` (mục `p2p.*`), `web/src/app/[locale]/e2e-p2p/` (harness Playwright mới), `web/e2e/room-p2p.spec.ts` (mới).
Không làm: Không sửa `api/`, không sửa `web/src/modules/share/`, `web/src/modules/arena/`, `web/messages/*/share.json`, `web/messages/*/arena.json`, không gửi byte SQL nào qua WebSocket `/signal`.

## Hợp đồng

- Hằng số bắt buộc:
  - `BATON_RETURN_TIMEOUT_MS = 30_000` (30 giây mất heartbeat/kết nối của Driver → phát `{ type: "baton-returned", holder: ownerId }` và trả Baton về `ownerId`).
  - `NAT_WARNING_TIMEOUT_MS = 10_000` (10 giây kết nối WebRTC không mở được → hiển thị `<NatWarningBanner />`).
- `createResultBroadcaster({ sendControl, onControl, ownerId, returnTimeoutMs?, heartbeatIntervalMs? })`:
  - `broadcastResult(result: P2pExecutionResult)`: gửi payload kết quả P2P (`columns`, `rows`, `rowCount`, `durationMs`, `error?`, `tabId`, `executedBy`, `sentAt`) qua kênh control DataChannel (tuyệt đối không qua WebSocket `/signal`).
  - `onResult(cb)`: nhận kết quả P2P ở Viewer/Editor.
  - `recordDriverHeartbeat()` / `handleDriverDisconnected()` / `onBatonReturned(cb)`: đếm timeout `returnTimeoutMs` (mặc định `30_000ms`), hết hạn thì phát `{ type: "baton-returned", holder: ownerId }` và cập nhật store về `ownerId`.
  - `destroy()`: dọn sạch toàn bộ timer và listener.
- `<NatWarningBanner visible={...} />`: hiển thị thông báo song ngữ `vi`/`en`: "Tính năng hoạt động tốt nhất trên cùng mạng LAN hoặc Open NAT." / "Best experienced on the same LAN or Open NAT." khi WebRTC kết nối thất bại sau 10 giây.

## Tiêu chí xong

- AC1: Playwright 2-browser (`web/e2e/room-p2p.spec.ts`): Driver bấm Run → Viewer nhận kết quả P2P trong `< 1s`.
- AC2: **0 byte SQL** qua signaling WebSocket `/signal` trong toàn bộ luồng (unit test kiểm tra mọi frame gửi lên `/signal` không chứa SQL hay payload kết quả).
- AC3: Driver mất kết nối / ngưng heartbeat → sau `30s` (`BATON_RETURN_TIMEOUT_MS = 30_000`) Viewer nhận `{ type: "baton-returned", holder: ownerId }` và Baton trả về `ownerId` (chứng minh bằng fake timers trong unit test + kịch bản E2E).
- AC4: Giả lập Symmetric NAT kết nối thất bại sau `10s` (`NAT_WARNING_TIMEOUT_MS = 10_000`) → `<NatWarningBanner />` hiện cảnh báo đúng (vi/en), không crash UI.
- AC5: `npm run check` PASS, `API_ORIGIN=http://127.0.0.1:8080 npm run build` PASS, `npx playwright test e2e/room-p2p.spec.ts` PASS, 390px không tràn ngang.

## Ca biên

- Gọi `destroy()` trước khi timer 10s hoặc 30s nổ → timer được huỷ sạch, không gọi callback sau khi unmount.
- Message lạ hoặc payload JSON sai định dạng trên kênh control → bỏ qua an toàn, không crash.
- Driver kết nối lại và gửi heartbeat trước mốc 30s → reset bộ đếm, không trả Baton nhầm.
- Harness `e2e-p2p` khớp `isBlockedE2eRoute` trong `web/src/proxy.ts` ở production.

## Kiểm tra

```bash
cd web && npm run check
cd web && API_ORIGIN=http://127.0.0.1:8080 npm run build
cd web && E2E_PORT=3166 npx playwright test e2e/room-p2p.spec.ts
```

## Góc review thêm

- Bảo mật / Core Rule 7: Zero-Log Transit — 0 byte SQL hay dữ liệu kết quả đi qua `/signal` WebSocket.
- Timer cleanup: không rò `setTimeout`/`setInterval` khi unmount.
- Nhãn: **Chưa đo** trên bản deploy mạng thật.

## Đọc thêm

- `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md` §Task166
- `_bmad-output/SP024/STR114/Task164/ban_giao_task164.md`
- `web/src/modules/room/collab/room-provider.ts`
- `web/src/modules/room/collab/baton-store.ts`
