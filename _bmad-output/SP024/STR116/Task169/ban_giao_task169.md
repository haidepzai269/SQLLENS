# Bàn giao Task169

Đã làm: Xây dựng đồ thị Cytoscape Wait-For Graph (`<ArenaWaitGraph />`) hiển thị 4 trạng thái màu node (xanh `active`, vàng `waiting`, đỏ `aborted`/deadlocked, xám `committed`/`idle`) cùng cạnh chu trình deadlock; triển khai đồng bộ bước Host sang Viewer qua REST polling 3 giây (`ARENA_POLL_INTERVAL_MS = 3000`, `pushArenaStep`/`fetchArenaStep`/`useArenaSync`), tích hợp vào `<ArenaView />` (giữ nguyên tương thích ngược Task168 và luôn giữ nhãn **Mô phỏng** ở header) và tạo harness Playwright 2-browser + mobile 390px.

File chính:
- `web/src/modules/arena/graph/graph-elements.ts`
- `web/src/modules/arena/graph/arena-wait-graph.tsx`
- `web/src/modules/arena/graph/arena-wait-graph.test.tsx`
- `web/src/modules/arena/arena-sync.ts`
- `web/src/modules/arena/arena-sync.test.ts`
- `web/src/modules/arena/components/arena-view.tsx`
- `web/messages/vi/arena.json`, `web/messages/en/arena.json`
- `web/src/app/[locale]/e2e-arena/page.tsx`, `web/src/app/[locale]/e2e-arena/harness.tsx`
- `web/e2e/arena-sync.spec.ts`

Kết quả kiểm tra:
- Đo tải polling 5 phút (`300_000ms` fake timers trong `arena-sync.test.ts`): phát đúng **100 request / 5 phút** (`<= 101`, dưới trần `quota.CloudSync` 120 lệnh/5 phút), 0 request tại mốc `2000ms`, chu kỳ chuẩn `3000ms`, **0 byte SQL** trong mọi payload `POST`/`GET /arena-step`, chịu lỗi 500/mạng tạm thời không crash và dừng hẳn timer khi unmount.
- `npm run check`: PASS (`check:i18n`, `eslint` 0 lỗi, `tsc --noEmit`, `vitest` 130/132 file passed, 2 file skipped theo biến môi trường; 1542/1560 tests passed).
- `API_ORIGIN=http://127.0.0.1:8080 npm run build`: PASS.
- `npx playwright test e2e/arena-sync.spec.ts`: 2/2 PASS (2-browser Host -> Viewer cập nhật `< 3.5s`, 0 byte SQL, nhãn **Mô phỏng** hiện trên cả Host và Viewer, mobile `390x844` không tràn ngang).

Kết quả review: `reviewer-169` nghiệm thu PASS 100% (0 lỗi).

Chưa làm được: E2E Playwright hiện dùng route-mock cho `/arena-step`, chưa nối trực tiếp Gin backend thật và chưa đo trên bản deploy production thật.

Phát sinh: Không.

Việc tiếp theo cần biết: Route `/[locale]/e2e-arena` tự động bị `isBlockedE2eRoute` trong `web/src/proxy.ts` trả 404 khi `VERCEL_ENV === "production"`; Task170 khi ghép UI Arena vào phòng cộng tác thật cần truyền `roomId` và `role` (`"host" | "viewer"`) vào `<ArenaView />`.
