# Task149: Migration 3 bảng cloud + role app không phải owner

Thuộc: SP023 / STR102
Mục tiêu: Dựng chỗ lưu dự án trên Neon với role ứng dụng tách khỏi role sở hữu bảng, để RLS về sau mới có tác dụng thật.

Phạm vi:
- `api/migrations/003_cloud_projects.sql`
- `api/migrations/migrations.go` (chỉ thêm file vào danh sách chạy)
- `_bmad-output/SP023/STR102/ghi-chu-role.md` (cách tạo role trên Neon)

Không làm:
- Không viết policy (Task151).
- Không viết handler Gin (Task150).
- Không thêm cột `is_public`.

Hợp đồng:
- Bảng `cloud_projects(id uuid pk, owner_id uuid not null references users(id) on delete cascade, name text not null, engine text not null check (engine in ('postgres','mysql','sqlite')), created_at timestamptz, updated_at timestamptz)`
- Bảng `cloud_tabs(id uuid pk, project_id uuid not null references cloud_projects(id) on delete cascade, name text, sql text, position int, updated_at timestamptz)`
- Bảng `cloud_project_members(project_id uuid, user_id uuid, role text, primary key (project_id, user_id))`
- Role `sqllens_app` (LOGIN) **không** là owner của ba bảng; `GRANT SELECT, INSERT, UPDATE, DELETE` trên ba bảng và `USAGE` trên schema.
- Migration chạy lại được (idempotent): `CREATE TABLE IF NOT EXISTS`, `DO $$ ... IF NOT EXISTS (SELECT FROM pg_roles ...)`.

Tiêu chí xong:
- AC1: Chạy migration trên database sạch tạo đủ 3 bảng, đúng kiểu và khóa ngoại.
- AC2: `\dt+` hoặc truy vấn `pg_tables` cho thấy owner của 3 bảng **khác** `sqllens_app`.
- AC3: `pg_roles` cho thấy `sqllens_app` có `rolsuper = false`, `rolbypassrls = false`.
- AC4: Role app không có quyền `CREATE` trên schema public và không có quyền trên bảng `users`/`sessions`.
- AC5: Chạy migration hai lần không lỗi, không mất dữ liệu.
- AC6: Có ghi chú cách tạo role trên Neon (nếu tài khoản migration không đủ quyền tạo role thì ghi rõ bước làm tay và đưa lên SP999).

Ca biên: database đã có bảng cùng tên từ bản thử; role đã tồn tại; xóa user còn dự án (cascade hoạt động).
Kiểm tra: chạy migration trên Postgres local hoặc Neon nhánh thử, rồi chạy các truy vấn kiểm owner/role; ghi kết quả thật vào bàn giao.
Góc review thêm: bảo mật (quyền của role app), đúng yêu cầu cứng của chủ dự án.
Đọc thêm: `_bmad-output/SP023/README.md`.
