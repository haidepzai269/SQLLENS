# Bàn giao Task166

Đã làm: Hoàn thiện tầng broadcast kết quả thực thi SQL P2P qua kênh control DataChannel (`createResultBroadcaster`), tự động trả Baton về `ownerId` sau `BATON_RETURN_TIMEOUT_MS = 30_000` khi Driver mất kết nối hoặc ngưng heartbeat (reset bộ đếm khi có heartbeat), kích hoạt `<NatWarningBanner />` song ngữ Việt/Anh sau `NAT_WARNING_TIMEOUT_MS = 10_000` khi WebRTC không mở được kết nối peer hoặc báo lỗi ICE, cùng harness `/<locale>/e2e-p2p` (được `isBlockedE2eRoute` chặn ở production) và bộ kiểm thử E2E Playwright 2 browser context.
File chính:
- `web/src/modules/room/p2p/types.ts`
- `web/src/modules/room/p2p/result-broadcaster.ts`
- `web/src/modules/room/p2p/result-broadcaster.test.ts`
- `web/src/modules/room/components/nat-warning-banner.tsx`
- `web/src/modules/room/components/nat-warning-banner.test.tsx`
- `web/messages/vi/room.json`, `web/messages/en/room.json` (mục `p2p.*`)
- `web/src/app/[locale]/e2e-p2p/{page.tsx,harness.tsx}`, `web/e2e/room-p2p.spec.ts`
Kết quả kiểm tra:
- `npm run check`: `check:i18n`, `eslint` (0 lỗi), `tsc --noEmit` đạt 100%; khi chạy 135 file Vitest song song có 2 timeout do nghẽn CPU (`hydrate.test.ts` V9-2, `sql-serializer.test.ts` Kịch bản 2), chạy lại `npx vitest run src/modules/workspace/hydrate.test.ts src/modules/export/sql-serializer.test.ts src/modules/room` đạt 12/12 file, 103/103 test (gồm `result-broadcaster.test.ts` 8/8 kiểm fake timers `30_000ms`/`10_000ms`, `destroy()`, và 0 byte SQL qua WebSocket `/signal` khi ghép `createRoomCollabProvider`; `nat-warning-banner.test.tsx` 3/3).
- `API_ORIGIN=http://127.0.0.1:8080 npm run build`: đạt 78/78 static pages (retry 1 lần sau cảnh báo bảo mật Next.js 16.4.4).
- `E2E_PORT=3166 npx playwright test e2e/room-p2p.spec.ts`: đạt 3/3 ở lượt dev (AC1 nhận kết quả `< 1s`, AC3 tự trả Baton về `ownerId`, AC4/AC5 hiển thị `<NatWarningBanner />` vi/en và 390x844 không tràn ngang).
Kết quả review: `reviewer-166` nghiệm thu PASS (0 lỗi code, 66/66 unit tests `src/modules/room` và `next build` đạt; phiên reviewer thiếu binary Playwright nên không chạy lại E2E).
Chưa làm được: **Chưa đo** kết nối WebRTC DataChannel và tỉ lệ cảnh báo Symmetric NAT trên bản deploy mạng thật qua Internet.
Phát sinh: Không có phát sinh mới trong phạm vi Task166.
Việc tiếp theo cần biết: Để nối kết quả P2P vào giao diện `lab-workspace` thật ở task tích hợp phòng, gọi `broadcaster.broadcastResult(...)` khi Driver thực thi xong và `broadcaster.reportPeerConnected()` / `reportIceFailed()` từ sự kiện kết nối peer của `RoomCollabProvider`.
