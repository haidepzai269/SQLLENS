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

-- 0. Điều kiện tiên quyết: 006 dựa vào hai bảng của 003/004 (policy `room_baton_select` đọc
--    `cloud_project_members`). Thiếu bảng nền thì Postgres báo `relation ... does not exist` ở
--    giữa file, không nói được schema đang thiếu gì — nên kiểm trước và nêu tên.
DO $$
DECLARE
    bad text;
BEGIN
    SELECT string_agg(v.tbl, ', ')
      INTO bad
      FROM (VALUES ('cloud_projects'), ('cloud_project_members')) AS v(tbl)
     WHERE NOT EXISTS (SELECT 1 FROM pg_class c
                        WHERE c.relnamespace = 'public'::regnamespace
                          AND c.relname = v.tbl AND c.relkind IN ('r', 'p'));
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '006_live_rooms: thiếu bảng nền (%). Chạy lại 003/004 trước.', bad;
    END IF;

    SELECT string_agg(v.col, ', ')
      INTO bad
      FROM (VALUES ('project_id'), ('user_id')) AS v(col)
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'cloud_project_members'
                          AND column_name = v.col);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '006_live_rooms: cloud_project_members thiếu cột (%). Chạy lại 003/004 trước.', bad;
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

-- FK có ON DELETE CASCADE không tự sinh index: thiếu index thì mỗi lần xoá một dự án
-- Postgres phải quét toàn bảng token để tìm hàng con.
CREATE INDEX IF NOT EXISTS room_invite_tokens_project_id_idx
    ON public.room_invite_tokens (project_id);

-- 2. Bảng Baton state.
CREATE TABLE IF NOT EXISTS public.room_baton (
    project_id  UUID PRIMARY KEY REFERENCES public.cloud_projects(id) ON DELETE CASCADE,
    holder_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cùng lý do như index của token: FK không tự sinh index, và `ON DELETE SET NULL` phải
-- quét bảng để tìm hàng có holder_id sắp bị xoá.
CREATE INDEX IF NOT EXISTS room_baton_holder_id_idx
    ON public.room_baton (holder_id);

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
    extra text[];
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

    -- 6g. Tập cột phải khớp đúng tên + kiểu. `CREATE TABLE IF NOT EXISTS` bỏ qua bảng đã có,
    --     nên bảng dở dang từ một bản thử trước vẫn sống sót qua CREATE; phải làm migration
    --     thất bại thay vì in NOTICE thành công (003 đã làm vậy, xem TestCloudPreexistingPartialTable).
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
        SELECT array_agg(a) INTO extra FROM unnest(act) a WHERE a <> ALL (exp);
        IF miss IS NOT NULL OR extra IS NOT NULL THEN
            RAISE EXCEPTION '006_live_rooms: % sai tập cột. Thiếu: %. Thừa/lạ: %. Migration KHÔNG xoá dữ liệu; sửa tay bảng đó rồi chạy lại.',
                tbl, COALESCE(miss, '{}'), COALESCE(extra, '{}');
        END IF;
    END LOOP;

    RAISE NOTICE '006_live_rooms: 2 bảng mới đã ENABLE + FORCE RLS, 6 policy theo lệnh, có GRANT cho sqllens_app.';
END
$$;
