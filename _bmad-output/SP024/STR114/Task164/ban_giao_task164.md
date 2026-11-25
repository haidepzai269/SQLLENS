# Bàn giao Task164

Đã làm: hoàn thiện tầng đồng biên tập Yjs P2P (`createRoomCollabProvider`), ràng buộc CodeMirror 6 theo từng tab (`getTabYText`, `createTabCollabExtension`) và Zustand store điều phối The Baton (`createBatonStore`, `useBatonStore`), kèm đưa `zustand`, `yjs`, `y-codemirror.next`, `lib0`, `y-protocols` thành direct dependency trong `web/package.json` (tuyệt đối không cài `y-webrtc` hay `simple-peer`). Đã sửa lỗi `env.remotePeerId` trong `room-provider.ts` và làm sạch spy/frame khởi tạo ở test AC3 (D3).

File chính: `web/package.json`, `web/package-lock.json`, `web/src/modules/room/collab/types.ts`, `web/src/modules/room/collab/room-provider.ts`, `web/src/modules/room/collab/collab-binding.ts`, `web/src/modules/room/collab/baton-store.ts`, `web/src/modules/room/collab/index.ts`, `web/src/modules/room/collab/room-provider.test.ts`, `web/src/modules/room/collab/collab-binding.test.ts`, `web/src/modules/room/collab/baton-store.test.ts`.

Kết quả kiểm tra: chạy thật trong `web/` sau lần sửa cuối — `npx vitest run src/modules/room/collab` PASS **3/3 file, 16/16 tests** (phủ AC1–AC5 và các ca biên glare, `leave`/đóng DataChannel, JSON hỏng/thiếu `fromPeerId`, `destroy()` idempotent); `npm run check` PASS (`check:i18n` ok, `eslint` 0 errors / 3 warnings, `tsc --noEmit` ok, `vitest run` **124 passed | 2 skipped** với **1500 passed | 18 skipped**); `API_ORIGIN=http://127.0.0.1:8080 npm run build` PASS (Next.js 16.4.4 Turbopack, 63 static pages, retry 1 lần sau cảnh báo bảo mật Next.js).

Kết quả review: `reviewer-164` đã nghiệm thu **PASS 100%** (0 lỗi `confirmed`, đạt đủ AC1–AC6). Hai warning lint nhẹ ở `room-provider.test.ts:366-367` (`_sdp` không dùng) được giữ nguyên để không sửa code sau khi đã review xong.

Chưa làm được: kết nối WebRTC `RTCPeerConnection`, STUN và WebSocket `/signal` thật giữa hai trình duyệt trên mạng ngoài hoặc môi trường deploy (**Chưa đo**, unit test dùng mock signaling hub và mock DataChannel).

Phát sinh:
- **D1 (thay `y-webrtc`):** `room-provider.ts` dùng WebSocket `/signal` + `RTCPeerConnection`/`RTCDataChannel` + `yjs`/`lib0`/`y-protocols` tự viết thay cho `y-webrtc` vì endpoint `/signal` là JSON relay thuần và để tránh lỗi bundle `simple-peer` trên Next 16 Turbopack.
- **D2 (nợ 3 REST endpoint Baton):** `/baton/request`, `/baton/grant`, `/baton/heartbeat` bị rơi khe giữa Task161 và Task163. `baton-store.ts` đã nối thật `GET /api/v1/cloud/projects/:id/baton` và `POST /api/v1/cloud/projects/:id/baton/claim`, còn `requestBaton` / `grantBaton` / `returnBaton` trừu tượng hóa qua `BatonTransport` (mặc định đi qua kênh control DataChannel) — ghi nhận nợ 3 REST endpoint này cho Task165 hoặc task backend riêng.

Việc tiếp theo cần biết: theo hợp đồng D3 của Task163, `/signal` relay `to` theo `userId` tới mọi tab cùng người dùng, nên `createRoomCollabProvider` bắt buộc gắn `fromPeerId` / `toPeerId` và tự lọc `toPeerId !== peerId` ở client; Task165/Task166 khi gắn UI vào phòng cộng tác cần giữ nguyên hợp đồng `SignalEnvelope` và nối `provider.sendControl` / `onControl` vào `useBatonStore.setTransport`.
