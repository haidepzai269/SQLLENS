# Task165 — UI The Baton: nút Run có trạng thái & toast xin quyền

Thuộc: SP024 / STR114
Mục tiêu: Gắn trạng thái The Baton vào nút Run trong `web/src/modules/lab/lab-workspace.tsx:748-759`, thêm `<BatonRequestToast />` cho phép xin/cấp quyền chạy engine, ẩn nút Run & Xin quyền với vai trò `viewer`.
Phạm vi: `web/src/modules/lab/lab-workspace.tsx`, `web/src/modules/room/components/baton-request-toast.tsx` (mới), `web/src/modules/room/components/baton-request-toast.test.tsx` (mới), `web/src/modules/room/collab/baton-store.ts`, `web/src/modules/room/collab/baton-store.test.ts`, `web/messages/{vi,en}/room.json`, `web/src/app/[locale]/e2e-baton/` (harness Playwright mới), `web/e2e/room-baton.spec.ts` (mới).
Không làm: Không tạo component `<RunButton />` mới thay thế nút Play trong `lab-workspace.tsx` (chỉnh trực tiếp `<Button>` inline dòng 748–759), không sửa `api/`, không sửa `web/src/modules/arena/`, không hardcode tên người dùng trong UI/AC, không gửi SQL ra mạng.

## Hợp đồng

- Bổ sung `memberNames: Record<string, string>` và `setMemberNames(names: Record<string, string>)` vào `BatonStoreState` để UI đọc tên người giữ Baton / người xin quyền từ store, không hardcode tên.
- `<BatonRequestToast />` đọc `useBatonStore`: hiển thị các yêu cầu trong `pendingRequests` khi người dùng hiện tại là người giữ Baton (`holderId === myUserId`) kèm nút Cấp quyền (`grantBaton(uid)`), và hiển thị nút Xin quyền chạy (`requestBaton()`) khi `myRole !== "viewer"` và người khác đang giữ Baton (`holderId !== myUserId`).
- Trong `lab-workspace.tsx:748-759`:
  - Khi `batonProjectId !== null && batonRole === "viewer"`: **ẩn** nút Run (và không có nút Xin quyền).
  - Khi `batonProjectId !== null && batonHolderId !== null && batonHolderId !== batonMyUserId`: nút Run bị `disabled`, tooltip (`<Tip label={...}>`) chứa tên người đang giữ Baton lấy từ `memberNames[holderId]` (fallback an toàn nếu chưa có tên).
  - Khi `batonProjectId === null`: hành vi nút Run giữ nguyên như trước.

## Tiêu chí xong

- AC1: Khi đang trong phòng cộng tác (`projectId !== null`) và người khác giữ Baton (`holderId !== myUserId`), nút Run trong `lab-workspace.tsx` bị `disabled` với tooltip chứa **tên người đang giữ Baton** lấy từ `baton-store` (không hardcode); đồng thời editor khác có nút **Xin quyền chạy** (`requestBaton()`). Khi chưa vào phòng (`projectId === null`), nút Run hoạt động y như cũ.
- AC2: Playwright 2-browser (`web/e2e/room-baton.spec.ts` trên Chromium thật): Editor B bấm Xin quyền → Host/Driver A thấy `<BatonRequestToast />` hiện tên người xin → bấm Cấp quyền → Baton chuyển sang B, nút Run của B bật và của A bị disabled kèm tooltip tên B.
- AC3: `npm run check:i18n` PASS — mọi chuỗi Baton đều có đủ `vi` và `en` trong `web/messages/{vi,en}/room.json`.
- AC4: Vai trò `viewer` (`myRole === "viewer"`) **không** thấy nút Run và **không** thấy nút Xin quyền chạy.
- AC5: `npm run check` PASS, `API_ORIGIN=http://127.0.0.1:8080 npm run build` PASS, `npx playwright test e2e/room-baton.spec.ts` PASS, 390px mobile không tràn ngang.

## Ca biên

- `holderId === null` hoặc chưa có trong `memberNames`: không crash, tooltip dùng nhãn dự phòng đa ngôn ngữ.
- Người giữ Baton bấm `claimBaton` hoặc cấp quyền xong → `pendingRequests` tự xoá tên người vừa được cấp quyền.
- Harness `e2e-baton` phải nằm trong nhóm route bị chặn ở production trong `web/src/proxy.ts`.

## Kiểm tra

```bash
cd web && npm run check
cd web && API_ORIGIN=http://127.0.0.1:8080 npm run build
cd web && npx playwright test e2e/room-baton.spec.ts
```

## Góc review thêm

- Bảo mật / Core Rule 7: 0 byte SQL rời máy, không thêm endpoint mới ở `api/`.
- Giao diện: đủ vi/en, 390px không tràn ngang, nút Play inline tại `lab-workspace.tsx:748-759`.
- Nhãn: **Chưa đo** trên bản deploy thật.

## Đọc thêm

- `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md` §Task165
- `_bmad-output/SP024/STR114/Task164/ban_giao_task164.md`
- `web/src/modules/room/collab/baton-store.ts`
- `web/src/modules/lab/lab-workspace.tsx`
