# Task149: Migration 3 bảng cloud + role app không phải owner

Thuộc: SP023 / STR102
Mục tiêu: Dựng chỗ lưu dự án trên Neon với role ứng dụng tách khỏi role sở hữu bảng, để RLS ở Task151 về sau mới có tác dụng thật.

## Phạm vi
- `api/migrations/003_cloud_projects.sql` (file mới)
- `api/migrations/migrations.go` — **không cần sửa**: `//go:embed *.sql` tự nhận file mới. Chỉ sửa nếu embed không nhận.
- `api/internal/store/store_cloud_test.go` (file test mới, cùng package `store`)
- `_bmad-output/SP023/STR102/ghi-chu-role.md` (cách tạo role trên Neon, chạy tay)

## Không làm
- Không viết policy RLS, không `ENABLE`/`FORCE ROW LEVEL SECURITY` (Task151). Task này chỉ dựng bảng, role và `GRANT`.
- Không viết handler Gin, không thêm route (Task150).
- Không thêm cột `is_public`.
- Không đổi `DATABASE_URL`/`store.Open`, không đổi role mà app đang kết nối. Việc tách DSN của app role là của Task150.

## Hợp đồng (schema)
Ba bảng, owner là role chạy migration (không phải `sqllens_app`):

```sql
cloud_projects(
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references users(id) on delete cascade,
  name       text not null,
  engine     text not null check (engine in ('postgres','mysql','sqlite')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)

cloud_tabs(
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references cloud_projects(id) on delete cascade,
  name       text not null default '',
  sql        text not null default '',
  position   int  not null default 0,
  updated_at timestamptz not null default now()
)

cloud_project_members(
  project_id uuid not null references cloud_projects(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       text not null default 'viewer' check (role in ('owner','editor','viewer')),
  primary key (project_id, user_id)
)
```

Index tối thiểu: `cloud_projects(owner_id)`, `cloud_tabs(project_id, position)`, `cloud_project_members(user_id)`.

Role `sqllens_app` (LOGIN):
- **Không** là owner của ba bảng.
- `GRANT SELECT, INSERT, UPDATE, DELETE` trên ba bảng; `USAGE` trên schema `public`.
- `rolsuper = false`, `rolbypassrls = false`.
- **Không** có `CREATE` trên schema `public`; không có quyền nào trên `users`, `sessions`, `identities`.
- Không cấp `TRUNCATE`, `REFERENCES`, `TRIGGER`.

Migration phải chạy lại được (idempotent): `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DO $$ ... IF NOT EXISTS (SELECT FROM pg_roles ...)` cho role, `GRANT` chạy lặp vô hại.

## Ca biên
- Database đã có bảng cùng tên từ bản thử nhưng thiếu cột: migration không được làm mất dữ liệu; nếu không tự nâng cấp được thì báo lỗi rõ ràng, không `DROP`.
- Role `sqllens_app` đã tồn tại: không lỗi, không đổi mật khẩu của role đó.
- Tài khoản chạy migration **không đủ quyền tạo role** (Neon gói free có thể như vậy): migration vẫn phải tạo được 3 bảng và báo rõ phần role bị bỏ qua, không chặn cả migration. Ghi bước làm tay vào `ghi-chu-role.md`.
- Xóa user còn dự án: cascade xóa `cloud_projects` rồi `cloud_tabs`, `cloud_project_members`.
- Xóa project: cascade xóa `cloud_tabs` và `cloud_project_members`.

## Tiêu chí xong
- AC1: Chạy migration trên database sạch tạo đủ 3 bảng, đúng kiểu, đúng khóa ngoại và index.
- AC2: Truy vấn `pg_tables`/`pg_class` cho thấy owner của 3 bảng **khác** `sqllens_app`.
- AC3: `pg_roles` cho thấy `sqllens_app` có `rolsuper = false`, `rolbypassrls = false`.
- AC4: `has_schema_privilege('sqllens_app','public','CREATE')` = false; `has_table_privilege('sqllens_app','users','SELECT')` = false; `has_table_privilege('sqllens_app','sessions','SELECT')` = false.
- AC5: Chạy migration hai lần không lỗi, `schema_migrations` có đúng một dòng `003_cloud_projects.sql`, dữ liệu cũ còn nguyên.
- AC6: Có `_bmad-output/SP023/STR102/ghi-chu-role.md` ghi cách tạo role trên Neon, gồm cả đường làm tay khi tài khoản migration không tạo được role.
- AC7: Test trong `api/internal/store/store_cloud_test.go` kiểm AC1–AC5 bằng truy vấn thật, tự `t.Skip` khi chưa đặt `T149_DATABASE_URL` (giống `T041_DATABASE_URL`), và từ chối chạy nếu URL không phải localhost.

## Giao diện
Không có.

## Kiểm tra
- `cd api && gofmt -l . && go vet ./...`
- `docker run -d --name t149-pg -p 54490:5432 -e POSTGRES_PASSWORD=t149 postgres:18`, chờ `pg_isready`, tạo database `app`.
- `T149_DATABASE_URL=postgres://postgres:t149@localhost:54490/app go test -count=1 ./internal/store -run Cloud -v`
- Chạy tay các truy vấn của AC2–AC4 bằng `psql` trên container đó và dán kết quả thật vào bàn giao.
- Ghi rõ trong bàn giao: phần chưa kiểm được là **Neon thật** (chưa có quyền tạo role trên Neon hay không).

## Góc review thêm
Bảo mật: quyền của role app, owner của bảng, không cấp thừa. Đúng yêu cầu cứng 1–3 của chủ dự án ở `_bmad-output/SP023/README.md`.

## Đọc thêm
- `_bmad-output/SP023/README.md` (yêu cầu cứng của chủ dự án)
- `api/migrations/001_init.sql`, `api/migrations/002_add_user_roles.sql` (quy ước hiện có)
- `api/internal/store/store.go` mục `Migrate` (chạy file trong một transaction)
