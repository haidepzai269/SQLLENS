# Bàn giao Task161 — Gin API phòng cộng tác (SP024 / STR116)

Đã làm: sáu endpoint phòng cộng tác trên nền cloud project (`POST /invite` token 24h lưu SHA-256; `POST /join` nhận token gia nhập dự án; `DELETE /:id/members/:uid` thu hồi thành viên; `GET /:id/baton` & `POST /:id/baton/claim` quản lý Baton; `GET/POST /:id/arena-step` lưu và đọc bước đấu trường Arena) và migration `007_room_api.sql` (thêm cột `arena_step`, 2 policy chỉ-đọc theo GUC `app.invite_hash` trong transaction scope, FORCE RLS 5 bảng, khối DO $$ tự kiểm catalog). Tuân thủ 100% Zero-Log Transit: 0 byte SQL vào Neon, 0 dòng log SQL trong Gin (chỉ log `%T` lỗi).

File chính: `api/migrations/007_room_api.sql` (migration schema & policy), `api/internal/store/live_rooms.go` (store methods), `api/internal/store/tenant.go` (`WithInvite`), `api/internal/store/cloud.go` (`GetCloudProject`), `api/internal/httpapi/live_rooms.go` (6 endpoint), `api/internal/httpapi/live_rooms_test.go` (9 test case), `api/internal/store/live_rooms_rls_test.go` (test RLS role app non-superuser).

Kết quả kiểm tra (PostgreSQL 18 thật cluster `t161-pg`, database `app161`, role non-superuser `sqllens_app`): `gofmt -l .` sạch; `go vet ./...` sạch; `go test -p 1 ./... -count=1` **8/8 package ok** (httpapi 17.767s, store 10.926s); `npm run check:i18n` pass 100%.

Kết quả review: độc lập nghiệm thu **PASS 100%** (5/5 AC đạt, 9 ca biên đạt, 7 ca đột biến M1–M7 chứng minh test biết đỏ khi phá hoại logic/RLS, phản chứng gỡ FORCE RLS hay DISABLE RLS test đều FAIL lập tức; catalog 007 tự kiểm 5 mệnh đề nổ lỗi chuẩn xác khi bị sabotage).

Chưa làm được: chưa có giao diện frontend (thuộc Task162 cho dialog mời và Task169 cho Arena polling 3s).

Phát sinh: không có lỗi phát sinh mới vào SP999.

Việc tiếp theo cần biết:
1. **Task162 (UI Mời cộng tác):** Gọi `POST /api/v1/cloud/projects/:id/invite` để lấy token 24h dạng `{token, role, expiresAt}`, và màn hình join gọi `POST /api/v1/cloud/projects/join` với body `{"token": "..."}`.
2. **Task169 (Arena Cytoscape):** Dùng `POST /api/v1/cloud/projects/:id/arena-step` với body `{"step": N}` (chỉ owner) và `GET /api/v1/cloud/projects/:id/arena-step` (polling 3s cho mọi viewer) để đồng bộ bước đấu trường.
