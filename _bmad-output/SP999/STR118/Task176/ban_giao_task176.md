# Bàn giao Task176: Ẩn nút `Xin quyền chạy` trên Owner & Thêm nút Thu hồi quyền trong `InviteDialog`

- **Epic / Story:** SP999 / STR118
- **Trạng thái:** Hoàn thành triển khai và xác minh đơn vị (AC1–AC4).

## 1. Các thay đổi đã thực hiện
1. **`web/src/modules/room/components/baton-request-toast.tsx`**
   - Cập nhật điều kiện `isHolder`:
     `const isHolder = myUserId !== null && (holderId === myUserId || (holderId === null && myRole === "owner"));`
   - Khi `myRole === "owner"` và `holderId === null`:
     - Nếu chưa có `pendingRequests`, component trả về `null` (không hiện thanh `Xin quyền chạy`).
     - Nếu có yêu cầu xin quyền từ thành viên khác, hiển thị toast `Cấp quyền`.
2. **`web/src/modules/room/api.ts`**
   - Mở rộng helper `send` hỗ trợ method `"DELETE"`.
   - Thêm hàm `removeMember(projectId: string, memberUserId: string, fetchImpl: typeof fetch = fetch): Promise<void>` gọi `DELETE /api/v1/cloud/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberUserId)}` với `credentials: "same-origin"`, `cache: "no-store"`, ném `RoomApiError` khi `!res.ok`.
3. **`web/src/modules/room/components/invite-dialog.tsx`**
   - Khi `membersState === "ready"`, hiển thị nút **Thu hồi** (`data-testid="room-member-remove"`) cho mỗi thành viên có `m.role !== "owner"` và `m.userId !== user?.id`, disable nút trong lúc đang gọi (`removingId === m.userId`).
   - Khi xóa thành công, loại bỏ `m.userId` khỏi danh sách `members` ngay lập tức; khi thất bại, hiển thị thông báo lỗi `data-testid="room-member-remove-error"`.
4. **`web/messages/vi/room.json` & `web/messages/en/room.json`**
   - Bổ sung 3 khóa song ngữ trong `invite`: `removeMember`, `removingMember`, `removeFailed`.
5. **Unit tests (`baton-request-toast.test.tsx`, `invite-dialog.test.tsx`)**
   - Bổ sung test cho AC1 (Owner khi `holderId === null` và không có `pendingRequests` trả `null`; Owner vẫn thấy toast khi có người xin quyền).
   - Bổ sung test cho AC2 (hiển thị nút Thu hồi cho `editor`/`viewer`, không hiện cho `owner`, gọi `DELETE .../members/:uid` và cập nhật danh sách; ca lỗi giữ nguyên danh sách và hiện thông báo lỗi).

## 2. Kết quả kiểm tra (AC3)
- `npm run check:i18n`: PASS.
- `npm run lint` (`eslint`): PASS (0 errors, 3 warnings có sẵn ngoài phạm vi Task176).
- `npm run typecheck` (`tsc --noEmit`): PASS.
- `vitest` (chạy trên file liên quan):
  - `src/modules/room/components/invite-dialog.test.tsx`: 13/13 PASS.
  - `src/modules/room/components/baton-request-toast.test.tsx`: 7/7 PASS.
- Toàn bộ `npm run check`: 138/139 file PASS (1591 passed, 18 skipped); chỉ 1 ca sẵn có ngoài phạm vi (`src/modules/room/fork/fork-dialog.test.tsx > AC4: hiển thị số byte thật và tên tab vi phạm khi vượt 512 KB`) fail độc lập khi chạy lại riêng lẻ.

## 3. Phạm vi file
- Chỉ sửa đúng các file trong phạm vi được giao; không chạm `api/`, `use-lab-room-collab.ts`, `lab-workspace.tsx`.
