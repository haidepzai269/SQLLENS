-- 007_room_api.sql — phần schema còn thiếu cho API phòng (SP024 / STR116 / Task161).
--
-- 006 dựng hai bảng và policy owner-only. Còn thiếu đúng hai thứ để `POST /join` chạy được:
--   (1) một đường ĐỌC hàng vé mời cho người CHƯA là thành viên, khoá theo GUC `app.invite_hash`;
--   (2) chỗ chứa `{step: N}` của Arena.
--
-- File này KHÔNG tạo bảng mới: mọi tên bảng phải có trong `migrations.DropAllTablesSQL`, mà danh
-- sách đó đã chốt ở 006 (TestDropAllTablesCoversEveryMigrationTable canh đúng chuyện này).
-- File này cũng KHÔNG thêm policy ghi nào. Mọi lệnh ghi (tạo vé, thêm thành viên, claim baton,
-- đặt step) vẫn đi qua ngữ cảnh chủ dự án như 006 và 004 đã định; thêm policy ghi khoá theo vé
-- mời là mở đường ghi mà không có ngữ cảnh chủ, đúng thứ mà `FORCE ROW LEVEL SECURITY` sinh ra
-- để chặn.

-- 1. Arena step. Một hàng `room_baton` mỗi dự án giữ cả người giữ gậy và bước hiện tại, nên
--    không cần bảng thứ ba và không có hàng thứ hai để lệch nhau.
--    `ADD COLUMN IF NOT EXISTS` để chạy lại file bằng tay không lỗi.
ALTER TABLE public.room_baton ADD COLUMN IF NOT EXISTS arena_step INTEGER NOT NULL DEFAULT 0;

-- 2. Hai policy CHỈ ĐỌC, khoá theo `app.invite_hash` = **hex của sha256(vé)**.
--
--    Vì sao khoá theo GUC: người có vé chưa là thành viên, nên policy owner-only của 006 không
--    cho họ thấy hàng vé của chính mình — không có vé thì `POST /join` không có đường chạy.
--
--    Vì sao so bằng `decode(..., 'hex')` chứ không so thẳng với GUC: cột là `token_hash BYTEA`
--    (Task171 đã đổi tên và đổi kiểu trong 006), nên phép so phải cùng kiểu. GUC chỉ chở chuỗi
--    hex, không chở vé thô; vé thô không bao giờ vào database.
--
--    Vì sao mặc định là ĐÓNG: `current_setting('app.invite_hash', true)` trả NULL khi GUC chưa
--    được đặt, `decode(NULL, 'hex')` là NULL, và `token_hash = NULL` không đúng với hàng nào.
--    GUC được đặt bằng `set_config(..., true)` — chỉ sống trong transaction của chính lời gọi
--    join — nên sau khi join xong, connection trả về pool không còn đọc được hàng vé nào.
DROP POLICY IF EXISTS room_invite_tokens_select_invite ON public.room_invite_tokens;
CREATE POLICY room_invite_tokens_select_invite ON public.room_invite_tokens FOR SELECT USING (
    token_hash = decode(current_setting('app.invite_hash', true), 'hex')
);

-- 2b. Dự án mà vé mời trỏ tới, để handler biết `owner_id` mà ghi hàng thành viên bằng ngữ cảnh
--     chủ. Policy này đọc `room_invite_tokens`, và policy của bảng đó (cả 006 lẫn 2a) chỉ đọc
--     GUC — không đọc ngược `cloud_projects` — nên không có vòng đệ quy policy.
DROP POLICY IF EXISTS cloud_projects_select_invite ON public.cloud_projects;
CREATE POLICY cloud_projects_select_invite ON public.cloud_projects FOR SELECT USING (
    id IN (
        SELECT t.project_id FROM public.room_invite_tokens t
         WHERE t.token_hash = decode(current_setting('app.invite_hash', true), 'hex')
    )
);

-- 3. Tự kiểm catalog. `store.Migrate` chạy qua pgx nên NOTICE không hiện ra ở đâu cả; một policy
--    thiếu hoặc sai lệnh sẽ im lặng và chỉ lộ ra khi `POST /join` trả 404 cho mọi vé.
DO $$
DECLARE
    n int;
    bad text;
    coltype text;
    -- Tên biến không được là `notnull`: đó là từ khoá của Postgres, plpgsql báo
    -- "syntax error at end of input" ngay ở dòng dùng nó.
    is_not_null boolean;
BEGIN
    -- 3a. Cột `arena_step` phải có, đúng kiểu INTEGER, NOT NULL.
    SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull
      INTO coltype, is_not_null
      FROM pg_attribute a
     WHERE a.attrelid = 'public.room_baton'::regclass
       AND a.attname = 'arena_step'
       AND NOT a.attisdropped;
    IF coltype IS NULL THEN
        RAISE EXCEPTION '007_room_api: bảng room_baton thiếu cột arena_step; chạy migration 006 trước rồi chạy lại file này.';
    END IF;
    IF coltype <> 'integer' OR NOT is_not_null THEN
        RAISE EXCEPTION '007_room_api: cột room_baton.arena_step phải là INTEGER NOT NULL, đang là % (notnull=%).', coltype, is_not_null;
    END IF;

    -- 3b. Hai policy mới phải tồn tại và CHỈ ở lệnh SELECT. Một policy ghi lọt vào đây là mở
    --     đường ghi không cần ngữ cảnh chủ — đúng thứ file này không được phép làm.
    SELECT string_agg(v.pol, ', ')
      INTO bad
      FROM (VALUES
            ('room_invite_tokens', 'room_invite_tokens_select_invite'),
            ('cloud_projects', 'cloud_projects_select_invite')
           ) AS v(tbl, pol)
     WHERE NOT EXISTS (
            SELECT 1 FROM pg_policy p
              JOIN pg_class c ON c.oid = p.polrelid
             WHERE c.relnamespace = 'public'::regnamespace
               AND c.relname = v.tbl
               AND p.polname = v.pol
               AND p.polcmd = 'r');
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '007_room_api: thiếu policy chỉ-đọc khoá theo app.invite_hash (%). Kiểm lại phần 2.', bad;
    END IF;

    -- 3c. Vẫn không có policy FOR ALL trên ba bảng liên quan (006 và 004 đã cấm; file này không
    --     được nới).
    SELECT string_agg(c.relname || '.' || p.polname, '; ')
      INTO bad
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('room_invite_tokens', 'room_baton', 'cloud_projects')
       AND p.polcmd = '*';
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '007_room_api: còn policy FOR ALL (%), trái yêu cầu mỗi lệnh một policy.', bad;
    END IF;

    -- 3d. Token vẫn KHÔNG có policy UPDATE: link mời dùng lại được tới `expires_at` và không có
    --     cột nào đánh dấu "đã dùng" (Task171 đã xoá `used_at`).
    SELECT count(*) INTO n
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname = 'room_invite_tokens'
       AND p.polcmd = 'w';
    IF n <> 0 THEN
        RAISE EXCEPTION '007_room_api: room_invite_tokens có % policy UPDATE; vé mời dùng lại được tới hạn nên không được có đường ghi.', n;
    END IF;

    -- 3e. Role app phải đọc được cả hai bảng, nếu không thì test join sẽ xanh vì
    --     `permission denied` chứ không phải vì RLS.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sqllens_app') THEN
        IF NOT (has_table_privilege('sqllens_app', 'public.room_invite_tokens', 'SELECT')
            AND has_table_privilege('sqllens_app', 'public.cloud_projects', 'SELECT')) THEN
            RAISE EXCEPTION '007_room_api: sqllens_app thiếu quyền SELECT trên room_invite_tokens hoặc cloud_projects; cấp quyền rồi chạy lại.';
        END IF;
    END IF;

    RAISE NOTICE '007_room_api: room_baton có arena_step, thêm 2 policy chỉ-đọc khoá theo app.invite_hash, không policy ghi nào.';
END
$$;
