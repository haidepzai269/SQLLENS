# Task164 — Yjs Provider + CodeMirror 6 binding + Baton Store

Thuộc: SP024 / STR114
Mục tiêu: Xây dựng tầng đồng biên tập Yjs P2P (`room-provider.ts`), ràng buộc CodeMirror 6 theo từng tab (`collab-binding.ts`) và Zustand store điều phối The Baton (`baton-store.ts`), kèm đưa `zustand` thành direct dependency trong `web/package.json`.
Phạm vi: `web/package.json`, `web/package-lock.json`, `web/src/modules/room/collab/` (tạo mới: `types.ts`, `room-provider.ts`, `collab-binding.ts`, `baton-store.ts`, `index.ts` và các file test `*.test.ts`).
Không làm: Không sửa `api/`, không sửa `web/src/modules/lab/lab-workspace.tsx`, không sửa `web/src/modules/workspace/tab-runtime.ts`, không sửa `web/src/modules/lab/stage/stage.tsx`, không sửa `web/messages/`, không cài `y-webrtc` hay `simple-peer`, không gửi byte SQL nào qua WebSocket `/signal`.

## Hai sai lệch đã chốt so với bản nháp v3 — bắt buộc reviewer đọc

**D1 — Thay `y-webrtc` bằng provider tự viết trên `/signal` + WebRTC DataChannel.** Endpoint `GET /api/v1/cloud/projects/:id/signal` của Task163 là một JSON relay thuần theo `:id` phòng (với `to` khớp `userId`, client bắt buộc tự gắn `peerId` để lọc khi cùng 1 người mở 2 tab — xem D3 trong `Task163/ban_giao_task163.md`), không nói giao thức pub/sub `subscribe/publish/topics` của `y-webrtc`, đồng thời tránh lỗi bundle `simple-peer` trên Next 16 Turbopack. `room-provider.ts` dùng WebSocket (`/signal`) + WebRTC `RTCPeerConnection`/`RTCDataChannel` + `yjs` + `lib0` + `y-protocols`. **Không cài `y-webrtc`.**

**D2 — Ba endpoint Baton (`/baton/request`, `/baton/grant`, `/baton/heartbeat`) bị rơi khe giữa Task161 & Task163.** Trên `main` hiện chỉ có `GET /api/v1/cloud/projects/:id/baton` và `POST /api/v1/cloud/projects/:id/baton/claim` (thuộc Task161). `baton-store.ts` nối thật hai endpoint sẵn có đó qua REST adapter và trừu tượng hóa `requestBaton` / `grantBaton` / `returnBaton` qua `BatonTransport` (mặc định đi qua kênh điều khiển P2P DataChannel), ghi nhận nợ 3 REST endpoint trong bàn giao cho Task165 hoặc task backend riêng.

## Hợp đồng

```typescript
export type SignalMessageType = "join" | "offer" | "answer" | "ice" | "leave";

export interface SignalEnvelope {
  type: SignalMessageType;
  roomId: string;
  fromPeerId: string;
  fromUserId: string;
  toPeerId?: string;
  /** userId đích (theo D3 của Task163, server relay tới mọi tab của userId này nên client phải tự lọc theo toPeerId). */
  to?: string;
  payload?: unknown;
}

export interface BatonControlMessage {
  kind: "baton:request" | "baton:grant" | "baton:return";
  roomId: string;
  fromUserId: string;
  targetUserId?: string;
  sentAt: number;
}
```

- `createRoomCollabProvider(options)`: trả `RoomCollabProvider` (`doc`, `awareness`, `peerId`, `connect()`, `disconnect()`, `destroy()`, `sendControl(msg)`, `onControl(cb)`, `getPeerIds()`), hỗ trợ tiêm `WebSocketFactory` và `PeerConnectionFactory` để test thuần máy không cần STUN/mạng ngoài; xử lý glare offer đồng thời theo thứ tự từ điển `localPeerId < remotePeerId`.
- `getTabYText(doc, tabId)` (`doc.getText("tab:" + tabId)`) và `createTabCollabExtension(doc, tabId, awareness, { readOnly? })`: dùng `yCollab` từ `y-codemirror.next`, mỗi tab một `Y.UndoManager` riêng, `readOnly: true` gắn `EditorState.readOnly.of(true)` + `EditorView.editable.of(false)` cho viewer.
- `useBatonStore` / `createBatonStore(adapter?)`: `{ projectId, holderId, myUserId, myRole, pendingRequests, status, error, setRoom, syncFromServer, claimBaton, requestBaton, grantBaton, applyControlMessage, reset }`.

## Tiêu chí xong

- AC1: Vitest unit — 2 `Y.Doc` độc lập nối qua `RoomCollabProvider` (mock signaling hub + mock DataChannel) chèn/xóa xung đột đồng thời hội tụ về cùng chuỗi SQL giống hệt nhau; và **0 byte SQL** đi qua signaling WebSocket (test assert toàn bộ payload gửi lên `/signal` không chứa nội dung SQL).
- AC2: `web/package.json` có direct dependency `zustand`, `yjs`, `y-codemirror.next`, `lib0`, `y-protocols`; và **không** có `y-webrtc`.
- AC3 (khóa D3): Cùng một `userId` mở 2 tab (`peer-1`, `peer-2`) trong cùng phòng; signaling relay message có `to: userId` tới cả 2 tab (đúng hành vi `TestRoomSignalTargetUserReachesAllTabs`), nhưng chỉ tab khớp `toPeerId` xử lý offer/answer, tab kia bỏ qua sạch.
- AC4 (CodeMirror 6): Test với `EditorState` thật của `@codemirror/state` + `createTabCollabExtension`: sửa từ doc A cập nhật doc B; `UndoManager` của tab 1 không hoàn tác thay đổi của tab 2; chế độ `readOnly: true` (viewer) chặn sửa cục bộ nhưng vẫn nhận cập nhật từ xa.
- AC5 (`baton-store`): `syncFromServer()` đọc `GET /baton`, `claimBaton()` gọi `POST /baton/claim`, `requestBaton()`/`grantBaton()` gửi thông điệp điều khiển và cập nhật state, vai trò `viewer` bị chặn không gọi `claim`/`request`/`grant`.
- AC6: `npm run check` (`check:i18n` + `eslint` + `tsc --noEmit` + `vitest`) PASS và `API_ORIGIN=http://127.0.0.1:8080 npm run build` (Next.js 16 Turbopack) PASS, chứng minh không vỡ polyfill/bundle.

## Ca biên

- Glare (2 peer cùng gửi `offer` một lúc): giải quyết tất định theo thứ tự từ điển `localPeerId < remotePeerId`.
- Peer rời phòng đột ngột (`leave` hoặc đóng DataChannel): dọn `RTCPeerConnection` + xóa trạng thái awareness của peer đó.
- Payload signaling JSON hỏng hoặc thiếu `fromPeerId`: bỏ qua an toàn, không crash.
- Gọi `destroy()` nhiều lần: idempotent, không ném lỗi.
- Viewer (`myRole === "viewer"`) bấm `requestBaton` / `claimBaton` / `grantBaton`: đều bị từ chối, không gửi request mạng hay control message.

## Kiểm tra

```bash
cd web && npm run check
cd web && API_ORIGIN=http://127.0.0.1:8080 npm run build
```

## Góc review thêm

- Bảo mật / Core Rule 7: Zero-Log Transit — 0 byte nội dung SQL hay code tab được phép xuất hiện trong payload gửi qua `/signal` WebSocket.
- Hợp đồng D3: kiểm tra kỹ cơ chế gán `fromPeerId` / `toPeerId` khi cùng một `userId` mở 2 tab.
- Nhãn: Task này **Chưa đo** trên môi trường deploy thật (dùng mock signaling/DataChannel cho unit test).

## Đọc thêm

- `_bmad-output/SP024/STR114/Task163/ban_giao_task163.md` (đặc biệt sai lệch D1, D2, D3)
- `web/src/modules/workspace/tab-runtime.ts`
- `api/internal/httpapi/room_signal.go`
- `api/internal/httpapi/live_rooms.go`
