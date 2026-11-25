# Bàn giao Task165

Đã làm:
- Mở rộng `web/src/modules/room/collab/baton-store.ts` thêm `memberNames: Record<string, string>` và `setMemberNames` (tự dọn khi đổi phòng hoặc `reset`), cập nhật `baton-store.test.ts`.
- Tạo `web/src/modules/room/components/baton-request-toast.tsx` (+ `baton-request-toast.test.tsx`) và chuỗi song ngữ `room.baton.*` trong `web/messages/{vi,en}/room.json`: hiển thị nút Xin quyền chạy (`baton-request-button`) khi người khác giữ Baton, danh sách người xin + nút Cấp quyền (`baton-grant-button`) khi giữ Baton, ẩn hoàn toàn với `viewer` và ngoài phòng.
- Cập nhật trực tiếp `<Tip><Button data-testid="lab-run-button">` và `handleEditorRun` trong `web/src/modules/lab/lab-workspace.tsx`: ẩn nút Run với `viewer`, disable kèm tooltip chứa tên người giữ Baton từ `memberNames`, gắn `<BatonRequestToast />` khi vào phòng; giữ nguyên 100% khi `projectId === null`.
- Tạo harness `web/src/app/[locale]/e2e-baton/{page.tsx,harness.tsx}` (bị chặn ở production qua `isBlockedE2eRoute` trong `web/src/proxy.ts`) và `web/e2e/room-baton.spec.ts`.

File chính:
- `web/src/modules/room/collab/baton-store.ts`, `web/src/modules/room/collab/baton-store.test.ts`
- `web/src/modules/room/components/baton-request-toast.tsx`, `web/src/modules/room/components/baton-request-toast.test.tsx`
- `web/src/modules/lab/lab-workspace.tsx`, `web/messages/{vi,en}/room.json`
- `web/src/app/[locale]/e2e-baton/{page.tsx,harness.tsx}`, `web/e2e/room-baton.spec.ts`

Kết quả kiểm tra:
- `cd web && npm run check`: PASS (`check:i18n` ok, `eslint` 0 errors, `tsc --noEmit` ok, `vitest`: 129 passed / 2 skipped theo env, 1539/1557 tests passed, 18 skipped).
- `cd web && API_ORIGIN=http://127.0.0.1:8080 npm run build`: PASS (sau retry cảnh báo bảo mật Next.js).
- `cd web && npx playwright test e2e/room-baton.spec.ts`: 3/3 PASS (AC2 2-browser, AC4 viewer, AC5 390x844 không tràn ngang).
- Nhãn: **Chưa đo** trên bản deploy production thật.

Kết quả review: `reviewer-165` nghiệm thu **PASS** (0 lỗi, `ca524ce..04a6c08`).
Chưa làm được: Không có.
Phát sinh: Nợ 3 REST endpoint `/baton/request`, `/baton/grant`, `/baton/heartbeat` (D2 Task164) chưa nối vì Task165 chỉ dùng kênh P2P `BatonTransport` + `memberNames` sẵn có.
Việc tiếp theo cần biết: Cần gọi `setMemberNames(...)` khi ghép phòng thật trong workspace để tooltip và toast hiển thị tên thay vì nhãn dự phòng.
