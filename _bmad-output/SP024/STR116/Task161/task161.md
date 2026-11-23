# Task161 — Gin API phòng (mở rộng từ SP023 cloud API)

**Mục tiêu:** sáu endpoint phòng cộng tác trên nền cloud project SP023: mời bằng token, gia nhập bằng token, thu hồi thành viên, đọc Baton, claim Baton, và lưu/đọc `{step: N}` cho Arena.

**Nguồn có thẩm quyền:** `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md` §Task161 (dòng 186–204). Không nới hợp đồng ngoài các sai lệch ghi ở cuối file.

**Phạm vi file (dự kiến 6):**
- `api/migrations/007_room_api.sql` (mới — hai policy chỉ-đọc theo `app.invite_hash`, cột `arena_step`)
- `api/internal/store/live_rooms.go` (mới — sáu thao tác store)
- `api/internal/httpapi/live_rooms.go` (mới — sáu endpoint, mount từ `MountCloud`)
- `api/internal/store/cloud.go` (sửa — `GetCloudProject` cho thành viên đọc)
- `api/internal/httpapi/live_rooms_test.go` (mới — ≥ 6 case, mỗi endpoint một case)
- `api/internal/store/tenant_rls_test.go` (nếu helper cần thêm bảng — dự kiến không)

Không chạm frontend, không thêm dependency, không đổi `main.go` (route gắn trong `MountCloud`).

**Hợp đồng endpoint** (tất cả dưới `RequireUser`, cùng nhóm `/api/v1/cloud/projects`):

| Phương thức | Đường | Ai | Trả |
|---|---|---|---|
| POST | `/:id/invite` | owner | `{token, role, expiresAt}` — token 24 h |
| POST | `/join` | người có token | `{projectId, role, alreadyMember}` |
| DELETE | `/:id/members/:uid` | owner | 204 |
| GET | `/:id/baton` | owner hoặc thành viên | `{holderId, step, updatedAt}` |
| POST | `/:id/baton/claim` | owner | `{holderId, step, updatedAt}` |
| POST | `/:id/arena-step` | owner | `{step}` |
| GET | `/:id/arena-step` | owner hoặc thành viên | `{step}` |

`arena-step` là **một** mục endpoint (hai phương thức) — AC4 đếm 6.

**AC (nguyên văn bản duyệt):**
- AC1: `POST /invite` → token 24 h; `POST /join` với token hết hạn → **410 `token_expired`**
- AC2: `DELETE /members/:uid` → **403** khi không phải owner; thành viên bị xóa gọi `GET /projects/:id` → **404**
- AC3: Gin chỉ log `%T` của lỗi, **0 byte SQL** trong log
- AC4: `go test -p 1 ./internal/httpapi/...` có **≥ 6 test case, mỗi endpoint một case**
- AC5: gọi `r.Routes()`, khẳng định **không panic trùng handler** và liệt kê đủ 6 đường dẫn

**Ca biên phải có test:** token sai/không tồn tại; token hết hạn (410, không phải 404); người ngoài gọi `/join` bằng token của dự án khác vẫn vào được (đó là mục đích) nhưng **không** đọc được token khác; join lần hai (idempotent, `alreadyMember: true`); owner tự xoá mình (400); xoá thành viên không tồn tại (404); `step` âm hoặc phi số (400); thành viên gọi `POST /arena-step` (403); project của người khác khi chưa join (404, không lộ tồn tại).

**Sai lệch đã ghi nhận so với bản nháp v3 (bắt buộc reviewer đọc):**

1. **Token lưu SHA-256, không lưu thô.** Phát sinh từ Task160 (`ban_giao_task160.md` mục 1). Lý do kỹ thuật mới: để tra token mà chưa biết owner, câu tra phải so theo giá trị token; lưu thô thì chính câu tra đó là thứ kẻ tấn công cần. Hash làm cả hai việc: tra được và không lộ vé khi Neon bị dump. Cột vẫn tên `token`, kiểu `TEXT` — **không đổi schema 006**.
2. **Phải thêm migration 007.** Bản nháp chỉ cho Task161 sửa `store/cloud.go`. Nhưng policy token của 006 là owner-only, nên một người chưa là thành viên **không thể đọc hàng token của mình** — `POST /join` không có đường chạy. 007 thêm đúng hai policy **chỉ đọc**, khoá theo GUC `app.invite_hash` mà handler đặt trong transaction: (a) `room_invite_tokens` đọc được hàng có `token = app.invite_hash`; (b) `cloud_projects` đọc được dự án có invite khớp `app.invite_hash` (để biết owner mà ghi thành viên bằng ngữ cảnh owner). Không policy nào cho ghi. Không đọc chéo `cloud_projects` từ policy token nên không đệ quy.
3. **Thêm cột `room_baton.arena_step`** (007). Bản nháp đòi lưu `{step: N}` nhưng 006 không có chỗ chứa. Một hàng `room_baton` mỗi dự án giữ cả người giữ gậy và bước hiện tại.
4. **`GetCloudProject` bỏ lọc `owner_id`.** AC2 chỉ có nghĩa nếu trước khi bị xoá thành viên **đọc được** dự án; hiện store lọc `owner_id = $2` nên thành viên luôn 404. Nay quyền đọc do RLS quyết (policy 004 đã cho thành viên đọc). `ListCloudProjects` **vẫn** chỉ của owner — bản nháp không nói gì về danh sách.
5. **`used_at` không bao giờ được ghi** và link mời **dùng lại được** tới khi hết hạn. 006 không có policy UPDATE nên không role nào stamp được cột đó (đã flag ở Task160). Chọn "link dùng chung như link Google Docs" thay vì "một lần", vì phòng cần nhiều người vào. `used_at` để trống; nếu chủ dự án muốn một-lần-thật thì phải thêm policy UPDATE + xoá dòng sau khi dùng — ghi thành việc mở.
6. **`POST /projects/join` có thể đụng `:id`.** Gin có thể panic `':id' in new path conflicts with existing wildcard` khi static `join` nằm cạnh param `:id`. AC5 kiểm đúng chuyện này; nếu panic thật thì đổi thành `POST /api/v1/cloud/join` và ghi lại ở bàn giao.

**Nhãn:** Chưa đo.
