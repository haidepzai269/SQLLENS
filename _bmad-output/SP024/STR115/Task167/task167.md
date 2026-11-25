# Task167 — Fork sang Local Sandbox (trần 512KB + tối đa 5 phòng fork)

Thuộc: SP024 / STR115
Mục tiêu: Cho phép thành viên phòng Fork các tab hiện tại về dự án local mới trong IndexedDB với hai trần độc lập (`512KB` và tối đa `5` phòng fork qua trường `roomFork?` đã chốt D20), gọi lại `forkSnapshot` từ `share/fork.ts`.
Phạm vi: `web/src/modules/workspace/types.ts` (thêm `roomFork?: { projectId: string; forkedAt: number }` vào `WorkspaceProject`, **KHÔNG bump `CURRENT_DB_VERSION`**), `web/src/modules/share/fork.ts` (mở rộng `ForkErrorCode` thêm `"FORK_TOO_LARGE"` và `"FORK_LIMIT_REACHED"`, thêm `roomFork?` vào `ForkOptions`, rà mọi `switch` trên `ForkErrorCode` trong `web/src/modules/share/`), `web/src/modules/room/fork/` (mới: `room-fork.ts`, `room-fork.test.ts`, `fork-dialog.tsx`, `fork-dialog.test.tsx`), `web/messages/{vi,en}/share.json` (mục `roomFork.*`), `web/src/app/[locale]/e2e-fork/` (harness Playwright mới), `web/e2e/room-fork.spec.ts` (mới).
Không làm: Không sửa `api/`, không sửa `web/messages/*/room.json` (dùng `share.json` để không đụng Task166), không dùng `encodeSnapshot` (vì codec URL chặn ở 32KB), không bump `CURRENT_DB_VERSION`, không sửa `web/src/modules/arena/`.

## Hợp đồng

- Hằng số bắt buộc:
  - `ROOM_FORK_MAX_BYTES = 512 * 1024` (512 KB cho IndexedDB, không dùng `SNAPSHOT_HARD_LIMIT_BYTES`).
  - `ROOM_FORK_MAX_ACTIVE = 5` (tối đa 5 phòng fork đồng thời).
- `WorkspaceProject` thêm trường tùy chọn `roomFork?: { projectId: string; forkedAt: number }` (D20 — không thay đổi `CURRENT_DB_VERSION = 1` ở `db.ts`).
- `ForkErrorCode` mở rộng thành `"FORK_STORAGE_UNAVAILABLE" | "FORK_QUOTA_EXCEEDED" | "FORK_TOO_LARGE" | "FORK_LIMIT_REACHED" | "FORK_FAILED"`.
- `checkForkSize(tabs)`: kiểm tổng byte UTF-8 của `JSON.stringify(tabs)` và từng tab, vượt `ROOM_FORK_MAX_BYTES` trả `{ ok: false, bytes, tabName }`.
- `countActiveForks(scope, options?)`: đọc `listProjects(scope)` và đếm các dự án có `Boolean(p.roomFork)`.
- `forkRoomToWorkspace(input, options?)`: kiểm trần `512KB` và trần `5` fork độc lập, gọi `resolveWorkspaceScope` (1 request `/api/me`), rồi gọi `forkSnapshot(...)` truyền `roomFork` để ghi 1 transaction IndexedDB duy nhất.

## Tiêu chí xong

- AC1: Playwright (`web/e2e/room-fork.spec.ts`): fork 3 tab → thấy dự án mới trong IndexedDB với đủ 3 tab và nội dung SQL khớp nguyên vẹn; dự án phòng gốc không đổi.
- AC2: Đã có 5 fork (`countActiveForks >= 5`) → nút Fork bị `disabled`, hiện thông báo rõ ràng (vi + en).
- AC3: Thêm fork thứ 6 bằng API trực tiếp → `countActiveForks` trả `6`, UI hiện đúng, không âm thầm xoá fork cũ.
- AC4: Tổng `JSON.stringify(tabs)` vượt `512KB` → từ chối bằng `ForkError("FORK_TOO_LARGE", ...)` và hiển thị **byte thật** cùng **tên tab vi phạm** (không âm thầm cắt dữ liệu).
- AC5: Đo trên toàn bộ luồng bấm Fork trong Playwright (`network` interceptor): đúng **1 request `/api/me`** (do `resolveWorkspaceScope`), **0 request nào mang nội dung SQL**.
- AC6: `npm run check` PASS, `API_ORIGIN=http://127.0.0.1:8080 npm run build` PASS, `npx playwright test e2e/room-fork.spec.ts` PASS, 390px không tràn ngang.
- AC7: `new ForkError("FORK_TOO_LARGE", ...)` biên dịch sạch (`tsc --noEmit` PASS), mọi `switch` trên `ForkErrorCode` trong `web/src/modules/share/` đều có nhánh đầy đủ.

## Ca biên

- Xoá bớt 1 dự án fork trong IndexedDB → `countActiveForks` giảm còn 4 và nút Fork mở lại bình thường.
- Tab có ký tự Unicode / tiếng Việt (chiếm > 1 byte/ký tự) → `checkForkSize` đo theo byte UTF-8 thật (`TextEncoder`), không đo theo `.length` ký tự.
- Chế độ ẩn danh chặn IndexedDB → trả `ForkError("FORK_STORAGE_UNAVAILABLE", ...)` với câu thông báo riêng.
- Harness `e2e-fork` khớp `isBlockedE2eRoute` trong `web/src/proxy.ts` ở production.

## Kiểm tra

```bash
cd web && npm run check
cd web && API_ORIGIN=http://127.0.0.1:8080 npm run build
cd web && E2E_PORT=3167 npx playwright test e2e/room-fork.spec.ts
```

## Góc review thêm

- Bảo mật / Core Rule 7: toàn luồng bấm Fork chỉ gọi duy nhất `/api/me` để resolve scope, 0 byte SQL gửi lên mạng.
- Không bump `CURRENT_DB_VERSION` (giữ `1`) và không rò `roomFork` vào `projectStamp` hay cloud sync payload.
- Nhãn: **Chưa đo** trên bản deploy thật.

## Đọc thêm

- `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md` §STR115 & §Task167 (đặc biệt D20)
- `web/src/modules/share/fork.ts`
- `web/src/modules/workspace/types.ts`
