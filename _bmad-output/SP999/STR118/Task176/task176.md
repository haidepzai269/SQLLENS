# Task176: Ẩn nút `Xin quyền chạy` trên Owner & Thêm nút Thu hồi quyền trong `InviteDialog`

- **Epic / Story:** SP999 / STR118 — Vá lỗi phát hiện từ Review Production (`BAO_CAO_REVIEW_SP024_PRODUCTION.md`)
- **Mục tiêu:** Sửa dứt điểm 2 lỗi trung bình phát hiện ở K1 & K3:
  1. Ẩn thanh/nút `Xin quyền chạy` trên Chủ phòng (`owner`) khi chưa có ai giữ Baton (`holderId === null`).
  2. Bổ sung nút **Thu hồi** thành viên trong `InviteDialog` gọi `DELETE /api/v1/cloud/projects/:id/members/:uid`.

## Phạm vi file (tuyệt đối không chạm `api/`, `use-lab-room-collab.ts`, `lab-workspace.tsx`)
- `web/src/modules/room/components/baton-request-toast.tsx`
- `web/src/modules/room/api.ts`
- `web/src/modules/room/components/invite-dialog.tsx`
- `web/src/modules/room/components/invite-dialog.test.tsx` *(và/hoặc `baton-request-toast.test.tsx`)*
- `web/messages/vi/room.json`
- `web/messages/en/room.json`

## Hợp đồng kỹ thuật chi tiết

### 1. `web/src/modules/room/components/baton-request-toast.tsx`
- Đổi điều kiện `isHolder` thành:
  `const isHolder = myUserId !== null && (holderId === myUserId || (holderId === null && myRole === "owner"));`
- Đảm bảo khi `myRole === "owner"` và `holderId === null`, Owner không thấy thanh `Xin quyền chạy` dư thừa.

### 2. `web/src/modules/room/api.ts` & `invite-dialog.tsx`
- `api.ts`: thêm `removeMember(projectId: string, memberUserId: string, fetchImpl: typeof fetch = fetch): Promise<void>` gọi `DELETE /api/v1/cloud/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberUserId)}` (`credentials: "same-origin"`, `cache: "no-store"`), ném `RoomApiError` nếu `!res.ok`.
- `invite-dialog.tsx`:
  - Khi `membersState === "ready"` (tức người đang xem là chủ phòng), với mỗi thành viên `m` có `m.role !== "owner"` và `m.userId !== user?.id`, hiển thị nút **Thu hồi** (`data-testid="room-member-remove"`, disable khi đang xóa `removingId === m.userId`).
  - Khi bấm: gọi `removeMember(cloudId, m.userId)`; thành công thì loại `m.userId` khỏi state `members`; thất bại thì hiện thông báo lỗi gọn.
- `web/messages/vi/room.json` & `web/messages/en/room.json`: thêm đầy đủ chuỗi song ngữ `invite.removeMember`, `invite.removingMember`, `invite.removeFailed`.

## Tiêu chí nghiệm thu (AC1–AC4)
- **AC1:** `BatonRequestToast` trả `null` khi `myRole === "owner"`, `holderId === null` và chưa có `pendingRequests`.
- **AC2:** `InviteDialog` hiển thị nút Thu hồi cho `editor`/`viewer` (không hiện cho `owner`), gọi đúng `DELETE .../members/:uid` và cập nhật danh sách ngay khi thành công.
- **AC3:** `npm run check` (`check:i18n`, `lint`, `typecheck`, `vitest`) PASS 100%.
- **AC4:** Lập `ban_giao_task176.md` tại `_bmad-output/SP999/STR118/Task176/ban_giao_task176.md`.
