-- Migration 004: RLS theo từng lệnh cho 3 bảng cloud + FORCE (SP023 / Task151)
--
-- Vì sao phải FORCE: PostgreSQL cho OWNER của bảng bỏ qua RLS. Ba bảng cloud thuộc sở hữu
-- role chạy migration (xem 003), không phải sqllens_app, nhưng nếu không FORCE thì chính API
-- (cũng chạy bằng role owner) sẽ đi xuyên policy. FORCE đặt owner vào đúng vị trí bị chặn,
-- nên lớp bảo vệ thứ hai này có tác dụng thật chứ không phải hình thức.
--
-- Vì sao policy của cloud_project_members KHÔNG đọc bảng cloud_projects:
-- policy cloud_projects ĐỌC cloud_project_members (để thành viên thấy dự án được chia sẻ).
-- Nếu policy của cloud_project_members lại đọc cloud_projects thì Postgres báo
-- `infinite recursion detected in policy for relation`. Đã tái hiện đúng lỗi này trên
-- PostgreSQL 18.6 trước khi viết file. Vì vậy "chủ dự án" ở policy của members được kiểm
-- bằng `app.owned_projects` — danh sách id dự án do chính user sở hữu, helper `WithTenant`
-- đọc từ database trong CÙNG transaction rồi đặt (set_config, true nên chỉ sống trong
-- transaction đó). Không SECURITY DEFINER, không BYPASSRLS: đã kiểm bằng máy là hàm
-- SECURITY DEFINER do role owner (NOSUPERUSER NOBYPASSRLS) sở hữu VẪN bị FORCE RLS chặn,
-- nên đường đó không dùng được trên Neon.
--
-- Bậc thang ngữ cảnh:
--   app.current_user_id  uuid của người đang đăng nhập (WithTenant đặt)
--   app.owned_projects   'a,b,c' các dự án người đó sở hữu (WithTenant đặt)
--   app.current_user/1.. app_owns_project/1 KHÔNG dùng: policy viết thẳng, không thêm object.
--
-- File này chạy lại được: DROP POLICY IF EXISTS rồi CREATE, và đọc lại catalog để kiểm.

-- 1. Bật và ÉP RLS trên cả 3 bảng.
ALTER TABLE public.cloud_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_tabs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_project_members FORCE ROW LEVEL SECURITY;

-- 2. cloud_projects: chủ sở hữu, và thành viên đọc được dự án mình là thành viên.
--    Biểu thức `NULLIF(current_setting(...), '')::uuid` trả NULL khi chưa có ngữ cảnh,
--    nên so sánh ra NULL (không phải true) và bảng đóng lại thay vì ném lỗi cast.
DROP POLICY IF EXISTS cloud_projects_select ON public.cloud_projects;
CREATE POLICY cloud_projects_select ON public.cloud_projects FOR SELECT USING (
    owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR id IN (SELECT m.project_id
                FROM public.cloud_project_members m
               WHERE m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
);

DROP POLICY IF EXISTS cloud_projects_insert ON public.cloud_projects;
CREATE POLICY cloud_projects_insert ON public.cloud_projects FOR INSERT WITH CHECK (
    owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
);

DROP POLICY IF EXISTS cloud_projects_update ON public.cloud_projects;
CREATE POLICY cloud_projects_update ON public.cloud_projects FOR UPDATE
USING (owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
WITH CHECK (owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY IF EXISTS cloud_projects_delete ON public.cloud_projects;
CREATE POLICY cloud_projects_delete ON public.cloud_projects FOR DELETE USING (
    owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
);

-- 3. cloud_tabs: cùng logic với dự án cha. Câu `EXISTS` đi qua policy SELECT của
--    cloud_projects, nên thành viên đọc được tab của dự án được chia sẻ mà không cần
--    chép lại biểu thức.
DROP POLICY IF EXISTS cloud_tabs_select ON public.cloud_tabs;
CREATE POLICY cloud_tabs_select ON public.cloud_tabs FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.cloud_projects p WHERE p.id = cloud_tabs.project_id)
);

DROP POLICY IF EXISTS cloud_tabs_insert ON public.cloud_tabs;
CREATE POLICY cloud_tabs_insert ON public.cloud_tabs FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.cloud_projects p WHERE p.id = cloud_tabs.project_id)
);

DROP POLICY IF EXISTS cloud_tabs_update ON public.cloud_tabs;
CREATE POLICY cloud_tabs_update ON public.cloud_tabs FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.cloud_projects p WHERE p.id = cloud_tabs.project_id))
WITH CHECK (EXISTS (SELECT 1 FROM public.cloud_projects p WHERE p.id = cloud_tabs.project_id));

DROP POLICY IF EXISTS cloud_tabs_delete ON public.cloud_tabs;
CREATE POLICY cloud_tabs_delete ON public.cloud_tabs FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.cloud_projects p WHERE p.id = cloud_tabs.project_id)
);

-- 4. cloud_project_members: thành viên thấy hàng của mình; chủ dự án thấy và quản lý mọi
--    hàng của dự án mình. "Chủ" kiểm bằng app.owned_projects, KHÔNG đọc cloud_projects
--    (xem đầu file: đọc chéo sẽ thành đệ quy policy).
DROP POLICY IF EXISTS cloud_project_members_select ON public.cloud_project_members;
CREATE POLICY cloud_project_members_select ON public.cloud_project_members FOR SELECT USING (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[]))
);

DROP POLICY IF EXISTS cloud_project_members_insert ON public.cloud_project_members;
CREATE POLICY cloud_project_members_insert ON public.cloud_project_members FOR INSERT WITH CHECK (
    project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[]))
);

DROP POLICY IF EXISTS cloud_project_members_update ON public.cloud_project_members;
CREATE POLICY cloud_project_members_update ON public.cloud_project_members FOR UPDATE
USING (project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[])))
WITH CHECK (project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[])));

DROP POLICY IF EXISTS cloud_project_members_delete ON public.cloud_project_members;
CREATE POLICY cloud_project_members_delete ON public.cloud_project_members FOR DELETE USING (
    project_id = ANY (COALESCE(
        string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
        '{}'::uuid[]))
);

-- 5. Đọc lại catalog, không tin câu lệnh vừa chạy (bài học Task149): store.Migrate chạy qua
--    pgx nên NOTICE/WARNING không hiện ra ở đâu cả, một RLS bật nửa vời sẽ im lặng.
DO $$
DECLARE
    bad text;
BEGIN
    -- 5a. Ba bảng phải tồn tại (003 chạy trước).
    SELECT string_agg(v.tbl, '; ')
      INTO bad
      FROM (VALUES ('cloud_projects'), ('cloud_tabs'), ('cloud_project_members')) AS v(tbl)
     WHERE NOT EXISTS (SELECT 1 FROM pg_class c
                        WHERE c.relnamespace = 'public'::regnamespace AND c.relname = v.tbl);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '004_cloud_rls: thiếu bảng cloud (%); chạy migration 003 trước.', bad;
    END IF;

    -- 5b. AC1: ENABLE + FORCE trên cả 3 bảng.
    SELECT string_agg(v.tbl || ' (rls=' || c.relrowsecurity || ', force=' || c.relforcerowsecurity || ')', '; ')
      INTO bad
      FROM (VALUES ('cloud_projects'), ('cloud_tabs'), ('cloud_project_members')) AS v(tbl)
      JOIN pg_class c ON c.relnamespace = 'public'::regnamespace AND c.relname = v.tbl
     WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '004_cloud_rls: sau khi bật, vẫn chưa đủ ENABLE + FORCE ROW LEVEL SECURITY: %. RLS sẽ bị owner bỏ qua; kiểm bằng tay rồi chạy lại.', bad;
    END IF;

    -- 5c. AC2: không có policy FOR ALL.
    SELECT string_agg(c.relname || '.' || p.polname, '; ')
      INTO bad
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('cloud_projects', 'cloud_tabs', 'cloud_project_members')
       AND p.polcmd = '*';
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '004_cloud_rls: còn policy FOR ALL (%), trái yêu cầu mỗi lệnh một policy. Xóa policy đó rồi chạy lại.', bad;
    END IF;

    -- 5d. AC2 + AC3: mỗi bảng đủ 4 lệnh SELECT/INSERT/UPDATE/DELETE, riêng members phải có
    --     policy (bật RLS mà không có policy là bảng khóa sạch — lỗi của spec gốc).
    SELECT string_agg(v.tbl || ' thiếu policy ' || v.cmd, '; ')
      INTO bad
      FROM (VALUES
            ('cloud_projects', 'r'), ('cloud_projects', 'a'), ('cloud_projects', 'w'), ('cloud_projects', 'd'),
            ('cloud_tabs', 'r'), ('cloud_tabs', 'a'), ('cloud_tabs', 'w'), ('cloud_tabs', 'd'),
            ('cloud_project_members', 'r'), ('cloud_project_members', 'a'), ('cloud_project_members', 'w'), ('cloud_project_members', 'd')
           ) AS v(tbl, cmd)
     WHERE NOT EXISTS (SELECT 1 FROM pg_policy p
                         JOIN pg_class c ON c.oid = p.polrelid
                        WHERE c.relnamespace = 'public'::regnamespace
                          AND c.relname = v.tbl
                          AND p.polcmd = v.cmd);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '004_cloud_rls: thiếu policy theo lệnh: %. Mỗi lệnh phải có policy riêng; chạy lại migration sau khi xóa policy lạ.', bad;
    END IF;

    -- 5e. AC2: lệnh ghi phải có WITH CHECK tường minh.
    SELECT string_agg(c.relname || ':' || p.polcmd::text, '; ')
      INTO bad
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('cloud_projects', 'cloud_tabs', 'cloud_project_members')
       AND p.polcmd IN ('a', 'w')
       AND p.polwithcheck IS NULL;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '004_cloud_rls: policy ghi thiếu WITH CHECK tường minh (%). Thêm WITH CHECK rồi chạy lại.', bad;
    END IF;

    RAISE NOTICE '004_cloud_rls: 3 bảng cloud đã ENABLE + FORCE RLS, 12 policy theo lệnh, members có policy và lệnh ghi có WITH CHECK.';
END
$$;
