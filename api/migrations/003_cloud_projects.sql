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

-- 2. Index tối thiểu cho truy vấn của Task150/151.
CREATE INDEX IF NOT EXISTS cloud_projects_owner_id_idx ON public.cloud_projects (owner_id);
CREATE INDEX IF NOT EXISTS cloud_tabs_project_id_position_idx ON public.cloud_tabs (project_id, position);
CREATE INDEX IF NOT EXISTS cloud_project_members_user_id_idx ON public.cloud_project_members (user_id);

-- 3. Ca biên: database đã có bảng cùng tên từ bản thử nhưng thiếu cột.
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

-- 5. Role sqllens_app: tạo nếu chưa có, siết thuộc tính nếu đã có (KHÔNG đổi mật khẩu).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sqllens_app') THEN
        BEGIN
            CREATE ROLE sqllens_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
            RAISE NOTICE '003_cloud_projects: đã tạo role sqllens_app (chưa đặt mật khẩu; xem _bmad-output/SP023/STR102/ghi-chu-role.md).';
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE WARNING '003_cloud_projects: BỎ QUA phần role — tài khoản % không đủ quyền tạo role sqllens_app (%). Ba bảng vẫn đã được tạo. Làm tay theo _bmad-output/SP023/STR102/ghi-chu-role.md rồi chạy lại GRANT.', current_user, SQLERRM;
            RETURN;
        END;
    END IF;
    BEGIN
        -- Role đã tồn tại: chỉ siết thuộc tính, không đổi mật khẩu, không đổi LOGIN.
        ALTER ROLE sqllens_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE WARNING '003_cloud_projects: không siết được thuộc tính role sqllens_app (%). Kiểm tra rolsuper/rolbypassrls bằng tay.', SQLERRM;
    END;
END
$$;

-- 6. Quyền: thu hồi mọi quyền ngoài 3 bảng cloud (gồm users, sessions, identities, schema),
--    rồi cấp đúng quyền tối thiểu.
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
        RAISE WARNING '003_cloud_projects: BỎ QUA phần GRANT — tài khoản % không đủ quyền cấp cho sqllens_app (%). Ba bảng vẫn đã được tạo; cấp quyền tay theo _bmad-output/SP023/STR102/ghi-chu-role.md.', current_user, SQLERRM;
    END;
END
$$;
