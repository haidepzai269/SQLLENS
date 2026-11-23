-- Migration 006: mở rộng schema cho phòng cộng tác (SP024 / STR116).
--
-- Quyết định C1: **phòng IS a cloud project**. Host = cloud_projects.owner_id.
-- Vì vậy migration này KHÔNG tạo bảng live_rooms, chỉ thêm hai bảng phụ:
--   room_invite_tokens  — link mời có hạn, do owner phát hành.
--   room_baton          — người đang giữ quyền bấm Run (in-memory ở Gin là chính;
--                         bảng này chỉ để giữ trạng thái khi Gin restart).
--
-- Chạy bằng role SỞ HỮU database, không phải sqllens_app (xem 003_cloud_projects.sql:27-28).
-- Migration 004 đã dựng GUC `app.current_user_id` / `app.owned_projects` và hai GUC đó là
-- đường DUY NHẤT policy được đọc. Tuyệt đối không đọc lại cloud_projects trong policy:
-- Postgres báo `infinite recursion detected in policy` (đã gặp ở SP023 / Task151).
--
-- Core Rule 7: hai bảng này không có cột nào chứa SQL hay kết quả truy vấn của người dùng.

-- 0. Điều kiện tiên quyết: 006 dựa vào ba bảng của 001/003/004 (policy `room_baton_select`
--    đọc `cloud_project_members`; FK `holder_id` trỏ `users`). Thiếu bảng nền thì Postgres báo
--    `relation ... does not exist` ở giữa file, không nói được schema đang thiếu gì — nên kiểm
--    trước và nêu tên.
DO $$
DECLARE
    bad text;
BEGIN
    SELECT string_agg(v.tbl, ', ')
      INTO bad
      FROM (VALUES ('cloud_projects'), ('cloud_project_members'), ('users')) AS v(tbl)
     WHERE NOT EXISTS (SELECT 1 FROM pg_class c
                        WHERE c.relnamespace = 'public'::regnamespace
                          AND c.relname = v.tbl AND c.relkind IN ('r', 'p'));
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '006_live_rooms: thiếu bảng nền (%). Chạy lại 001/003/004 trước.', bad;
    END IF;

    SELECT string_agg(v.tbl || '.' || v.col, ', ')
      INTO bad
      FROM (VALUES ('cloud_project_members', 'project_id'),
                   ('cloud_project_members', 'user_id'),
                   ('cloud_projects', 'id'),
                   ('users', 'id')) AS v(tbl, col)
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = v.tbl
                          AND column_name = v.col);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '006_live_rooms: bảng nền thiếu cột (%). Chạy lại 001/003/004 trước.', bad;
    END IF;
END
$$;

-- 1. Bảng invite token.
--    Chỉ lưu sha256 của token trong URL, không bao giờ lưu token gốc — cùng khuôn
--    `sessions.token_hash` (001_init.sql:18-20).
CREATE TABLE IF NOT EXISTS public.room_invite_tokens (
    token_hash  BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    project_id  UUID NOT NULL REFERENCES public.cloud_projects(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    expires_at  TIMESTAMPTZ NOT NULL
);

-- Index của hai bảng nằm ở mục 7 (sau khối tự kiểm 6), không phải ở đây: bảng dở dang thiếu
-- cột thì `CREATE INDEX` nổ bằng lỗi thô `column ... does not exist` trước khi 6g kịp nêu tên
-- cột thiếu. 003 đã dời index xuống sau bước kiểm vì đúng lý do này (003:276-277).

-- 2. Bảng Baton state.
CREATE TABLE IF NOT EXISTS public.room_baton (
    project_id  UUID PRIMARY KEY REFERENCES public.cloud_projects(id) ON DELETE CASCADE,
    holder_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cùng lý do, index của baton cũng ở mục 7.

-- 3. RLS: ENABLE + FORCE trên cả hai bảng.
--    FORCE là lớp bảo vệ cho chính role chủ: API đang dùng một pool role chủ (đọc users,
--    sessions khi đăng nhập), nên thiếu FORCE là owner bỏ qua policy.
ALTER TABLE public.room_invite_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_invite_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.room_baton ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_baton FORCE ROW LEVEL SECURITY;

-- 4. Policy, mỗi lệnh một policy (không FOR ALL), lệnh ghi có WITH CHECK tường minh.
--    DROP IF EXISTS để chạy lại file bằng tay không bị "policy already exists".

-- 4a. Token: CHỈ owner đọc, tạo, xoá. Thành viên được mời không được thấy danh sách token
--     của chủ dự án (token là vé vào phòng, không phải danh bạ).
DROP POLICY IF EXISTS room_invite_tokens_select ON public.room_invite_tokens;
CREATE POLICY room_invite_tokens_select ON public.room_invite_tokens FOR SELECT USING (
    project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[]))
);
DROP POLICY IF EXISTS room_invite_tokens_insert ON public.room_invite_tokens;
CREATE POLICY room_invite_tokens_insert ON public.room_invite_tokens FOR INSERT WITH CHECK (
    project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[]))
);
DROP POLICY IF EXISTS room_invite_tokens_delete ON public.room_invite_tokens;
CREATE POLICY room_invite_tokens_delete ON public.room_invite_tokens FOR DELETE USING (
    project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[]))
);

-- 4b. Baton: owner đọc/ghi; thành viên dự án CHỈ đọc (họ cần biết ai đang giữ quyền Run).
--     Policy đọc `cloud_project_members` — bảng đó đã có policy riêng và policy của nó chỉ
--     đọc GUC (004_cloud_rls.sql:84-113), nên không tạo vòng đệ quy.
DROP POLICY IF EXISTS room_baton_select ON public.room_baton;
CREATE POLICY room_baton_select ON public.room_baton FOR SELECT USING (
    project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[]))
    OR project_id IN (
        SELECT m.project_id FROM public.cloud_project_members m
         WHERE m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
);
DROP POLICY IF EXISTS room_baton_insert ON public.room_baton;
CREATE POLICY room_baton_insert ON public.room_baton FOR INSERT WITH CHECK (
    project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[]))
);
DROP POLICY IF EXISTS room_baton_update ON public.room_baton;
CREATE POLICY room_baton_update ON public.room_baton FOR UPDATE
    USING (project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[])))
    WITH CHECK (project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[])));

-- 5. GRANT cho role app. 003_cloud_projects.sql:353 chỉ cấp cho ba bảng cloud CŨ, nên bỏ
--    bước này thì sqllens_app nhận `permission denied` chứ KHÔNG phải RLS chặn — và test
--    "cross-tenant bị chặn" sẽ xanh vì sai lý do (bài học Task150 / COPY FROM).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sqllens_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE
            ON TABLE public.room_invite_tokens, public.room_baton TO sqllens_app;
    ELSE
        RAISE WARNING '006_live_rooms: chưa có role sqllens_app nên chưa GRANT. Hai bảng đã được tạo; cấp quyền tay theo _bmad-output/SP023/STR102/ghi-chu-role.md.';
    END IF;
END
$$;

-- 6. Tự kiểm catalog: thiếu gì thì RAISE, không im lặng đi tiếp.
DO $$
DECLARE
    n int;
    bad text;
    tbl text;
    exp text[];
    act text[];
    miss text[];
BEGIN
    -- 6a. Hai bảng phải tồn tại.
    SELECT string_agg(v.tbl, ', ')
      INTO bad
      FROM (VALUES ('room_invite_tokens'), ('room_baton')) AS v(tbl)
     WHERE NOT EXISTS (SELECT 1 FROM pg_class c
                        WHERE c.relnamespace = 'public'::regnamespace AND c.relname = v.tbl);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '006_live_rooms: thiếu bảng (%).', bad;
    END IF;

    -- 6b. AC2: ENABLE + FORCE, đủ cả hai.
    SELECT string_agg(v.tbl || ' (rls=' || c.relrowsecurity || ', force=' || c.relforcerowsecurity || ')', '; ')
      INTO bad
      FROM (VALUES ('room_invite_tokens'), ('room_baton')) AS v(tbl)
      JOIN pg_class c ON c.relnamespace = 'public'::regnamespace AND c.relname = v.tbl
     WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '006_live_rooms: chưa đủ ENABLE + FORCE ROW LEVEL SECURITY (%). RLS sẽ bị owner bỏ qua.', bad;
    END IF;

    -- 6c. Không có policy FOR ALL.
    SELECT string_agg(c.relname || '.' || p.polname, '; ')
      INTO bad
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('room_invite_tokens', 'room_baton')
       AND p.polcmd = '*';
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '006_live_rooms: còn policy FOR ALL (%), trái yêu cầu mỗi lệnh một policy.', bad;
    END IF;

    -- 6d. Đủ 6 policy: token 3 (SELECT/INSERT/DELETE), baton 3 (SELECT/INSERT/UPDATE).
    SELECT count(*) INTO n
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('room_invite_tokens', 'room_baton');
    IF n < 6 THEN
        RAISE EXCEPTION '006_live_rooms: mới có % policy trên hai bảng mới, cần đủ 6. Kiểm lại phần 4.', n;
    END IF;

    -- 6e. Lệnh ghi phải có WITH CHECK tường minh.
    SELECT string_agg(policyname, ', ')
      INTO bad
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('room_invite_tokens', 'room_baton')
       AND cmd IN ('INSERT', 'UPDATE') AND with_check IS NULL;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '006_live_rooms: policy ghi thiếu WITH CHECK tường minh: %.', bad;
    END IF;

    -- 6f. Cấp quyền phải thật sự có, nếu không thì test RLS xanh giả.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sqllens_app') THEN
        IF NOT (has_table_privilege('sqllens_app', 'public.room_invite_tokens', 'SELECT')
            AND has_table_privilege('sqllens_app', 'public.room_invite_tokens', 'INSERT')
            AND has_table_privilege('sqllens_app', 'public.room_invite_tokens', 'DELETE')
            AND has_table_privilege('sqllens_app', 'public.room_baton', 'SELECT')
            AND has_table_privilege('sqllens_app', 'public.room_baton', 'INSERT')
            AND has_table_privilege('sqllens_app', 'public.room_baton', 'UPDATE')) THEN
            RAISE EXCEPTION '006_live_rooms: sqllens_app thiếu quyền trên bảng mới, test cross-tenant sẽ xanh giả. Kiểm phần 5.';
        END IF;
    END IF;

    -- 6g. Cột phải có đủ tên + kiểu. `CREATE TABLE IF NOT EXISTS` bỏ qua bảng đã có, nên bảng
    --     dở dang từ một bản thử trước vẫn sống sót qua CREATE; phải làm migration thất bại thay
    --     vì in NOTICE thành công (003 đã làm vậy, xem TestCloudPreexistingPartialTable).
    --     CHỈ kiểm cột THIẾU, không kiểm cột THỪA: migration sau (007 của Task161 thêm
    --     `room_baton.arena_step`) được phép thêm cột, và nếu 006 đòi khớp đúng tập cột thì
    --     006 vĩnh viễn không chạy lại được sau 007. Cột thừa không chứng minh bảng dở dang;
    --     cột thiếu thì có.
    FOR tbl IN SELECT unnest(ARRAY['room_invite_tokens', 'room_baton']) LOOP
        exp := CASE tbl
            WHEN 'room_invite_tokens' THEN
                ARRAY['expires_at:timestamp with time zone', 'project_id:uuid',
                      'role:text', 'token_hash:bytea']
            ELSE
                ARRAY['holder_id:uuid', 'project_id:uuid', 'updated_at:timestamp with time zone']
        END;
        SELECT COALESCE(array_agg(column_name || ':' || data_type ORDER BY column_name), '{}')
          INTO act
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = tbl;
        SELECT array_agg(e) INTO miss FROM unnest(exp) e WHERE e <> ALL (act);
        IF miss IS NOT NULL THEN
            RAISE EXCEPTION '006_live_rooms: % thiếu cột (%). Migration KHÔNG xoá dữ liệu; sửa tay bảng đó rồi chạy lại.', tbl, miss;
        END IF;
    END LOOP;

    -- 6h. Ràng buộc phải có thật, không chỉ đúng tên cột: bảng đúng tên + đúng kiểu nhưng mất
    --     PK/FK/CHECK/NOT NULL vẫn qua được 6g và test sẽ xanh giả. 003 đã kiểm đúng bộ này
    --     (003:200-272), nên 006 theo cùng khuôn.
    SELECT string_agg(w.what, '; ')
      INTO bad
      FROM (VALUES
        ('khóa chính room_invite_tokens(token_hash)',
         EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = 'public.room_invite_tokens'::regclass AND k.contype = 'p'
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                           FROM unnest(k.conkey) AS c(attnum)
                           JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = c.attnum)
                        = ARRAY['token_hash']::text[])),
        ('khóa chính room_baton(project_id)',
         EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = 'public.room_baton'::regclass AND k.contype = 'p'
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                           FROM unnest(k.conkey) AS c(attnum)
                           JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = c.attnum)
                        = ARRAY['project_id']::text[])),
        ('khóa ngoại room_invite_tokens.project_id -> cloud_projects(id) ON DELETE CASCADE',
         EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_class rt ON rt.oid = k.confrelid
                  WHERE k.conrelid = 'public.room_invite_tokens'::regclass AND k.contype = 'f'
                    AND k.confdeltype = 'c' AND rt.relname = 'cloud_projects'
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                           FROM unnest(k.conkey) AS c(attnum)
                           JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = c.attnum)
                        = ARRAY['project_id']::text[])),
        ('khóa ngoại room_baton.project_id -> cloud_projects(id) ON DELETE CASCADE',
         EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_class rt ON rt.oid = k.confrelid
                  WHERE k.conrelid = 'public.room_baton'::regclass AND k.contype = 'f'
                    AND k.confdeltype = 'c' AND rt.relname = 'cloud_projects'
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                           FROM unnest(k.conkey) AS c(attnum)
                           JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = c.attnum)
                        = ARRAY['project_id']::text[])),
        ('khóa ngoại room_baton.holder_id -> users(id) ON DELETE SET NULL',
         EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_class rt ON rt.oid = k.confrelid
                  WHERE k.conrelid = 'public.room_baton'::regclass AND k.contype = 'f'
                    AND k.confdeltype = 'n' AND rt.relname = 'users'
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                           FROM unnest(k.conkey) AS c(attnum)
                           JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = c.attnum)
                        = ARRAY['holder_id']::text[])),
        ('CHECK room_invite_tokens.role IN (editor, viewer)',
         EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = 'public.room_invite_tokens'::regclass AND k.contype = 'c'
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                           FROM unnest(k.conkey) AS c(attnum)
                           JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = c.attnum)
                        = ARRAY['role']::text[]
                    AND pg_get_constraintdef(k.oid) LIKE '%editor%'
                    AND pg_get_constraintdef(k.oid) LIKE '%viewer%')),
        ('CHECK room_invite_tokens.token_hash dài đúng 32 byte',
         EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = 'public.room_invite_tokens'::regclass AND k.contype = 'c'
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                           FROM unnest(k.conkey) AS c(attnum)
                           JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = c.attnum)
                        = ARRAY['token_hash']::text[]
                    AND pg_get_constraintdef(k.oid) LIKE '%octet_length%'
                    AND pg_get_constraintdef(k.oid) LIKE '%32%')),
        ('NOT NULL room_invite_tokens.project_id',
         EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.room_invite_tokens'::regclass
                    AND attname = 'project_id' AND attnotnull)),
        ('NOT NULL room_invite_tokens.role',
         EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.room_invite_tokens'::regclass
                    AND attname = 'role' AND attnotnull)),
        ('NOT NULL room_invite_tokens.expires_at',
         EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.room_invite_tokens'::regclass
                    AND attname = 'expires_at' AND attnotnull)),
        ('NOT NULL room_baton.updated_at',
         EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.room_baton'::regclass
                    AND attname = 'updated_at' AND attnotnull))
       ) AS w(what, ok)
     WHERE NOT w.ok;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '006_live_rooms: thiếu hoặc sai ràng buộc: %. Migration KHÔNG xoá dữ liệu và không tự thêm ràng buộc (dữ liệu cũ có thể vi phạm); sửa tay rồi chạy lại.', bad;
    END IF;

    RAISE NOTICE '006_live_rooms: 2 bảng mới đã ENABLE + FORCE RLS, 6 policy theo lệnh, có GRANT cho sqllens_app.';
END
$$;

-- 7. Index tối thiểu. PHẢI nằm sau khối tự kiểm ở trên, nếu không bảng dở dang thiếu cột sẽ
--    làm CREATE INDEX nổ bằng lỗi thô `column ... does not exist` trước khi 6g kịp nêu tên.
--    FK không tự sinh index: thiếu index thì mỗi lần xoá một dự án Postgres phải quét toàn bảng
--    con, và `ON DELETE SET NULL` phải quét bảng baton để tìm holder_id sắp bị xoá.
CREATE INDEX IF NOT EXISTS room_invite_tokens_project_id_idx
    ON public.room_invite_tokens (project_id);
CREATE INDEX IF NOT EXISTS room_baton_holder_id_idx
    ON public.room_baton (holder_id);
