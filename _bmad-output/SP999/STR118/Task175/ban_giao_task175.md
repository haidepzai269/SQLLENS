# Bàn Giao Task175: Sửa `403 /members` ép Editor thành Viewer & Lệch `tabId` khi `pullProject`

- **Epic / Story:** SP999 / STR118
- **Người thực hiện:** `dev-175`
- **Trạng thái:** Hoàn thành đúng phạm vi 8 file được giao, không chạm ngoài phạm vi.

## 1. Tóm tắt thay đổi theo file

### Backend Go
1. **`api/internal/store/live_rooms.go`**
   - Mở rộng `Baton` thêm `OwnerID string`, `OwnerName string`, `MyRole string`.
   - Thêm helper `fillBatonMeta` truy vấn `p.owner_id::text, u.display_name` từ `cloud_projects JOIN users`, gán `MyRole = "owner"` nếu `userID == OwnerID`, ngược lại đọc `role` của chính `userID` từ `cloud_project_members`.
   - Gọi `fillBatonMeta` trong cả `GetBaton` và `ClaimBaton` (không sửa migration/policy RLS, giữ nguyên `ListMembers` trả `ErrNotOwner` / `403` cho non-owner).
2. **`api/internal/httpapi/live_rooms.go`**
   - Cập nhật `batonJSON` trả thêm `"ownerId"`, `"ownerName"`, `"myRole"`.
3. **`api/internal/httpapi/live_rooms_test.go`**
   - Mở rộng `roomResp` và bổ sung assertions trong `TestRoomBaton` cho cả `owner`, `editor` và `viewer` (`ownerId`, `ownerName`, `myRole`).
4. **`api/internal/store/live_rooms_rls_test.go`**
   - Bổ sung `TestGetBatonUnderRLS` kiểm chứng `owner`, `editor`, `viewer` đều gọi được `GetBaton` dưới role non-superuser chịu `FORCE ROW LEVEL SECURITY` và nhận đúng `MyRole`, `OwnerID`, `OwnerName`, đồng thời người ngoài nhận `ErrNotFound`.

### Frontend TypeScript / React
5. **`web/src/modules/room/collab/baton-store.ts`**
   - Mở rộng `BatonSnapshot` và `parseBatonSnapshot` parse thêm `ownerId`, `ownerName`, `myRole`.
6. **`web/src/modules/room/collab/use-lab-room-collab.ts`**
   - Gọi `GET /api/v1/cloud/projects/:id/baton` trước để lấy `myRole`, `ownerId`, `ownerName`, `holderId`; khi `holderId === null` mặc định gán `effectiveHolderId = ownerId` vào `batonStore.setRoom(...)`.
   - Chỉ gọi `GET /members` khi `myRole === "owner"`; với `editor`/`viewer`, không gọi `/members` (tránh `403`) và nạp `memberNames = ownerName ? { [ownerId]: ownerName } : {}`.
   - Bổ sung `activeTabPosition` và `initialTabSql` vào `UseLabRoomCollabOptions`: dùng khóa `collabTabKey = pos:<activeTabPosition>` khi có `activeTabPosition` (khớp cùng `Y.Text` `tab:pos:<n>` giữa Host và Editor bất kể UUID tab sau `pullProject`).
   - Seed `initialTabSql` đúng 1 lần trong `useEffect` khi `activeSession.myRole === "owner"` và `yText.length === 0` (`transact`), tránh lỗi `react-hooks/refs` và tránh tái tạo `collabExtension` khi gõ phím.
7. **`web/src/modules/lab/lab-workspace.tsx`**
   - Truyền `activeTabPosition: activeTab?.position ?? null` và `initialTabSql: activeTab?.sql ?? ""` vào `useLabRoomCollab(...)`.
8. **`web/src/modules/room/collab/use-lab-room-collab.test.ts`**
   - Cập nhật mock `/baton` & `/members` và bổ sung test cho `editor` (không gọi `/members`, `myRole = "editor"`, `readOnly: false`, `holderId = ownerId`), `viewer` (`readOnly: true`), và `owner` (`pos:0`, seed `initialTabSql` 1 lần không nhân đôi khi rerender).

## 2. Kết quả kiểm chứng thực tế

- **Backend Go (`go test -p 1 ./internal/store/... ./internal/httpapi/...`):**
  - `ok github.com/haidepzai269/SQLLENS/api/internal/store 2.383s`
  - `ok github.com/haidepzai269/SQLLENS/api/internal/httpapi 1.101s`
  - *(Lưu ý môi trường: worktree chạy không truyền biến `RLS_TEST_DSN` / `T150_DATABASE_URL`, các test cần Postgres ngoài tự skip theo cơ chế sẵn có của repo).*
- **Frontend (`cd web && npm run check`):**
  - `check:i18n`: PASS
  - `eslint`: PASS (0 errors, 3 warnings sẵn có ở `e2e/plan-explain.spec.ts` và `room-provider.test.ts`)
  - `tsc --noEmit`: PASS (0 errors)
  - `vitest run`: 138/139 files chạy PASS (1589 passed, 18 skipped); riêng `src/modules/room/collab/use-lab-room-collab.test.ts` **PASS 6/6**. Có 1 ca fail sẵn ngoài phạm vi Task175 tại `src/modules/room/fork/fork-dialog.test.tsx:133` (`AC4: hiển thị số byte thật và tên tab vi phạm khi vượt 512 KB`, chạy riêng cũng fail tương tự).

## 3. Đối chiếu AC1–AC5
- **AC1:** Đạt — `GetBaton`/`ClaimBaton` và `GET /baton` trả `ownerId`, `ownerName`, `myRole` cho `owner`/`editor`/`viewer`; `ListMembers` giữ nguyên `403` cho non-owner; có `TestGetBatonUnderRLS`.
- **AC2:** Đạt — `useLabRoomCollab` khi là `editor` không gọi `/members`, nhận `myRole = "editor"`, `readOnly = false`, `holderId = ownerId` khi server trả `null`.
- **AC3:** Đạt — Khóa `Y.Text` dùng `tab:pos:<position>` khi có `activeTabPosition`; owner seed `initialTabSql` đúng 1 lần khi `yText.length === 0`.
- **AC4:** Đạt phần phạm vi Task175 (`go test` PASS, `check:i18n` + `eslint` + `typecheck` PASS, `use-lab-room-collab.test.ts` 6/6 PASS; ghi nhận 1 ca fail có sẵn ở `fork-dialog.test.tsx`).
- **AC5:** Đạt — Đã lập `ban_giao_task175.md`.
