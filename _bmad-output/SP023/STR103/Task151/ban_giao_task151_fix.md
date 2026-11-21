# Bàn giao vòng sửa lỗi SP023 (review độc lập Task149–Task153)

Reviewer độc lập tìm ra 5 lỗi trong SP023 (3 lỗi backend, 2 lỗi frontend). Vòng này sửa cả 5, mỗi lỗi có test chứng minh **FAIL trước khi sửa / PASS sau khi sửa**. Không đổi hướng nào so với phương án chủ dự án đã chốt.

## LỖI 1 [BLOCKER] — `viewer` vẫn sửa/xóa được tab của dự án được chia sẻ

**Nguyên nhân:** `api/migrations/004_cloud_rls.sql` dòng 63–81, ba policy ghi của `cloud_tabs` chỉ kiểm `EXISTS (SELECT 1 FROM public.cloud_projects p WHERE p.id = cloud_tabs.project_id)`. Điều kiện này đúng với **mọi** thành viên, kể cả `viewer`; cột `cloud_project_members.role` không được dùng ở đâu. Ghi chú "chưa siết role" trong `ban_giao_task151.md` (mục 1) chính là lỗ này, nay đã đóng.

**Cách sửa:** migration mới `api/migrations/005_cloud_tabs_write_role.sql` (**không sửa 004** — file đó đã nằm trong `schema_migrations`, sửa vào không có tác dụng trên database đã migrate). Ba policy ghi (`cloud_tabs_insert/update/delete`) được `DROP POLICY IF EXISTS` rồi `CREATE POLICY` lại, yêu cầu **owner** (`p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid`) **hoặc** thành viên có `m.role IN ('owner','editor')`. UPDATE có cả `USING` và `WITH CHECK`. Policy `SELECT` giữ nguyên (viewer vẫn phải đọc được).

Migration **đọc lại catalog** rồi `RAISE EXCEPTION` nếu sai, vì `store.Migrate` chạy qua pgx nên `NOTICE/WARNING` không hiện ra ở đâu cả (bài học Task149): (4a) đủ 3 policy ghi; (4b) biểu thức policy phải nhắc tới `role`; (4c) policy ghi phải có `WITH CHECK` tường minh; (4d) policy `SELECT` **không được** nhắc tới `role`. Chạy hai lần trên database sạch `scratch005b` đều sạch.

Policy của `cloud_tabs` đọc `cloud_projects` và `cloud_project_members`; hai bảng đó **không** đọc ngược lại `cloud_tabs`, nên **không có** `infinite recursion detected in policy` — đã kiểm bằng máy trên PostgreSQL 18.6.

**Test:** `TestRLSMemberRoleGateOnTabs` (`api/internal/store/tenant_rls_test.go`). Fixture thêm user Dũng `eeeeeeee-0000-4000-8000-000000000005` làm `editor` của dự án Bình sở hữu.

| Vai | SELECT | UPDATE | DELETE | INSERT |
|---|---|---|---|---|
| Chi (`viewer`) | 1 tab | **0** | **0** | `ERROR: new row violates row-level security policy for table "cloud_tabs"` |
| Dũng (`editor`) | 2 tab | 1 | 1 | 1 |
| Bình (owner) | 2 tab | 1 | 1 | 1 |

**FAIL trước khi sửa:** với 004, Chi (`viewer`) UPDATE được 1 dòng, DELETE được 1 dòng, INSERT lọt — test đỏ đúng ở ba dòng đó.
**PASS sau khi sửa:** `--- PASS: TestRLSMemberRoleGateOnTabs (0.76s)`, `TestRLSMemberReadsButCannotDelete (0.55s)` vẫn xanh (không nới lỏng gì).

## LỖI 2 [BLOCKER] — `go test ./...` đỏ, 8 test `auth` hỏng

**Nguyên nhân:** `resetDB` trong `api/internal/auth/auth_test.go` chạy `DROP TABLE IF EXISTS sessions, identities, users, schema_migrations` **không có `CASCADE`**. Migration 003 tạo khóa ngoại `cloud_projects.owner_id → users(id)`, nên `DROP TABLE users` bị chặn: `ERROR: cannot drop desired object(s) because other objects depend on them (SQLSTATE 2BP01)`. 8 test dùng `newEnv` đều chết ở bước dọn database, không phải ở logic.

**Cách sửa:** thêm `CASCADE` và liệt kê đủ bảng cloud theo đúng thứ tự phụ thuộc (`cloud_project_members`, `cloud_tabs`, `cloud_projects`, `user_vip_redemptions`, `vip_codes`, `sessions`, `identities`, `users`, `schema_migrations`). Thêm `dropAppRole` chạy trong `t.Cleanup` ngay sau `st.Migrate`: role `sqllens_app` là role **cấp cluster** còn `GRANT` là cấp **database**, nên `GRANT` còn sót ở database khác (ví dụ `authtest`) làm `DROP ROLE` của package `store` thất bại với `SQLSTATE 2BP01` — đó là ô nhiễm chéo giữa các package test, đã gặp thật.

**FAIL trước khi sửa:** `internal/auth` đỏ 8 test, thông điệp `dọn database: ERROR: cannot drop desired object(s) … (SQLSTATE 2BP01)`.
**PASS sau khi sửa:** `ok github.com/haidepzai269/SQLLENS/api/internal/auth 6.534s`.

## LỖI 3 — trần body 1MB toàn cục chặn quota 100 tab × 512KB

**Nguyên nhân:** router bọc **mọi** route bằng `http.MaxBytesReader` 1MB, trong khi `store` cho phép 100 tab × 512KB. Quota khai báo không đạt được: request bị 413 trước khi tới handler.

**Cách sửa (đúng 4 bước đã chốt):**
1. `api/internal/store/cloud.go`: thêm `MaxCloudProjectBytes = 2 * 1024 * 1024` và `ErrCloudProjectTooLarge`; `ValidateCloudInput` cộng dồn `len(t.SQL) + len(t.Name)` của từng tab, vượt 2MB thì trả `ErrCloudProjectTooLarge`. Kèm ghi chú vì sao chọn 2MB: 100 × 512KB = 50MB là con số không thể đạt, 2MB là mức dùng thật.
2. `api/internal/httpapi/router.go`: `bodyLimit{prefix, max}` + `maxBodyFor(path, def, overrides)` (khớp tiền tố dài nhất thắng) + `limitBody(...)`. Route cloud nhận **một** limiter 3MB (2MB dữ liệu + 1MB phần bao), các route khác giữ 1MB. Route cloud **không** bị bọc bởi `http.MaxBytesReader` 1MB nữa, nên không có chuyện bọc hai lần.
3. `api/internal/httpapi/cloud_projects.go`: `codeCloudProjectTooBig = "project_too_large"`, ánh xạ `ErrCloudProjectTooLarge` → 400 `project_too_large`.
4. Test + tài liệu.

**Test:** `TestValidateCloudInputTotalBytes` (`api/internal/store/cloud_validate_test.go`) và `TestCloudBodyLimitPerProject` (`api/internal/httpapi/cloud_projects_test.go`).

| Ca | Kỳ vọng | Kết quả |
|---|---|---|
| 1 tab 512KB | hợp lệ | PASS |
| 2 tab 512KB (1MB) | hợp lệ, 201, 2 dòng | PASS |
| 1 tab 600KB | `ErrCloudTabTooLarge` → 400 `tab_too_large` | PASS |
| 5 tab × 450KB = 2,25MB | `ErrCloudProjectTooLarge` → 400 `project_too_large`, **không ghi một phần** | PASS |
| 100 tab, tên 24KB | `ErrCloudProjectTooLarge` | PASS |
| Route khác `/echo/1` với 1536KB | vẫn 413 `payload_too_large` | PASS |

**FAIL trước khi sửa:** 2 tab × 512KB nhận 413 thay vì 201 (trần 1MB toàn cục).
**PASS sau khi sửa:** `--- PASS: TestCloudBodyLimitPerProject (0.78s)`, `--- PASS: TestValidateCloudInputTotalBytes (0.00s)`.

**Hệ quả cần biết (ghi ở đây thay vì để người sau phát hiện):** trần **tổng** 2MB nghĩa là với tab 512KB chỉ chứa được **3–4 tab** trong một dự án, không phải 100. Con số "100 tab" trong quota chỉ đạt được khi tab nhỏ. Muốn 100 tab × 512KB thật thì phải nâng trần body lên ~52MB, việc đó cần chủ dự án quyết vì ảnh hưởng RAM của Gin trên Render free.

## LỖI 4 [CHẶN] — đẩy hai lần tạo **hai** dự án cloud trùng

**Nguyên nhân:** `web/src/modules/cloud/sync.ts` gọi POST xong mới ghi `cloud.remoteId` xuống IndexedDB. Nếu lần ghi local hỏng (hết quota, tab bị đóng), server **đã** tạo dự án nhưng local không biết id của nó, nên lần đẩy sau lại POST lần nữa. Comment cũ trong file khẳng định "lần đẩy sau sẽ nhận 409" là **sai**: 409 chỉ xảy ra với PUT (có `baseUpdatedAt`), không bao giờ với POST.

**Bằng chứng của reviewer:** `LẦN 1 lỗi: FAILED` / `LẦN 2 kết quả: {"kind":"ok",…}` / `SỐ REQUEST: 2 [{"method":"POST",…},{"method":"POST",…}]`.

**Cách sửa (phương án RECOMMENDED đã chốt):** giữ `remoteId` của server trong một `Map` ở phạm vi module (`unpersistedLinks`), nên lần đẩy sau dùng PUT vào đúng id đó thay vì POST lần hai. Xoá comment sai và viết lại phần giải thích vì sao cần Map này. Thêm `forgetUnpersistedLinks()` chỉ dùng cho test.

**Test:** `LỖI 4: ghi local hỏng sau khi POST thành công thì lần sau PUT, chỉ một POST duy nhất` (`web/src/modules/cloud/sync.test.ts`). Khẳng định `calls.map(c => c.method)` bằng `["POST", "PUT"]`, URL lần hai là `/api/v1/cloud/projects/remote-9`, `baseUpdatedAt` = `"2026-11-21T08:30:00Z"`.

**FAIL trước khi sửa:** `expect(calls.map((c) => c.method)).toEqual(["POST","PUT"])` nhận `- "PUT" + "POST"` (hai POST).
**PASS sau khi sửa:** `✓ 16 tests` cho `sync.test.ts`.

## LỖI 5 [CHẶN] — 404 của dự án đã bị xóa thì kẹt vĩnh viễn

**Nguyên nhân:** server trả 404 cho một `cloud.remoteId` đang có, `sync.ts` ném `CloudSyncError("NOT_FOUND")`, nhưng liên kết `cloud.remoteId` **vẫn nằm** trong IndexedDB. Mọi lần đẩy sau lại PUT vào id đã chết → 404 mãi, không có lối thoát.

**Bằng chứng của reviewer:** `LẦN 1: NOT_FOUND` / `LẦN 2: NOT_FOUND` / `LIÊN KẾT CLOUD SAU KHI LỖI: {"remoteId":"remote-da-xoa",…}` / `SỐ REQUEST: ["PUT …/remote-da-xoa","PUT …/remote-da-xoa"]`.

**Cách sửa:** `PushResult` thêm nhánh `{ kind: "remote_gone"; remoteId: string }`. **Không** tự xóa liên kết (Task154 sẽ hỏi người dùng — không được tự xóa dữ liệu). Lối thoát gồm hai đường:
- `pushProject(projectId, { asNew: true })` — bỏ qua liên kết, tạo dự án mới trên cloud.
- `detachCloudLink(projectId)` — gỡ `cloud` khỏi bản local rồi ghi xuống IndexedDB, không đụng gì trên server.

Giao diện phân biệt được 404-đã-xóa với lỗi mạng: nhánh `remote_gone` chỉ trả về khi `err.status === 404` **và** đang có liên kết; mất mạng vẫn là `NETWORK`. `cloud-panel.tsx` hiện khối cảnh báo riêng (`data-testid="cloud-remote-gone"`) với hai nút "Lưu thành dự án mới" / "Gỡ liên kết".

**Test:** ba ca trong `sync.test.ts` — `…remote_gone, giữ liên kết, có lối thoát`, `detachCloudLink gỡ liên kết chết…`, `404 khác lỗi mạng — mất mạng vẫn là NETWORK`.

**FAIL trước khi sửa:** `CloudSyncError: Dự án không còn trên cloud` ném từ `failure src/modules/cloud/sync.ts:95:36`, `Caused by: CloudApiError: Máy chủ từ chối yêu cầu cloud (404)`; `Test Files 1 failed (1) / Tests 2 failed (2)`.
**PASS sau khi sửa:** `Tests 2 passed (2)` (tệp tái hiện tạm, đã xóa) và 16/16 test của `sync.test.ts`.

## Lỗi phụ đã sửa kèm

- `web/vitest.config.mts`: Vite không phân giải được `next/navigation` khi nó được import từ **bên trong** `node_modules/next-intl/dist/...` (bộ phân giải của Vite đòi đúng tên tệp, không tự thêm `.js` như Node). Task154 nối `CloudPanel` vào `ProjectSwitcher` nên `project-switcher.test.tsx` và `tab-bar.test.tsx` vỡ. Sửa bằng alias trỏ thẳng `node_modules/next/navigation.js` cộng `server.deps.inline: ["next-intl"]` để alias có hiệu lực bên trong gói. Cách này thay cho việc mock `@/i18n/navigation` ở từng tệp test (cách cũ ghi trong `share-view.test.tsx`).
- `api/internal/store/store_cloud_test.go`: `TestCloudPreexistingTableMissingIndexedColumn` phải `DROP POLICY` của **cả** `cloud_tabs` (không chỉ `cloud_projects`), vì policy ghi của 005 tham chiếu `cloud_projects.owner_id` nên `ALTER TABLE … DROP COLUMN owner_id` bị chặn (`SQLSTATE 2BP01`).
- `tenant_rls_test.go`: sửa một dòng có comment dính liền vào `func TestRLSContextLeakOnSamePool` (lỗi soạn thảo từ trước).

## Số đo cuối

```
gofmt -l .            → internal\ai\ai_test.go, internal\ai\inline_complete_test.go  (ngoài phạm vi, giữ nguyên)
go vet ./...          → sạch
go test -p 1 -count=1 ./...
ok  cmd/server                0.245s
ok  internal/ai               2.148s
ok  internal/auth             6.534s
ok  internal/httpapi          5.162s
ok  internal/mysql            0.777s
ok  internal/quota            2.413s
ok  internal/store           20.502s
?   migrations               [no test files]

cd web && npm run check
  check:i18n  → sạch
  lint        → 0 error, 1 warning có từ trước (e2e/plan-explain.spec.ts: 'hist' không dùng)
  typecheck   → sạch
  test        → Test Files 112 passed | 2 skipped (114), Tests 1386 passed | 18 skipped (1404)
```

## Việc chưa làm / chưa kiểm

1. **Trần 2MB tổng** khiến tab 512KB chỉ chứa được 3–4 tab/dự án. Muốn đạt "100 tab × 512KB" phải nâng trần body lên ~52MB — cần chủ dự án quyết vì ảnh hưởng RAM Gin trên Render free.
2. Chưa chạy trên **Neon thật**; mọi số đo trên PostgreSQL 18.6 trong Docker.
3. `005` chỉ chạy một lần (đã ghi `schema_migrations`): ai `DROP POLICY` bằng tay sau đó thì không có gì tự sửa lại.
4. Policy mới **chưa** được kiểm với thành viên `role` lạ (giá trị ngoài `owner/editor/viewer`) — `cloud_project_members` chưa có `CHECK` ràng buộc tập giá trị; hiện dựa vào code Go.
5. `app.owned_projects` vẫn tính một lần đầu transaction (giới hạn đã biết từ Task151, chưa ảnh hưởng đường hiện tại).
6. Frontend: `cloud-panel.tsx` là mã đang làm dở của Task154; vòng này chỉ nối thêm nhánh `remote_gone` và hai nút thoát, chưa phải bản hoàn chỉnh của Task154.
