# Task160: Migration 006 — Schema phòng mở rộng cloud_project_members

Thuộc: SP024 / STR116
Mục tiêu: Có bảng thật cho phòng cộng tác (invite token + Baton) trước khi viết bất kỳ API hay giao diện nào, và chứng minh bằng máy rằng RLS chặn cross-tenant trên hai bảng mới.

Phạm vi:
- `api/migrations/006_live_rooms.sql` (mới — migration duy nhất)
- `api/internal/store/live_rooms_006_test.go` (mới — test AC1/AC2)
- `api/internal/store/tenant_rls_test.go` (chỉ thêm `room_invite_tokens, room_baton` vào câu `DROP TABLE` của helper `newRLSEnv`, để lần chạy sau không dựng lại trên bảng cũ mất FK)

Không làm:
- Không viết handler Gin, không viết TypeScript, không thêm dependency. Task161 lo API.
- Không tạo bảng `live_rooms`: **phòng IS a cloud project** (quyết định C1). Host = `cloud_projects.owner_id`.
- Không đổi schema 3 bảng cloud cũ, không đổi migration 001–005.
- Không đổi Core Rule 7. Không lưu SQL người dùng ở bất kỳ cột nào.
- Không đụng file nào trong scope SP999.

Hợp đồng (Task161/162/163 dựa vào):
- `public.room_invite_tokens(token text PRIMARY KEY, project_id uuid NOT NULL → cloud_projects ON DELETE CASCADE, role text NOT NULL CHECK (role IN ('editor','viewer')), expires_at timestamptz NOT NULL, used_at timestamptz NULL)`
- `public.room_baton(project_id uuid PRIMARY KEY → cloud_projects ON DELETE CASCADE, holder_id uuid NULL → users ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now())`
- Cả hai bảng `ENABLE` + `FORCE ROW LEVEL SECURITY`, 6 policy tách theo lệnh, lệnh ghi có `WITH CHECK` tường minh, `sqllens_app` được `GRANT SELECT/INSERT/UPDATE/DELETE`.
- Quyền trên token: **chỉ owner** đọc/ghi/xoá. Quyền trên Baton: owner đọc/ghi; thành viên dự án (`cloud_project_members`) **chỉ đọc**.

Tiêu chí xong:

- **AC1 — Cross-tenant bị chặn, chạy bằng role bị RLS áp dụng.** `TestLiveRoom006Migration` trong `api/internal/store` chạy trên PostgreSQL thật với role app `sqllens_app` (NOSUPERUSER NOBYPASSRLS), khẳng định đủ hai chiều:
  - A tạo được token cho dự án **của mình** (1 hàng), không đọc được token của dự án B (0 hàng), `INSERT` token vào dự án của B bị `row-level security` chặn, `DELETE`/`UPDATE` token của B trả 0 hàng.
  - Thành viên `viewer` của dự án B **không** đọc được token của B (token chỉ dành cho owner), nhưng **đọc được** `room_baton` của B và không `UPDATE`/`INSERT` được Baton đó.
  - Phép phản chứng: `ALTER TABLE room_invite_tokens DISABLE ROW LEVEL SECURITY` → cùng câu SELECT **thấy** token của người khác. Không có phép này thì test xanh cả khi RLS hỏng.
- **AC2 — Migration tự kiểm catalog.** Khối `DO $$` đọc lại `pg_class.relforcerowsecurity`, `pg_policies` (đủ 6 policy, lệnh ghi có `WITH CHECK`) và `has_table_privilege('sqllens_app', …)`, `RAISE EXCEPTION` nếu thiếu. Test độc lập kiểm lại đúng các điều kiện đó để không tin lời khối `DO`.
- **AC3 — Không làm hỏng bộ test cũ.** `go test -p 1 ./...` 7/7 package xanh, không deadlock, không `schema_migrations` conflict; `go vet ./...` sạch.

Ca biên:
- Chạy `Migrate` hai lần trên database đã có 006: không lỗi, không nhân đôi policy (`CREATE TABLE IF NOT EXISTS` + `CREATE POLICY` không idempotent — phải chứng minh chạy lại an toàn theo cách `schema_migrations` chặn).
- `INSERT` token với `role = 'owner'`: bị `CHECK` chặn.
- Token **hết hạn** vẫn đọc được ở tầng DB (DB không phải nơi kiểm hạn): test khẳng định rõ điều này để Task161 không tưởng RLS lo hộ.
- Xoá dự án (bằng role chủ) → token và Baton của dự án đó biến mất theo (`ON DELETE CASCADE`).
- Xoá user giữ Baton → `holder_id` về `NULL`, hàng Baton còn lại.
- Người ngoài cuộc (không owner, không thành viên) đọc `room_baton` của dự án B: 0 hàng.

Giao diện: không có màn hình.

Kiểm tra:
- `docker run -d --name t160-pg -e POSTGRES_PASSWORD=t152 -e POSTGRES_DB=app -p 54492:5432 postgres:18`
- `cd api && RLS_TEST_DSN=postgres://postgres:t152@localhost:54492/app go test -p 1 ./internal/store -run 'LiveRoom006' -v`
- `cd api && RLS_TEST_DSN=... go test -p 1 -count=1 ./...`
- `cd api && go vet ./... && gofmt -l .`
- Tắt container trước khi báo cáo.

Góc review thêm: bảo mật (RLS + GRANT + false-green); tính thật của test (phải chạy role non-superuser, phải có phép phản chứng bỏ FORCE/RLS).

Đọc thêm: `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md` mục C + D (Task160), `api/migrations/004_cloud_rls.sql`, `api/migrations/005_cloud_tabs_write_role.sql`, `api/internal/store/tenant.go`, `api/internal/store/tenant_rls_test.go`, `_bmad-output/SP023/STR103/Task152/` (bài học false-green).

## Sai lệch đã ghi nhận so với bản nháp v3

1. **Bản nháp ghi "không có code Go", nhưng AC1 đòi một test Go.** Task này coi file test AC1 là phần bắt buộc của phạm vi (không có test thì AC1 không tồn tại).
2. **Thêm index `room_invite_tokens(project_id)`** — bản nháp không có; thiếu index thì mỗi lần xoá dự án phải quét toàn bảng token.
3. **Cột `token` hiện lưu token thô theo đúng bản duyệt.** Việc đổi sang lưu SHA-256 là quyết định của chủ dự án, ghi thành phát sinh bắt buộc cho Task161, không tự đổi hợp đồng trong task này.
