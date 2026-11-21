-- Migration 005: lệnh GHI trên cloud_tabs phải là owner hoặc editor (SP023 / review Task150-151)
--
-- Vì sao cần file mới: 004 đã ghi vào schema_migrations nên sửa 004 sẽ KHÔNG chạy lại trên
-- database đã có dữ liệu. Policy cũ của 004 chỉ kiểm `EXISTS (SELECT 1 FROM cloud_projects ...)`,
-- mà policy SELECT của cloud_projects cho **mọi thành viên** thấy dự án được chia sẻ — nên
-- `viewer` (chỉ được mời xem) sửa/xóa/chèn được tab của chủ dự án và ghi đè SQL của người khác.
-- Cột `cloud_project_members.role` có từ 003 nhưng policy chưa hề dùng.
--
-- Lệnh SELECT giữ nguyên: viewer phải đọc được, đó là mục đích của viewer. Chỉ 3 policy ghi
-- (INSERT/UPDATE/DELETE) bị siết.
--
-- Vì sao biểu thức dưới đây KHÔNG tạo đệ quy policy (đã kiểm bằng máy trên PostgreSQL 18.6):
-- policy ghi đọc cloud_projects, policy SELECT của cloud_projects đọc cloud_project_members,
-- còn policy của cloud_project_members chỉ đọc `app.owned_projects` (không đọc cloud_tabs và
-- không đọc cloud_projects) nên chuỗi dừng ở đó. Đã tái hiện: không có
-- `infinite recursion detected in policy for relation`.
--
-- File này chạy lại được: DROP POLICY IF EXISTS rồi CREATE, và đọc lại catalog để kiểm.

-- 1. INSERT: WITH CHECK phải thấy role của người ghi.
DROP POLICY IF EXISTS cloud_tabs_insert ON public.cloud_tabs;
CREATE POLICY cloud_tabs_insert ON public.cloud_tabs FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.cloud_projects p
             WHERE p.id = cloud_tabs.project_id
               AND p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
    OR EXISTS (SELECT 1 FROM public.cloud_project_members m
                WHERE m.project_id = cloud_tabs.project_id
                  AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                  AND m.role IN ('owner', 'editor'))
);

-- 2. UPDATE: cả USING lẫn WITH CHECK, nếu không thì người bị chặn vẫn đổi được hàng vừa sửa.
DROP POLICY IF EXISTS cloud_tabs_update ON public.cloud_tabs;
CREATE POLICY cloud_tabs_update ON public.cloud_tabs FOR UPDATE
USING (
    EXISTS (SELECT 1 FROM public.cloud_projects p
             WHERE p.id = cloud_tabs.project_id
               AND p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
    OR EXISTS (SELECT 1 FROM public.cloud_project_members m
                WHERE m.project_id = cloud_tabs.project_id
                  AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                  AND m.role IN ('owner', 'editor'))
)
WITH CHECK (
    EXISTS (SELECT 1 FROM public.cloud_projects p
             WHERE p.id = cloud_tabs.project_id
               AND p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
    OR EXISTS (SELECT 1 FROM public.cloud_project_members m
                WHERE m.project_id = cloud_tabs.project_id
                  AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                  AND m.role IN ('owner', 'editor'))
);

-- 3. DELETE.
DROP POLICY IF EXISTS cloud_tabs_delete ON public.cloud_tabs;
CREATE POLICY cloud_tabs_delete ON public.cloud_tabs FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.cloud_projects p
             WHERE p.id = cloud_tabs.project_id
               AND p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
    OR EXISTS (SELECT 1 FROM public.cloud_project_members m
                WHERE m.project_id = cloud_tabs.project_id
                  AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                  AND m.role IN ('owner', 'editor'))
);

-- 4. Đọc lại catalog thay vì tin câu lệnh vừa chạy (bài học Task149): store.Migrate chạy qua
--    pgx nên NOTICE/WARNING không hiện ra ở đâu cả, policy cũ còn sót sẽ im lặng cho viewer ghi.
DO $$
DECLARE
    bad text;
BEGIN
    -- 4a. Đúng 3 policy ghi phải tồn tại trên cloud_tabs.
    SELECT string_agg(v.cmd, ', ')
      INTO bad
      FROM (VALUES ('a'), ('w'), ('d')) AS v(cmd)
     WHERE NOT EXISTS (SELECT 1 FROM pg_policy p
                         JOIN pg_class c ON c.oid = p.polrelid
                        WHERE c.relnamespace = 'public'::regnamespace
                          AND c.relname = 'cloud_tabs'
                          AND p.polcmd = v.cmd);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '005_cloud_tabs_write_role: thiếu policy ghi trên cloud_tabs (lệnh: %); chạy lại migration.', bad;
    END IF;

    -- 4b. Cả 3 policy ghi phải thật sự tham chiếu cột role. Kiểm bằng chính biểu thức đã lưu
    --     trong pg_policy, không kiểm tên policy: đổi tên policy không được làm test này xanh giả.
    SELECT string_agg(c.relname || ':' || p.polname || ' (' || p.polcmd::text || ')', '; ')
      INTO bad
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname = 'cloud_tabs'
       AND p.polcmd IN ('a', 'w', 'd')
       AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
           COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') NOT LIKE '%role%';
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '005_cloud_tabs_write_role: policy ghi của cloud_tabs chưa tham chiếu role, nên viewer vẫn ghi được (%). Xóa policy đó rồi chạy lại migration.', bad;
    END IF;

    -- 4c. Lệnh ghi phải có WITH CHECK tường minh, giống yêu cầu của 004.
    SELECT string_agg(p.polname, '; ')
      INTO bad
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname = 'cloud_tabs'
       AND p.polcmd IN ('a', 'w')
       AND p.polwithcheck IS NULL;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '005_cloud_tabs_write_role: policy ghi thiếu WITH CHECK tường minh (%). Thêm WITH CHECK rồi chạy lại.', bad;
    END IF;

    -- 4d. Policy SELECT phải KHÔNG tham chiếu role: viewer còn phải đọc được tab.
    SELECT string_agg(p.polname, '; ')
      INTO bad
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname = 'cloud_tabs'
       AND p.polcmd = 'r'
       AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%role%';
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '005_cloud_tabs_write_role: policy SELECT của cloud_tabs bị siết theo role (%), làm viewer không đọc được tab. Trả policy SELECT về như 004 rồi chạy lại.', bad;
    END IF;

    RAISE NOTICE '005_cloud_tabs_write_role: 3 policy ghi của cloud_tabs đã yêu cầu owner hoặc editor; SELECT giữ nguyên cho viewer.';
END
$$;
