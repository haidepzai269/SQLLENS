# Task172 — Tích hợp UI cuối SP024 vào Lab & trang `/[locale]/arena`

Thuộc: SP024 / STR116 (tích hợp cuối cho STR113–STR116)
Mục tiêu: Nối 3 phần UI còn nằm ở harness của SP024 vào luồng người dùng thật: trang `/[locale]/arena` (+ nút mở Arena từ thanh công cụ Stage), nút `<ForkDialog />` trên thanh công cụ Stage khi dự án đang gắn phòng cloud, và `<NatWarningBanner />` trong `lab-workspace.tsx`.
Phạm vi:
- `web/src/app/[locale]/arena/page.tsx` + `web/src/app/[locale]/arena/arena-page-client.tsx` + `web/src/app/[locale]/arena/arena-page-client.test.tsx` (mới)
- `web/src/modules/lab/stage/stage.tsx`
- `web/src/modules/room/collab/baton-store.ts` (+ `baton-store.test.ts`)
- `web/src/modules/lab/lab-workspace.tsx`
- `web/messages/{vi,en}/arena.json`
- `web/e2e/sp024-integration.spec.ts` (mới)

Không làm: Không sửa `api/`, không sửa `web/package.json`, không làm thay đổi giao diện Lab khi chưa vào phòng cloud (`project.cloud?.remoteId` rỗng), không gửi SQL lên mạng.

## Hợp đồng

- `/[locale]/arena`: route thật cho Deadlock Arena, đọc `roomId` & `role` (`"host" | "viewer"`) từ searchParams, đọc `isVip` từ `useAuth()` (`user?.role === "vip"` hoặc helper VIP hiện có trong `auth`), render `<ArenaView roomId={roomId} role={role} isVip={isVip} />` kèm link quay lại Lab (`/`).
- `stage.tsx:559-568`:
  - Luôn có nút/link mở Arena điều hướng tới `/arena` (hoặc `/arena?roomId=<cloudId>&role=host` khi dự án hiện tại có `cloud.remoteId`).
  - Khi dự án hiện tại có `cloud.remoteId`: render `<ForkDialog />` với `room` và `scope` từ `useWorkspaceStore`. Dự án local thường (không có `cloud.remoteId`) giữ nguyên toolbar không hiện `<ForkDialog />`.
- `useBatonStore`: thêm `natWarning: boolean` (mặc định `false`, reset về `false`) và `setNatWarning(v: boolean)`.
- `lab-workspace.tsx`: render `<NatWarningBanner visible={batonProjectId !== null && natWarning} />` gần `<BatonRequestToast />` (ẩn khi ngoài phòng hoặc `natWarning === false`).

## Tiêu chí xong

- AC1: Truy cập `/vi/arena` và `/en/arena` hiển thị đầy đủ `<ArenaView />` với `<SimulationBadge />` (**Mô phỏng**), `<ScenarioPicker />`, `<StepController />`, `<ArenaWaitGraph />`, và hiện `<ArenaMentorPanel />` khi user là VIP (ẩn khi không phải VIP).
- AC2: Trên thanh công cụ `stage.tsx`, có nút mở Arena điều hướng sang `/[locale]/arena`; khi dự án hiện tại có `cloud.remoteId`, hiển thị `<ForkDialog />` cho phép fork trực tiếp về Local Sandbox mà không ảnh hưởng dự án local thường.
- AC3: `lab-workspace.tsx` hiển thị `<NatWarningBanner />` khi `batonProjectId !== null && natWarning === true` và ẩn khi `false` hoặc ngoài phòng.
- AC4: `npm run check` (`check:i18n`, `eslint`, `tsc --noEmit`, `vitest`) PASS và `API_ORIGIN=http://127.0.0.1:8080 npm run build` PASS (có route `/vi/arena`, `/en/arena`).
- AC5: `E2E_PORT=3172 npx playwright test e2e/sp024-integration.spec.ts` PASS (mở `/vi/arena`, chọn kịch bản `deadlock_reverse_order`, hiện nhãn Mô phỏng, `390x844` không tràn ngang, và kiểm nút Arena từ `/vi` điều hướng sang `/vi/arena`).

## Ca biên

- `/[locale]/arena` không có `roomId` vẫn hoạt động ở chế độ tự học mô phỏng (không gọi API `arena-step`).
- `role` trên URL lạ (khác `"host"` và `"viewer"`) → bỏ qua an toàn (`undefined`), không crash.
- Khi đang chạy kiểm tra E2E trên dự án local thường (`project.cloud` rỗng), `stage.tsx` không hiện nút Fork tránh nhiễu toolbar cũ.

## Kiểm tra

```bash
cd web && npm run check
cd web && API_ORIGIN=http://127.0.0.1:8080 npm run build
cd web && E2E_PORT=3172 npx playwright test e2e/sp024-integration.spec.ts
```

## Góc review thêm

- Bảo mật / Core Rule 7: nút mở Arena chỉ mang `roomId` & `role` trên URL (không mang SQL), không gọi API lạ.
- Giao diện: đủ vi/en, 390px không tràn ngang, bảo toàn 100% các test hiện có của `stage.tsx` và `lab-workspace.tsx`.
- Nhãn: **Mô phỏng** luôn hiện ở `/[locale]/arena`.

## Đọc thêm

- `web/src/modules/lab/stage/stage.tsx:555-570`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/src/modules/room/fork/fork-dialog.tsx`
- `web/src/modules/arena/components/arena-view.tsx`
- `web/src/modules/room/components/nat-warning-banner.tsx`
