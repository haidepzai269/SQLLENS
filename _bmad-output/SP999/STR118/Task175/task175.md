# Task175: Sửa `403 /members` ép Editor thành Viewer & Lệch `tabId` khi `pullProject`

- **Epic / Story:** SP999 / STR118 — Vá lỗi phát hiện từ Review Production (`BAO_CAO_REVIEW_SP024_PRODUCTION.md`)
- **Mục tiêu:** Sửa dứt điểm 2 lỗi chí mạng làm gãy K2 & K3 trên Production:
  1. `GET /members` trả `403` cho thành viên thường (`editor`/`viewer`) khiến `use-lab-room-collab.ts` fallback về `myRole: "viewer"` (`readOnly` + mất nút Chạy/Xin quyền).
  2. `pullProject` tạo `tabId` UUID mới khác Host khiến `createTabCollabExtension` gắn `Y.Text` theo `tab:${activeTabId}` không đồng bộ được giữa Host và Editor.
  3. Mặc định `holderId = ownerId` khi `room_baton` chưa có `holderId` (`null`).

## Phạm vi file (tuyệt đối không chạm ngoài danh sách)
- `api/internal/store/live_rooms.go`
- `api/internal/store/live_rooms_rls_test.go`
- `api/internal/httpapi/live_rooms.go`
- `api/internal/httpapi/live_rooms_test.go`
- `web/src/modules/room/collab/baton-store.ts`
- `web/src/modules/room/collab/use-lab-room-collab.ts`
- `web/src/modules/room/collab/use-lab-room-collab.test.ts`
- `web/src/modules/lab/lab-workspace.tsx`

## Hợp đồng kỹ thuật chi tiết

### 1. Backend Go (`api/internal/store/live_rooms.go` & `api/internal/httpapi/live_rooms.go`)
- Mở rộng `BatonState` thêm: `OwnerID string`, `OwnerName string`, `MyRole string`.
- Trong `GetBaton(ctx, userID, projectID)` và `ClaimBaton(ctx, ownerID, projectID)`:
  - Truy vấn `p.owner_id::text, u.display_name FROM cloud_projects p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`.
  - Nếu `userID == ownerID` → `MyRole = "owner"`; ngược lại đọc `role` của chính `userID` từ `cloud_project_members WHERE project_id = $1 AND user_id = $2` (100% hợp lệ dưới RLS hiện tại, **không** sửa migration/policy, và **giữ nguyên** `ListMembers` trả `403` cho non-owner để không phá test Task162).
- `batonJSON(b)` trong `httpapi/live_rooms.go` trả thêm `"ownerId"`, `"ownerName"`, `"myRole"`.
- Bổ sung test trong `live_rooms_test.go` và `live_rooms_rls_test.go` (chạy role non-superuser `sqllens_app`): `owner`, `editor`, `viewer` đều gọi được `GetBaton` và nhận đúng `myRole`, `ownerId`, `ownerName`.

### 2. Frontend (`baton-store.ts`, `use-lab-room-collab.ts`, `lab-workspace.tsx`)
- `baton-store.ts`: `BatonSnapshot` và `parseBatonSnapshot` parse thêm `ownerId?: string`, `ownerName?: string`, `myRole?: RoomRole`.
- `use-lab-room-collab.ts`:
  1. Gọi `GET /api/v1/cloud/projects/:id/baton` **trước** để lấy `myRole`, `ownerId`, `ownerName`, `holderId` (luôn 200 cho cả `owner`/`editor`/`viewer`). Nếu `holderId` là `null` thì mặc định đặt `effectiveHolderId = ownerId` vào `batonStore.setRoom({ projectId: remoteProjectId, myUserId: userId, myRole, holderId: effectiveHolderId })`.
  2. Chỉ khi `myRole === "owner"` mới gọi thêm `GET /api/v1/cloud/projects/:id/members` để nạp đủ `memberNames`; khi `myRole === "editor" | "viewer"`, **không** gọi `/members` (tránh `403`), nạp `memberNames = ownerName ? { [ownerId]: ownerName } : {}`.
  3. Thêm `activeTabPosition?: number | null` và `initialTabSql?: string` vào `UseLabRoomCollabOptions`. Khóa Yjs dùng:
     `const collabTabKey = activeTabPosition !== null && activeTabPosition !== undefined ? \`pos:${activeTabPosition}\` : activeTabId;`
     để Host và Editor luôn khớp cùng `Y.Text` (`tab:pos:0`, `tab:pos:1`, ...) dù `pullProject` tạo UUID tab mới.
  4. Khi `session.myRole === "owner"` và `yText.length === 0` và `initialTabSql` khác rỗng, seed nội dung ban đầu vào `yText` 1 lần (`session.provider.doc.transact(() => { if (yText.length === 0) yText.insert(0, initialTabSql); })`) trước khi tạo extension để Editor nối vào nhận ngay SQL gốc mà không bị nhân đôi.
- `lab-workspace.tsx`: truyền thêm `activeTabPosition={activeTab?.position ?? null}` và `initialTabSql={activeTab?.sql ?? ""}` vào `useLabRoomCollab(...)`.

## Tiêu chí nghiệm thu (AC1–AC5)
- **AC1:** `GET /baton` trả `200` kèm `ownerId`, `ownerName`, `myRole` cho cả `owner`, `editor`, `viewer` (kể cả dưới RLS role `sqllens_app`). `ListMembers` vẫn giữ nguyên `403` cho non-owner.
- **AC2:** `useLabRoomCollab` khi là `editor` không gọi `/members`, nhận đúng `myRole = "editor"`, không bị khóa `readOnly`, và `holderId` mặc định bằng `ownerId` nếu server trả `null`.
- **AC3:** Khóa `Y.Text` dùng `tab:pos:<position>` khi có `activeTabPosition`, và owner seed `initialTabSql` đúng 1 lần khi `yText.length === 0`.
- **AC4:** `go test -p 1 ./internal/store/... ./internal/httpapi/...` và `npm run check` PASS 100%.
- **AC5:** Lập `ban_giao_task175.md` tại `_bmad-output/SP999/STR118/Task175/ban_giao_task175.md`.
