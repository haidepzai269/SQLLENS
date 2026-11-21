# Tạo role `sqllens_app` trên Neon (Task149)

Mục đích: role ứng dụng `sqllens_app` dùng để chạy mọi câu SQL của người dùng trên 3 bảng cloud.
Role này **không được là owner** của 3 bảng, vì PostgreSQL cho owner bỏ qua RLS; nếu owner là role app
thì `FORCE ROW LEVEL SECURITY` ở Task151 cũng vô nghĩa. Vì vậy phần role nằm trong migration
`api/migrations/003_cloud_projects.sql` nhưng **được phép bỏ qua** khi tài khoản chạy migration
không đủ quyền (Neon gói free thường không cho `CREATEROLE`).

## 1. Đường tự động (mặc định)

Migration `003_cloud_projects.sql` tự làm, không cần thao tác tay:

```sql
-- Nếu role chưa có:
CREATE ROLE sqllens_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
-- Nếu role đã có (chỉ siết thuộc tính, không đổi mật khẩu):
ALTER  ROLE sqllens_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
-- Quyền:
REVOKE ALL ON SCHEMA public FROM sqllens_app;
GRANT USAGE ON SCHEMA public TO sqllens_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.cloud_projects, public.cloud_tabs, public.cloud_project_members
  TO sqllens_app;
```

Migration **không đặt mật khẩu**. Nếu role đã tồn tại thì chỉ siết lại thuộc tính, không đổi mật khẩu.
Role không được cấp `CREATE` trên schema `public`, không được cấp `TRUNCATE`/`REFERENCES`/`TRIGGER`,
và không có quyền nào trên `users`, `sessions`, `identities`, `vip_codes`, `user_vip_redemptions`.

Sau khi tạo/siết role và cấp quyền, migration **đọc lại** `pg_roles` và `has_*_privilege` rồi
`RAISE EXCEPTION` nếu kết quả còn sai (xem mục 2b và 2c). Lý do: `store.Migrate` chạy qua pgx nên
`NOTICE`/`WARNING` không hiện ra ở đâu cả, nên không thể tin vào việc câu lệnh vừa chạy đã thành công.

## 2. Khi migration báo `BỎ QUA phần role` (đường làm tay)

Triệu chứng trong log migration:

```
WARNING:  003_cloud_projects: BỎ QUA phần role — tài khoản <user> không đủ quyền tạo role sqllens_app
          (permission denied to create role). Ba bảng vẫn đã được tạo.
WARNING:  003_cloud_projects: BỎ QUA phần GRANT — chưa có role sqllens_app.
```

Nghĩa là 3 bảng đã có, chỉ thiếu role. Làm tay theo thứ tự sau, **bằng tài khoản có quyền tạo role**
(trên Neon: role owner của project, mở qua SQL Editor hoặc `psql` bằng chuỗi kết nối của owner).
Bước 2 cần superuser; nếu không chạy được thì xem mục 2b.

```sql
-- Bước 1: tạo role. Nếu báo "role already exists" thì bỏ qua bước này.
CREATE ROLE sqllens_app LOGIN PASSWORD '<mật-khẩu-mạnh>' NOSUPERUSER NOBYPASSRLS;

-- Bước 2: siết thuộc tính — CHỈ SUPERUSER LÀM ĐƯỢC.
ALTER ROLE sqllens_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

-- Bước 3: cấp quyền tối thiểu.
REVOKE ALL ON SCHEMA public FROM sqllens_app;
GRANT USAGE ON SCHEMA public TO sqllens_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.cloud_projects, public.cloud_tabs, public.cloud_project_members
  TO sqllens_app;
```

**Bước 2 chỉ chạy được bằng superuser.** Đây là điểm dễ hiểu sai nhất: chủ sở hữu database trên Neon
(`neondb_owner`) **không phải** superuser, nên `ALTER ROLE ... NOSUPERUSER NOBYPASSRLS` sẽ báo
`permission denied to alter role` dù tài khoản đó có `CREATEROLE`. `CREATEROLE` cho phép tạo và xóa role,
không cho phép đổi thuộc tính `SUPERUSER`/`BYPASSRLS` của role khác. Vì vậy **không** có chuyện
"chạy lại vô hại": trên tài khoản không phải superuser câu này luôn thất bại.

### 2b. Role đã tồn tại và đang mang `BYPASSRLS` hoặc `SUPERUSER`

Migration **dừng lại và báo lỗi** (không chỉ cảnh báo), dạng:

```
ERROR:  003_cloud_projects: role sqllens_app vẫn còn rolbypassrls = true sau khi cố siết thuộc tính,
        nên RLS ở Task151 sẽ bị bỏ qua. Tài khoản <user> không đủ quyền đổi thuộc tính role
        (chỉ superuser đổi được NOSUPERUSER/NOBYPASSRLS). Cách sửa: nhờ superuser chạy
        ALTER ROLE sqllens_app NOSUPERUSER NOBYPASSRLS; hoặc DROP ROLE sqllens_app rồi chạy lại migration.
```

Lý do phải báo lỗi chứ không cảnh báo: `store.Migrate` chạy qua pgx nên `NOTICE`/`WARNING` **không hiện ra
ở đâu cả**; một cảnh báo bị bỏ qua sẽ để role app chạy với `BYPASSRLS` và RLS ở Task151 vô hiệu.

Hai cách sửa, chọn một:

```sql
-- Cách A (khuyến nghị khi role đã có mật khẩu và đang dùng): nhờ superuser siết thuộc tính.
-- Trên Neon, role owner không làm được việc này; phải mở ticket hỗ trợ hoặc dùng Cách B.
ALTER ROLE sqllens_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

-- Cách B: xóa role rồi để migration tạo lại (role chưa dùng thì mất gì).
DROP OWNED BY sqllens_app;
DROP ROLE sqllens_app;
-- rồi chạy lại migration; nhớ đặt lại mật khẩu sau khi role được tạo.
```

### 2c. `sqllens_app` vẫn có `CREATE` trên schema `public`

Migration kiểm bằng `has_schema_privilege` và báo lỗi nếu vẫn còn `CREATE`. Nguyên nhân thường gặp:
quyền này đến từ `PUBLIC` (mặc định của PostgreSQL trước bản 15), và `REVOKE ... FROM sqllens_app`
**không** thu hồi được quyền đã cấp cho `PUBLIC`.

```sql
-- Xem quyền đang cấp cho PUBLIC trên schema public:
SELECT nspacl FROM pg_namespace WHERE nspname = 'public';

-- Cách sửa (thay đổi toàn database, ảnh hưởng mọi role — chủ dự án quyết định):
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

Sau đó chạy lại migration. Trên PostgreSQL 15 trở lên `PUBLIC` không còn `CREATE` trên `public` theo mặc
định, nên lỗi này thường chỉ gặp trên database cũ hoặc database đã được cấp tay.

Sau đó **chạy lại migration** (khởi động lại API, `store.Migrate` tự chạy) để phần `GRANT` chạy lại
và in `NOTICE` xác nhận. Migration giữ nguyên quyền đã cấp, không đụng mật khẩu.

Mật khẩu đặt ở bước 1 phải đưa vào biến môi trường của **service chạy SQL người dùng**, không phải
`DATABASE_URL` của API. `DATABASE_URL` giữ nguyên role owner để migration còn tạo được bảng.

## 3. Kiểm tra sau khi làm tay

Chạy bằng tài khoản owner, dán vào SQL Editor của Neon:

```sql
-- AC2: owner của 3 bảng phải KHÁC sqllens_app
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('cloud_projects','cloud_tabs','cloud_project_members');

-- AC3: phải ra f | f
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'sqllens_app';

-- AC4: phải ra f | t | f | f | f
SELECT has_schema_privilege('sqllens_app','public','CREATE')  AS create_public,
       has_schema_privilege('sqllens_app','public','USAGE')   AS usage_public,
       has_table_privilege('sqllens_app','users','SELECT')    AS sel_users,
       has_table_privilege('sqllens_app','sessions','SELECT') AS sel_sessions,
       has_table_privilege('sqllens_app','identities','SELECT') AS sel_identities;
```

Kỳ vọng: owner là role chạy migration; `rolsuper` và `rolbypassrls` đều `false`; `create_public`,
`sel_users`, `sel_sessions`, `sel_identities` đều `false`; `usage_public` là `true`.

## 4. Ghi chú riêng của Neon

- Neon cho mỗi project một role owner (`neondb_owner`). Role này **không phải** superuser nhưng
  thường có quyền `CREATEROLE`. Nếu `CREATE ROLE` báo `permission denied` thì dùng đường làm tay ở mục 2
  với role owner mở bằng đúng chuỗi kết nối của nó.
- **Role owner của Neon không siết được `BYPASSRLS`/`SUPERUSER`** (mục 2b). Nếu role `sqllens_app` đã tồn
  tại với `BYPASSRLS`, phải `DROP ROLE` rồi để migration tạo lại, hoặc nhờ superuser. Đây là đường đã
  kiểm thật trên `t149-pg2` (role `neon_owner` có `CREATEROLE`, không superuser).
- Quyền `CREATE` trên schema `public` cấp cho `PUBLIC` cũng không thu hồi được bằng `REVOKE ... FROM
  sqllens_app` (mục 2c).
- Neon có nhánh (branch) riêng cho từng môi trường: role là đối tượng **cấp cluster**, nhưng `GRANT`
  là cấp database. Tạo role trên nhánh `main` thì nhánh khác **không** thấy role đó; phải chạy migration
  trên từng nhánh.
- Nếu sau này đổi sang role khác, sửa cả migration lẫn file này; đừng cấp quyền tay rồi để migration
  ghi đè.
