# Task169 — Arena: Đồ thị Cytoscape Wait-For Graph + Viewer sync qua Polling 3s

Thuộc: SP024 / STR116
Mục tiêu: Hiển thị đồ thị Cytoscape Wait-For Graph theo từng bước trong Deadlock Arena và đồng bộ bước Host → Viewer qua polling **chu kỳ 3 giây** (quyết định D17) gọi `POST`/`GET /api/v1/cloud/projects/:id/arena-step` (endpoint Task161 đã làm).
Phạm vi: `web/src/modules/arena/graph/` (mới: `graph-elements.ts`, `arena-wait-graph.tsx`, `arena-wait-graph.test.tsx`), `web/src/modules/arena/arena-sync.ts` (mới) + `arena-sync.test.ts` (mới), `web/src/modules/arena/components/arena-view.tsx`, `web/messages/{vi,en}/arena.json`, `web/src/app/[locale]/e2e-arena/` (harness Playwright mới), `web/e2e/arena-sync.spec.ts` (mới).
Không làm: Không sửa `api/` (endpoint `arena-step` đã có ở Task161), không sửa `web/src/modules/room/` hay `lab-workspace.tsx`, không dùng SSE hay WebSocket cho Arena, **không dùng chu kỳ polling 2 giây** (bắt buộc đúng `ARENA_POLL_INTERVAL_MS = 3000` theo D17), không gửi SQL người dùng ra mạng.

## Hợp đồng

- `ARENA_POLL_INTERVAL_MS = 3000` (chu kỳ polling đã chốt ở D17; 100 request/5 phút, dưới trần `quota.CloudSync` 120 lệnh/5 phút).
- `POST /api/v1/cloud/projects/:id/arena-step` body `{ "step": number }` (Host gọi khi đổi bước).
- `GET /api/v1/cloud/projects/:id/arena-step` → `{ "step": number }` (Viewer polling mỗi `3000ms`, cập nhật `useArenaStore.getState().setStep(step)`).
- `<ArenaWaitGraph step={currentStep} />` dùng Cytoscape vẽ Wait-For Graph với 4 trạng thái màu node: xanh (`active` / running), vàng (`waiting`), đỏ (`aborted` / deadlocked), xám (`committed` / `idle`); tái sử dụng mẫu Cytoscape từ `web/src/modules/conflict-sim/ui/wait-graph.tsx`.
- `<ArenaView roomId?: string; role?: "host" | "viewer" />`: giữ tương thích 100% các test Task168 khi không truyền `roomId`/`role`.

## Tiêu chí xong

- AC1: Đồ thị Cytoscape Wait-For Graph dựng đúng 4 trạng thái màu node (xanh: `active`/running, vàng: `waiting`, đỏ: `aborted`/deadlocked, xám: `committed`/`idle`).
- AC2: Playwright 2-browser (`web/e2e/arena-sync.spec.ts` trên Chromium thật): Host bấm Next Step → `POST /api/v1/cloud/projects/:id/arena-step` `{step: N}` → Viewer polling 3 giây thấy đồ thị & bước cập nhật trong `< 3.5s`, nhãn **Mô phỏng** luôn hiện trên cả Host lẫn Viewer.
- AC3: **0 byte SQL** trong payload mạng — mọi request `POST`/`GET /arena-step` chỉ mang `{step: N}`, kiểm bằng unit test + Playwright request inspector.
- AC4: Đo tải chu kỳ polling (fake timers 5 phút liên tục trong `arena-sync.test.ts` + ghi rõ số đo): đúng chu kỳ `3000ms`, tổng số request trong 5 phút là **~100 request/5 phút** (`<= 101`, dưới trần `quota.CloudSync` 120 lệnh/5 phút), 0 response `429`, dọn sạch timer khi unmount/rời trang.
- AC5: `npm run check` PASS (`check:i18n`, `eslint`, `tsc --noEmit`, `vitest`), `API_ORIGIN=http://127.0.0.1:8080 npm run build` PASS, `npx playwright test e2e/arena-sync.spec.ts` PASS, 390px không tràn ngang.

## Ca biên

- Request `GET /arena-step` bị lỗi mạng hoặc 5xx tạm thời: không crash UI, tiếp tục poll chu kỳ tiếp theo cho tới khi unmount.
- Bước ngoài phạm vi `0..totalSteps-1`: kẹp về biên hợp lệ, không vỡ đồ thị Cytoscape.
- Harness `e2e-arena` phải nằm trong nhóm route bị chặn ở production trong `web/src/proxy.ts`.

## Kiểm tra

```bash
cd web && npm run check
cd web && API_ORIGIN=http://127.0.0.1:8080 npm run build
cd web && npx playwright test e2e/arena-sync.spec.ts
```

## Góc review thêm

- Bảo mật / Core Rule 7: payload mạng chỉ mang `{step: N}`, 0 byte SQL; đúng chu kỳ `3000ms`.
- Nhãn kết luận: **Mô phỏng** bắt buộc hiện trên cả Host lẫn Viewer.
- Giao diện: đủ vi/en, 390px không tràn ngang, giữ nguyên tương thích test Task168.

## Đọc thêm

- `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md` §Task169 (đặc biệt D17 / Sửa #20)
- `web/src/modules/conflict-sim/ui/wait-graph.tsx`
- `web/src/modules/arena/components/arena-view.tsx`
- `web/src/modules/arena/arena-store.ts`
