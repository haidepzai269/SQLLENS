-- Migration 003: 3 bảng cloud + role ứng dụng không phải owner (SP023 / Task149)
--
-- Vì sao phải tách role: Postgres cho owner của bảng bỏ qua RLS. Nếu role ứng dụng
-- sở hữu bảng thì RLS ở Task151 vô nghĩa. Vì vậy role chạy migration sở hữu 3 bảng,
-- còn `sqllens_app` chỉ được GRANT SELECT/INSERT/UPDATE/DELETE.
--
-- Phần role và GRANT nằm trong khối có EXCEPTION: tài khoản chạy migration không đủ
-- quyền tạo role (ví dụ gói Neon bị giới hạn) thì 3 bảng vẫn được tạo, phần role bị
-- bỏ qua kèm RAISE WARNING, không chặn cả migration.
-- Cách làm tay: _bmad-output/SP023/STR102/ghi-chu-role.md
--
-- KHÔNG tin vào việc câu lệnh vừa chạy đã thành công: sau khi tạo/siết role và cấp
-- quyền, file này ĐỌC LẠI pg_roles và has_*_privilege rồi RAISE EXCEPTION nếu kết quả
-- còn sai. Lý do: store.Migrate chạy qua pgx nên NOTICE/WARNING không hiện ra ở đâu cả,
-- một cảnh báo bị bỏ qua sẽ để role app chạy với BYPASSRLS và RLS ở Task151 vô hiệu.
--
-- Thứ tự các bước: bảng -> thêm cột -> thêm khóa ngoại -> kiểm tra -> index. Index phải
-- SAU bước thêm cột, nếu không bảng cũ thiếu cột sẽ làm CREATE INDEX nổ trước khi cột
-- kịp được thêm.
--
-- File này chạy lại được (idempotent) và KHÔNG BAO GIỜ DROP bảng hay dữ liệu.

-- 0. Cảnh báo nếu chính role app đang chạy migration: khi đó bảng thuộc sở hữu role app
--    và RLS sẽ bị owner bỏ qua, đúng thứ Epic này phải tránh.
DO $$
BEGIN
    IF current_user = 'sqllens_app' THEN
        RAISE WARNING '003_cloud_projects: migration đang chạy BẰNG role sqllens_app, nên 3 bảng sẽ thuộc sở hữu của chính role app và RLS bị owner bỏ qua. Hãy chạy migration bằng role sở hữu database (xem _bmad-output/SP023/STR102/ghi-chu-role.md).';
    END IF;
END
$$;

-- 1. Ba bảng. Owner là role đang chạy migration, KHÔNG phải sqllens_app.
CREATE TABLE IF NOT EXISTS public.cloud_projects (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   uuid NOT NULL,
    name       text NOT NULL,
    engine     text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cloud_projects_owner_id_fkey FOREIGN KEY (owner_id)
        REFERENCES public.users (id) ON DELETE CASCADE,
    CONSTRAINT cloud_projects_engine_check CHECK (engine IN ('postgres', 'mysql', 'sqlite'))
);

CREATE TABLE IF NOT EXISTS public.cloud_tabs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    name       text NOT NULL DEFAULT '',
    sql        text NOT NULL DEFAULT '',
    position   int NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cloud_tabs_project_id_fkey FOREIGN KEY (project_id)
        REFERENCES public.cloud_projects (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.cloud_project_members (
    project_id uuid NOT NULL,
    user_id    uuid NOT NULL,
    role       text NOT NULL DEFAULT 'viewer',
    PRIMARY KEY (project_id, user_id),
    CONSTRAINT cloud_project_members_project_id_fkey FOREIGN KEY (project_id)
        REFERENCES public.cloud_projects (id) ON DELETE CASCADE,
    CONSTRAINT cloud_project_members_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (id) ON DELETE CASCADE,
    CONSTRAINT cloud_project_members_role_check CHECK (role IN ('owner', 'editor', 'viewer'))
);

-- 2. Ca biên: database đã có bảng cùng tên từ bản thử nhưng thiếu cột.
--    Chỉ THÊM cột còn thiếu, không sửa và không xóa dữ liệu cũ. Cột NOT NULL mà bảng đã
--    có dữ liệu và không có giá trị mặc định thì Postgres từ chối thêm; khi đó báo lỗi rõ
--    ràng kèm cách sửa tay, không DROP bảng.
DO $$
DECLARE
    w record;
BEGIN
    FOR w IN SELECT * FROM (VALUES
        ('cloud_projects', 'id',         $q$uuid PRIMARY KEY DEFAULT gen_random_uuid()$q$),
        ('cloud_projects', 'owner_id',   $q$uuid NOT NULL$q$),
        ('cloud_projects', 'name',       $q$text NOT NULL$q$),
        ('cloud_projects', 'engine',     $q$text NOT NULL$q$),
        ('cloud_projects', 'created_at', $q$timestamptz NOT NULL DEFAULT now()$q$),
        ('cloud_projects', 'updated_at', $q$timestamptz NOT NULL DEFAULT now()$q$),
        ('cloud_tabs', 'id',             $q$uuid PRIMARY KEY DEFAULT gen_random_uuid()$q$),
        ('cloud_tabs', 'project_id',     $q$uuid NOT NULL$q$),
        ('cloud_tabs', 'name',           $q$text NOT NULL DEFAULT ''$q$),
        ('cloud_tabs', 'sql',            $q$text NOT NULL DEFAULT ''$q$),
        ('cloud_tabs', 'position',       $q$int NOT NULL DEFAULT 0$q$),
        ('cloud_tabs', 'updated_at',     $q$timestamptz NOT NULL DEFAULT now()$q$),
        ('cloud_project_members', 'project_id', $q$uuid NOT NULL$q$),
        ('cloud_project_members', 'user_id',    $q$uuid NOT NULL$q$),
        ('cloud_project_members', 'role',       $q$text NOT NULL DEFAULT 'viewer'$q$)
    ) AS t(tbl, col, def)
    WHERE NOT EXISTS (SELECT 1
                        FROM information_schema.columns c
                       WHERE c.table_schema = 'public'
                         AND c.table_name = t.tbl
                         AND c.column_name = t.col)
    LOOP
        BEGIN
            EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I %s', w.tbl, w.col, w.def);
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION '003_cloud_projects: bảng public.% đã có sẵn nhưng thiếu cột % và không tự thêm được (%). Migration không xóa dữ liệu; hãy thêm cột bằng tay rồi chạy lại.', w.tbl, w.col, SQLERRM;
        END;
    END LOOP;
END
$$;

-- 3. Ca biên: bảng cũ có cột nhưng thiếu khóa ngoại ON DELETE CASCADE (ví dụ bảng dựng
--    bằng bản thử rồi bị bỏ cột). Ba trường hợp:
--    - đã có khóa ngoại ON DELETE CASCADE đúng cột  -> không làm gì;
--    - có khóa ngoại nhưng KHÔNG cascade             -> báo lỗi rõ, không tự DROP ràng buộc;
--    - chưa có khóa ngoại nào trên cột đó            -> tự thêm; dữ liệu cũ vi phạm thì báo lỗi.
DO $$
DECLARE
    w record;
    existing text;
BEGIN
    FOR w IN SELECT v.tbl, v.cname, v.col, v.ref
               FROM (VALUES
                    ('cloud_projects', 'cloud_projects_owner_id_fkey', 'owner_id', 'users'),
                    ('cloud_tabs', 'cloud_tabs_project_id_fkey', 'project_id', 'cloud_projects'),
                    ('cloud_project_members', 'cloud_project_members_project_id_fkey', 'project_id', 'cloud_projects'),
                    ('cloud_project_members', 'cloud_project_members_user_id_fkey', 'user_id', 'users')
               ) AS v(tbl, cname, col, ref)
    LOOP
        SELECT string_agg(k.conname || ' (ON DELETE ' ||
                          CASE k.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
                                             WHEN 'd' THEN 'SET DEFAULT' WHEN 'r' THEN 'RESTRICT'
                                             ELSE 'NO ACTION' END || ')', ', ')
          INTO existing
          FROM pg_constraint k
          JOIN pg_class tc ON tc.oid = k.conrelid
          JOIN pg_namespace n ON n.oid = tc.relnamespace
          JOIN pg_class rt ON rt.oid = k.confrelid
         WHERE n.nspname = 'public'
           AND tc.relname = w.tbl
           AND k.contype = 'f'
           AND rt.relname = w.ref
           AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                  FROM unnest(k.conkey) AS c(attnum)
                  JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = c.attnum
               ) = ARRAY[w.col]::text[];

        IF existing IS NULL THEN
            BEGIN
                EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I (id) ON DELETE CASCADE',
                               w.tbl, w.cname, w.col, w.ref);
                RAISE NOTICE '003_cloud_projects: đã thêm khóa ngoại % trên public.%.', w.cname, w.tbl;
            EXCEPTION WHEN others THEN
                RAISE EXCEPTION '003_cloud_projects: bảng public.% đã có sẵn nhưng thiếu khóa ngoại % -> % ON DELETE CASCADE và không tự thêm được (%). Migration không xóa dữ liệu; hãy sửa tay rồi chạy lại.', w.tbl, w.col, w.ref, SQLERRM;
            END;
        ELSIF existing NOT LIKE '%ON DELETE CASCADE%' THEN
            RAISE EXCEPTION '003_cloud_projects: bảng public.% đã có khóa ngoại % -> % nhưng KHÔNG phải ON DELETE CASCADE (đang là: %). Migration không tự DROP ràng buộc và không xóa dữ liệu; hãy sửa tay bằng ALTER TABLE public.% DROP CONSTRAINT <tên ràng buộc>, rồi chạy lại migration.', w.tbl, w.col, w.ref, existing, w.tbl;
        END IF;
    END LOOP;
END
$$;

-- 4. Kiểm tra kiểu cột, khóa chính, khóa ngoại ON DELETE CASCADE và ràng buộc CHECK.
--    Thiếu hay sai thì báo lỗi rõ ràng để người vận hành sửa tay, và cả transaction của
--    file này quay lại nên không để lại trạng thái nửa vời.
DO $$
DECLARE
    bad text;
BEGIN
    SELECT string_agg(format('%s.%s (cần %s, đang là %s)', w.tbl, w.col, w.typ,
                             COALESCE((SELECT c.data_type
                                         FROM information_schema.columns c
                                        WHERE c.table_schema = 'public'
                                          AND c.table_name = w.tbl
                                          AND c.column_name = w.col), 'không có')), '; ')
      INTO bad
      FROM (VALUES
            ('cloud_projects', 'id', 'uuid'),
            ('cloud_projects', 'owner_id', 'uuid'),
            ('cloud_projects', 'name', 'text'),
            ('cloud_projects', 'engine', 'text'),
            ('cloud_projects', 'created_at', 'timestamp with time zone'),
            ('cloud_projects', 'updated_at', 'timestamp with time zone'),
            ('cloud_tabs', 'id', 'uuid'),
            ('cloud_tabs', 'project_id', 'uuid'),
            ('cloud_tabs', 'name', 'text'),
            ('cloud_tabs', 'sql', 'text'),
            ('cloud_tabs', 'position', 'integer'),
            ('cloud_tabs', 'updated_at', 'timestamp with time zone'),
            ('cloud_project_members', 'project_id', 'uuid'),
            ('cloud_project_members', 'user_id', 'uuid'),
            ('cloud_project_members', 'role', 'text')
           ) AS w(tbl, col, typ)
     WHERE NOT EXISTS (SELECT 1
                         FROM information_schema.columns c
                        WHERE c.table_schema = 'public'
                          AND c.table_name = w.tbl
                          AND c.column_name = w.col
                          AND c.data_type = w.typ);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '003_cloud_projects: sai kiểu cột: %. Migration không xóa dữ liệu và không tự đổi kiểu cột; hãy sửa tay rồi chạy lại.', bad;
    END IF;

    SELECT string_agg(format('%s(%s) -> %s', w.tbl, w.col, w.ref), '; ')
      INTO bad
      FROM (VALUES
            ('cloud_projects', 'owner_id', 'users'),
            ('cloud_tabs', 'project_id', 'cloud_projects'),
            ('cloud_project_members', 'project_id', 'cloud_projects'),
            ('cloud_project_members', 'user_id', 'users')
           ) AS w(tbl, col, ref)
     WHERE NOT EXISTS (SELECT 1
                         FROM pg_constraint k
                         JOIN pg_class t ON t.oid = k.conrelid
                         JOIN pg_namespace n ON n.oid = t.relnamespace
                         JOIN pg_class rt ON rt.oid = k.confrelid
                        WHERE n.nspname = 'public'
                          AND t.relname = w.tbl
                          AND k.contype = 'f'
                          AND k.confdeltype = 'c'
                          AND rt.relname = w.ref
                          AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                                 FROM unnest(k.conkey) AS c(attnum)
                                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.attnum
                              ) = ARRAY[w.col]::text[]);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '003_cloud_projects: thiếu khóa ngoại ON DELETE CASCADE: %. Migration không xóa dữ liệu và không tự thêm được khóa ngoại (dữ liệu cũ có thể vi phạm); hãy sửa tay rồi chạy lại.', bad;
    END IF;

    SELECT string_agg(format('%s(%s)', w.tbl, w.cols), '; ')
      INTO bad
      FROM (VALUES
            ('cloud_projects', 'id'),
            ('cloud_tabs', 'id'),
            ('cloud_project_members', 'project_id,user_id')
           ) AS w(tbl, cols)
     WHERE NOT EXISTS (SELECT 1
                         FROM pg_constraint k
                         JOIN pg_class t ON t.oid = k.conrelid
                         JOIN pg_namespace n ON n.oid = t.relnamespace
                        WHERE n.nspname = 'public'
                          AND t.relname = w.tbl
                          AND k.contype = 'p'
                          AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                                 FROM unnest(k.conkey) AS c(attnum)
                                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.attnum
                              ) = (SELECT array_agg(x ORDER BY x)
                                     FROM unnest(string_to_array(w.cols, ',')) AS x));
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '003_cloud_projects: thiếu khóa chính đúng cột: %. Hãy sửa tay rồi chạy lại.', bad;
    END IF;

    SELECT string_agg(format('%s.%s', w.tbl, w.col), '; ')
      INTO bad
      FROM (VALUES
            ('cloud_projects', 'engine', 'postgres', 'mysql', 'sqlite'),
            ('cloud_project_members', 'role', 'owner', 'editor', 'viewer')
           ) AS w(tbl, col, v1, v2, v3)
     WHERE NOT EXISTS (SELECT 1
                         FROM pg_constraint k
                         JOIN pg_class t ON t.oid = k.conrelid
                         JOIN pg_namespace n ON n.oid = t.relnamespace
                        WHERE n.nspname = 'public'
                          AND t.relname = w.tbl
                          AND k.contype = 'c'
                          AND (SELECT array_agg(a.attname::text)
                                 FROM unnest(k.conkey) AS c(attnum)
                                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.attnum
                              ) = ARRAY[w.col]::text[]
                          AND pg_get_constraintdef(k.oid) LIKE '%' || w.v1 || '%'
                          AND pg_get_constraintdef(k.oid) LIKE '%' || w.v2 || '%'
                          AND pg_get_constraintdef(k.oid) LIKE '%' || w.v3 || '%');
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '003_cloud_projects: thiếu hoặc sai ràng buộc CHECK: %. Hãy sửa tay rồi chạy lại.', bad;
    END IF;
END
$$;

-- 5. Index tối thiểu cho truy vấn của Task150/151. PHẢI nằm sau bước thêm cột, nếu không
--    bảng cũ thiếu cột sẽ làm CREATE INDEX nổ trước khi cột kịp được thêm.
CREATE INDEX IF NOT EXISTS cloud_projects_owner_id_idx ON public.cloud_projects (owner_id);
CREATE INDEX IF NOT EXISTS cloud_tabs_project_id_position_idx ON public.cloud_tabs (project_id, position);
CREATE INDEX IF NOT EXISTS cloud_project_members_user_id_idx ON public.cloud_project_members (user_id);

-- 6. Role sqllens_app: tạo nếu chưa có, siết thuộc tính nếu đã có (KHÔNG đổi mật khẩu),
--    rồi ĐỌC LẠI pg_roles. Không tin ALTER ROLE đã thành công: tài khoản không phải
--    superuser bị Postgres từ chối đổi NOSUPERUSER/NOBYPASSRLS, và store.Migrate không
--    hiển thị WARNING nên nếu chỉ cảnh báo thì role BYPASSRLS vẫn sống sót âm thầm.
DO $$
DECLARE
    r record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sqllens_app') THEN
        BEGIN
            CREATE ROLE sqllens_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
            RAISE NOTICE '003_cloud_projects: đã tạo role sqllens_app (chưa đặt mật khẩu; xem _bmad-output/SP023/STR102/ghi-chu-role.md).';
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE WARNING '003_cloud_projects: BỎ QUA phần role — tài khoản % không đủ quyền tạo role sqllens_app (%). Ba bảng vẫn đã được tạo. Làm tay theo _bmad-output/SP023/STR102/ghi-chu-role.md rồi chạy lại GRANT.', current_user, SQLERRM;
            RETURN;
        END;
    ELSE
        BEGIN
            -- Role đã tồn tại: chỉ siết thuộc tính, không đổi mật khẩu, không đổi LOGIN.
            ALTER ROLE sqllens_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
        EXCEPTION WHEN insufficient_privilege THEN
            NULL; -- kiểm ở dưới; sai thuộc tính thì RAISE EXCEPTION, không đi tiếp
        END;
    END IF;

    SELECT rolsuper, rolbypassrls INTO r FROM pg_roles WHERE rolname = 'sqllens_app';
    IF r.rolsuper OR r.rolbypassrls THEN
        RAISE EXCEPTION '003_cloud_projects: role sqllens_app vẫn còn % sau khi cố siết thuộc tính, nên RLS ở Task151 sẽ bị bỏ qua. Tài khoản % không đủ quyền đổi thuộc tính role (chỉ superuser đổi được NOSUPERUSER/NOBYPASSRLS). Cách sửa: nhờ superuser chạy ALTER ROLE sqllens_app NOSUPERUSER NOBYPASSRLS; hoặc DROP ROLE sqllens_app rồi chạy lại migration. Chi tiết: _bmad-output/SP023/STR102/ghi-chu-role.md',
            CASE WHEN r.rolsuper AND r.rolbypassrls THEN 'rolsuper = true và rolbypassrls = true'
                 WHEN r.rolsuper THEN 'rolsuper = true'
                 ELSE 'rolbypassrls = true' END,
            current_user;
    END IF;
END
$$;

-- 7. Quyền: thu hồi mọi quyền ngoài 3 bảng cloud (gồm users, sessions, identities, schema),
--    rồi cấp đúng quyền tối thiểu. Cuối cùng ĐỌC LẠI quyền thật bằng has_*_privilege:
--    REVOKE trên schema public không thu hồi được quyền mà PUBLIC đang có, nên phải kiểm
--    bằng truy vấn chứ không tin câu lệnh vừa chạy.
DO $$
DECLARE
    r record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sqllens_app') THEN
        RAISE WARNING '003_cloud_projects: BỎ QUA phần GRANT — chưa có role sqllens_app. Ba bảng vẫn đã được tạo; cấp quyền tay theo _bmad-output/SP023/STR102/ghi-chu-role.md.';
        RETURN;
    END IF;

    FOR r IN SELECT c.relname
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relkind IN ('r', 'p')
                AND c.relname NOT IN ('cloud_projects', 'cloud_tabs', 'cloud_project_members')
    LOOP
        BEGIN
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM sqllens_app', r.relname);
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE WARNING '003_cloud_projects: không thu hồi được quyền của sqllens_app trên public.% (%). Kiểm tra bằng tay.', r.relname, SQLERRM;
        END;
    END LOOP;

    BEGIN
        EXECUTE 'REVOKE ALL ON SCHEMA public FROM sqllens_app';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE WARNING '003_cloud_projects: không thu hồi được quyền trên schema public (%). Kiểm tra has_schema_privilege bằng tay.', SQLERRM;
    END;

    BEGIN
        EXECUTE 'GRANT USAGE ON SCHEMA public TO sqllens_app';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cloud_projects, public.cloud_tabs, public.cloud_project_members TO sqllens_app';
        RAISE NOTICE '003_cloud_projects: đã cấp USAGE trên schema public và SELECT/INSERT/UPDATE/DELETE trên 3 bảng cloud cho sqllens_app.';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE WARNING '003_cloud_projects: không cấp được quyền cho sqllens_app (%).', SQLERRM;
    END;

    -- 7a. Quyền tạo bảng trên schema public: phải là false.
    IF has_schema_privilege('sqllens_app', 'public', 'CREATE') THEN
        RAISE EXCEPTION '003_cloud_projects: sqllens_app vẫn có CREATE trên schema public sau khi REVOKE. Nguyên nhân thường gặp: quyền này đến từ PUBLIC (mặc định của PostgreSQL trước bản 15), và REVOKE ... FROM sqllens_app không thu hồi được quyền cấp cho PUBLIC. Cách sửa: chạy REVOKE CREATE ON SCHEMA public FROM PUBLIC; rồi chạy lại migration. Lưu ý đây là thay đổi toàn database, ảnh hưởng mọi role, cần chủ dự án quyết định. Chi tiết: _bmad-output/SP023/STR102/ghi-chu-role.md';
    END IF;

    -- 7b. Không được có quyền nào trên bảng của phần đăng nhập.
    IF has_table_privilege('sqllens_app', 'public.users', 'SELECT')
       OR has_table_privilege('sqllens_app', 'public.users', 'INSERT')
       OR has_table_privilege('sqllens_app', 'public.users', 'UPDATE')
       OR has_table_privilege('sqllens_app', 'public.users', 'DELETE')
       OR has_table_privilege('sqllens_app', 'public.sessions', 'SELECT')
       OR has_table_privilege('sqllens_app', 'public.sessions', 'INSERT')
       OR has_table_privilege('sqllens_app', 'public.sessions', 'UPDATE')
       OR has_table_privilege('sqllens_app', 'public.sessions', 'DELETE')
       OR has_table_privilege('sqllens_app', 'public.identities', 'SELECT')
       OR has_table_privilege('sqllens_app', 'public.identities', 'INSERT')
       OR has_table_privilege('sqllens_app', 'public.identities', 'UPDATE')
       OR has_table_privilege('sqllens_app', 'public.identities', 'DELETE') THEN
        RAISE EXCEPTION '003_cloud_projects: sqllens_app vẫn còn quyền trên users/sessions/identities sau khi REVOKE, có thể do quyền cấp cho PUBLIC hoặc do tài khoản chạy migration không sở hữu các bảng đó. Thu hồi bằng tay rồi chạy lại migration; xem _bmad-output/SP023/STR102/ghi-chu-role.md';
    END IF;

    -- 7c. Phải có đúng 4 quyền trên 3 bảng cloud.
    IF NOT (has_table_privilege('sqllens_app', 'public.cloud_projects', 'SELECT')
            AND has_table_privilege('sqllens_app', 'public.cloud_projects', 'INSERT')
            AND has_table_privilege('sqllens_app', 'public.cloud_projects', 'UPDATE')
            AND has_table_privilege('sqllens_app', 'public.cloud_projects', 'DELETE')
            AND has_table_privilege('sqllens_app', 'public.cloud_tabs', 'SELECT')
            AND has_table_privilege('sqllens_app', 'public.cloud_tabs', 'INSERT')
            AND has_table_privilege('sqllens_app', 'public.cloud_tabs', 'UPDATE')
            AND has_table_privilege('sqllens_app', 'public.cloud_tabs', 'DELETE')
            AND has_table_privilege('sqllens_app', 'public.cloud_project_members', 'SELECT')
            AND has_table_privilege('sqllens_app', 'public.cloud_project_members', 'INSERT')
            AND has_table_privilege('sqllens_app', 'public.cloud_project_members', 'UPDATE')
            AND has_table_privilege('sqllens_app', 'public.cloud_project_members', 'DELETE')) THEN
        RAISE EXCEPTION '003_cloud_projects: sqllens_app chưa có đủ SELECT/INSERT/UPDATE/DELETE trên cả 3 bảng cloud. Tài khoản % có thể không sở hữu 3 bảng nên không cấp quyền được; cấp tay rồi chạy lại migration. Xem _bmad-output/SP023/STR102/ghi-chu-role.md', current_user;
    END IF;
END
$$;
