# SP024: Bản nháp Story & Task — Tầng 2 (Pair-Programming) & Tầng 3 (Deadlock Arena)

> Trạng thái: **BẢN NHÁP v3 — đã vá 14 lỗi kỹ thuật đối chiếu với code ngày 2026-11-23**
> Ngày băm: 2026-11-23 (v1); Cập nhật: 2026-11-23 (v2 sau phản biện DeepSeek; v3 sau khi đối chiếu code)
> Nguồn: `DE_XUAT_STORY_SP024_TEAM_MULTIPLAYER.md` + kết quả Task159 (`STR108/Task159/ket_qua_do.md`)
> **Chủ dự án DUYỆT v3 ngày 2026-11-23.** Từ đây Task160–Task170 được cấp số chính thức và mở thi công theo đúng thứ tự ở mục F. Bản nháp này là nguồn có thẩm quyền cho nội dung từng task cho tới khi mỗi task có file `task0xx.md` riêng.
> Đã commit vào git cùng ngày.

> **Đính chính về v2:** v2 tự khai "đã sửa 21 lỗi phản biện" nhưng đó là 21 lỗi **văn bản** do phản biện DeepSeek nêu. Khi đối chiếu v2 với code thật, còn **14 lỗi kỹ thuật** khiến nhiều task không thể thi công được — chi tiết ở mục G2. Bảng ở mục G **giữ nguyên** để đối chiếu lịch sử; mục G2 mới là danh sách lỗi đã vá trong bản v3 này.

---

## A. Ba quyết định chủ dự án đã chốt (2026-11-23)

| # | Câu hỏi | Quyết định | Hệ quả |
|---|---|---|---|
| **C1** | Schema phòng: bảng mới hay mở rộng bảng cũ? Phòng là cloud project không? | **Đường B — Phòng IS a cloud project. Mở rộng `cloud_project_members`.** | Không tạo bảng `live_rooms`. Migration 006 thêm `invite_tokens` + `baton_state`. Người chưa đăng nhập không vào phòng được (phòng = cloud project). |
| **C2** | Core Rule 7: giữ nợ hay chốt cam kết? | **Duyệt Zero-Log Transit** — chủ dự án xác nhận trực tiếp ngày 2026-11-23, ghi có thẩm quyền ở `SP024/README.md`. SQL đi qua Gin RAM là hợp lệ với điều kiện: 0 byte SQL vào Neon, 0 dòng log SQL ra file/stdout. Phải có AC chứng minh bằng số đo. | Tầng 2 được unblock. Nhưng phải đo 0 byte SQL trên dây trong mỗi task liên quan. **Cấm** dùng `y-websocket` làm dự phòng — nó đẩy toàn bộ văn bản SQL qua Gin. |
| **C3** | Trần Fork: 32KB, 512KB, hay bỏ trần? | **512KB cho IndexedDB fork (không dùng codec URL)**, **cộng** giới hạn tối đa **5 phòng fork đồng thời**. Hai trần này **độc lập, cùng có hiệu lực**: vượt 512KB thì chặn kèm số byte thật; đã có 5 fork thì nút Fork disabled. | Cần viết đường kiểm byte riêng (không dùng `encodeSnapshot`, vì codec URL chặn ở 32KB). `forkRoomToWorkspace` khác với `forkSnapshot` hiện có. |

---

## B. Tóm tắt quyết định đã chốt về phạm vi

| Tầng | Nội dung | Trạng thái |
|---|---|---|
| Tầng 0 (STR108/Task159) | Đo lường hạ tầng | **XONG — kết luận NO-GO cho Live Room SSE** |
| Tầng 1 (STR109–STR112 Live Room SSE) | Live Presentation 1 host → N viewer qua SSE | **KHÔNG LÀM** — Task159: 763× băng thông, SQL bắt buộc rời máy phá Core Rule 7, SSE không tiết kiệm hơn polling |
| **Tầng 3 (STR116) — ĐI TRƯỚC** | Deadlock Arena mô phỏng | **BĂNG TRƯỚC** — không cần Yjs/WebRTC, chỉ cần phòng + polling cho `{step: N}` |
| **Tầng 2 (STR113–STR115)** | Pair-Programming + The Baton | **BĂNG SAU** — cần Yjs + Zero-Log Transit AC |

> **Lý do đảo thứ tự:** Arena (Tầng 3) không phụ thuộc Yjs/WebRTC, không cần Zero-Log Transit đo lường. Có thể có kết quả nhìn thấy ngay sau khi có phòng (migration 006 + Task161-162). Polling cho `{step: N}` đã đo ở Task159: 23.699,7 B/viewer/phút, chênh SSE **0,21%**, chậm hơn **13 ms so với 2 s** — không ai thấy sự khác biệt.

---

## C. Điều kiện tiên quyết bắt buộc

1. **Migration 006** (không phải 005 — `005_cloud_tabs_write_role.sql` đã tồn tại): viết `006_live_rooms.sql` mở rộng schema hiện có
2. **Thêm dependency WebSocket cho Go** (`nhooyr.io/websocket` hoặc tương đương): phiên agent chính thêm vào `api/go.mod` khi mở Task163 (chuẩn QUY_TRINH.md)
3. **Thêm Yjs cho TypeScript** (`yjs`, `y-codemirror.next`, `lib0`, `y-webrtc`): phiên agent chính thêm vào `web/package.json` khi mở Task163
4. **Zustand chưa là direct dependency** (`web/package.json` không có `zustand`, chỉ có qua dep bắc cầu `@xyflow/react`): Task164 phải thêm `zustand` vào `web/package.json` minh bạch
5. **SP999 còn tồn**: các story dưới đây không được đụng file nào trong scope SP999

---

## D. Tầng 3 TRƯỚC: Deadlock Arena (STR116)

> **Arena đi trước vì:** (1) không cần Yjs/WebRTC; (2) không cần SSE — payload `{step: N}` chỉ là một số nguyên, cơ chế lấy về đơn giản hơn SSE nhiều; (3) kết quả nhìn thấy ngay; (4) dùng lại `conflict-sim` và Cytoscape.js đã có.
>
> **Đính chính sau khi đo D17 (2026-11-23):** lý do "(2) polling thay SSE" **không** còn đúng như bản v2 viết. Polling 2 giây **giữ Render thức** (đo: 600/600 request trong 20 phút, 0 cold start; im 20 phút thì cold start 12.576 ms) và **vượt quota `CloudSync` 120 lệnh/5 phút** nên viewer nhận `429` sau ~4 phút. Arena vẫn đi trước, nhưng vì lý do khác: nó không cần Yjs/WebRTC và không cần SQL rời máy. Cơ chế đồng bộ bước vẫn phải chốt (nút bấm tay hay polling 3 s).

---

### STR116 — Deadlock Arena: Đấu trường mô phỏng tranh chấp khóa

**Điều kiện vào:** **Task162 xong** (cần phòng để nhiều người vào cùng một link). Không phải "STR113 xong" — STR113 là Tầng 2, đi **sau** Tầng 3.

**Nhãn:** Mô phỏng (bắt buộc hiện ở mọi màn hình)

#### Task160 — Migration 006: Schema phòng mở rộng cloud_project_members

> **Sửa #1:** Migration phải là **006**, không phải 005. `005_cloud_tabs_write_role.sql` đã tồn tại.

Phạm vi: Chỉ `api/migrations/006_live_rooms.sql`. Không có code Go hay TypeScript mới.

```sql
-- Migration 006: Mở rộng schema cho Live Rooms
-- Phòng = cloud project; mở rộng cloud_project_members thay vì tạo bảng mới.
-- Chạy bằng role SỞ HỮU database, không phải sqllens_app (xem 003_cloud_projects.sql:27-28).

-- 1. Bảng invite token (độc lập, không đọc lại live_rooms để tránh đệ quy policy)
CREATE TABLE IF NOT EXISTS public.room_invite_tokens (
  token       TEXT PRIMARY KEY,
  project_id  UUID NOT NULL REFERENCES public.cloud_projects(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

-- 2. Bảng Baton state (in-memory Gin là chính; bảng này chỉ persist khi Gin restart)
CREATE TABLE IF NOT EXISTS public.room_baton (
  project_id  UUID PRIMARY KEY REFERENCES public.cloud_projects(id) ON DELETE CASCADE,
  holder_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. RLS: ENABLE + FORCE trên cả 2 bảng mới
ALTER TABLE public.room_invite_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_invite_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.room_baton ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_baton FORCE ROW LEVEL SECURITY;

-- 4. Policy THẬT. Cùng khuôn 004_cloud_rls.sql: dùng GUC app.owned_projects,
--    KHÔNG đọc lại cloud_projects trong policy (đệ quy vô hạn đã gặp ở SP023).
--    Invite token chỉ owner thấy và tạo được:
CREATE POLICY room_invite_tokens_select ON public.room_invite_tokens FOR SELECT USING (
  project_id = ANY (COALESCE(
    string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
    '{}'::uuid[]))
);
CREATE POLICY room_invite_tokens_insert ON public.room_invite_tokens FOR INSERT WITH CHECK (
  project_id = ANY (COALESCE(
    string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
    '{}'::uuid[]))
);
CREATE POLICY room_invite_tokens_delete ON public.room_invite_tokens FOR DELETE USING (
  project_id = ANY (COALESCE(
    string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
    '{}'::uuid[]))
);
--    Baton: đọc được nếu là owner HOẶC là thành viên dự án; ghi chỉ owner.
CREATE POLICY room_baton_select ON public.room_baton FOR SELECT USING (
  project_id = ANY (COALESCE(
    string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
    '{}'::uuid[]))
  OR project_id IN (
    SELECT m.project_id FROM public.cloud_project_members m
    WHERE m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
);
CREATE POLICY room_baton_insert ON public.room_baton FOR INSERT WITH CHECK (
  project_id = ANY (COALESCE(
    string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
    '{}'::uuid[]))
);
CREATE POLICY room_baton_update ON public.room_baton FOR UPDATE
  USING (project_id = ANY (COALESCE(
    string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
    '{}'::uuid[])))
  WITH CHECK (project_id = ANY (COALESCE(
    string_to_array(NULLIF(current_setting('app.owned_projects', true), ''), ',')::uuid[],
    '{}'::uuid[])));

-- 5. GRANT cho role app. 003_cloud_projects.sql:353 chỉ cấp cho 3 bảng cloud CŨ,
--    nên nếu bỏ bước này thì sqllens_app nhận "permission denied" chứ KHÔNG phải
--    RLS chặn — test cross-tenant sẽ xanh giả. Phải cấp quyền rồi mới đo được RLS.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.room_invite_tokens, public.room_baton TO sqllens_app;

-- 6. Tự kiểm catalog: thiếu policy nào thì RAISE, không im lặng đi tiếp.
DO $$
DECLARE n int; bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
                 WHERE s.nspname = 'public' AND c.relname = 'room_invite_tokens' AND c.relforcerowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
                 WHERE s.nspname = 'public' AND c.relname = 'room_baton' AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION '006: thiếu FORCE ROW LEVEL SECURITY trên bảng mới.';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('room_invite_tokens', 'room_baton');
  IF n < 6 THEN
    RAISE EXCEPTION '006: mới có % policy trên 2 bảng mới, cần đủ 6. Kiểm lại phần 4.', n;
  END IF;

  -- Lệnh ghi phải có WITH CHECK tường minh (bài học 004_cloud_rls.sql:173-183).
  SELECT string_agg(policyname, ', ') INTO bad FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('room_invite_tokens', 'room_baton')
     AND cmd IN ('INSERT', 'UPDATE') AND with_check IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '006: policy ghi thiếu WITH CHECK tường minh: %.', bad;
  END IF;

  -- Cấp quyền phải thật sự có, nếu không test RLS xanh giả.
  IF NOT (has_table_privilege('sqllens_app', 'public.room_invite_tokens', 'SELECT')
      AND has_table_privilege('sqllens_app', 'public.room_invite_tokens', 'INSERT')
      AND has_table_privilege('sqllens_app', 'public.room_baton', 'SELECT')
      AND has_table_privilege('sqllens_app', 'public.room_baton', 'UPDATE')) THEN
    RAISE EXCEPTION '006: sqllens_app thiếu quyền trên bảng mới, test cross-tenant sẽ xanh giả. Kiểm phần 5.';
  END IF;
  RAISE NOTICE '006: 2 bảng mới đã ENABLE + FORCE RLS, 6 policy, đã GRANT cho sqllens_app.';
END $$;
```

> **Sửa #8 (RLS chỉ là comment):** bản v1 dừng ở `ENABLE`/`FORCE` rồi để một dòng `--` trống. Không có `CREATE POLICY`, không có `GRANT` → AC1/AC2 không thể pass. Bản v2 ở trên viết đủ 6 policy, `GRANT`, và khối `DO $$` tự `RAISE` nếu thiếu.
> **Bẫy xanh giả:** `003_cloud_projects.sql:353` chỉ `GRANT` cho `cloud_projects`, `cloud_tabs`, `cloud_project_members`. Không `GRANT` cho 2 bảng mới thì `sqllens_app` nhận `permission denied`, và một test "cross-tenant bị chặn" sẽ **pass vì sai lý do**. Khối `DO` ở phần 6 chặn đúng cái đó.
> **Sửa #9 (policy đệ quy):** Policy **không** đọc lại `cloud_projects`. Dùng GUC `app.owned_projects` đúng như `004_cloud_rls.sql:87-113`. Riêng `room_baton_select` có đọc `cloud_project_members` — bảng đó **đã** có policy riêng và policy của nó không đọc lại `room_baton`, nên không tạo vòng.

**AC:**
- AC1: `go test -p 1 ./internal/store/...` có `TestLiveRoom006Migration` chạy role `sqllens_app` (non-superuser): cross-tenant bị chặn
- AC2: Migration tự đọc lại `pg_policies` và `relforcerowsecurity`, `RAISE` nếu thiếu
- AC3: Chạy `go test -p 1 ./...` 7/7 package, không có deadlock hay schema_migrations conflict

**Nhãn:** Chưa đo (task đầu tiên của SP024 Tầng 2/3, chưa có số thực nghiệm)

#### Task161 — Gin API phòng (mở rộng từ SP023 cloud API)

> **Sửa #10 (dựng lại thứ đã có):** Tái sử dụng `cloud_projects` như phòng. Host = owner. Phòng tạo = cloud project tạo. Chỉ thêm endpoint invite + baton.

Phạm vi: `api/internal/httpapi/live_rooms.go` + mở rộng `api/internal/store/cloud.go`. Gắn vào `main.go` sau `RequireUser`.

Endpoints mới (bổ sung vào `/api/v1/cloud/`). **6 endpoint**, tất cả dưới `RequireUser`:
- `POST /api/v1/cloud/projects/:id/invite` — tạo invite token 24h (chỉ owner)
- `POST /api/v1/cloud/projects/join` — dùng token để gia nhập (thêm vào `cloud_project_members`)
- `DELETE /api/v1/cloud/projects/:id/members/:uid` — thu hồi quyền (chỉ owner)
- `GET /api/v1/cloud/projects/:id/baton` — ai đang giữ Baton. **Chỉ Task161 sở hữu endpoint này**; Task163 KHÔNG đăng ký lại
- `POST /api/v1/cloud/projects/:id/baton/claim` — host/owner reset Baton về mình (recovery)
- `POST /api/v1/cloud/projects/:id/arena-step` + `GET /api/v1/cloud/projects/:id/arena-step` — lưu/đọc `{step: N}` cho Arena (Task169 dùng). Hai phương thức, **một** mục endpoint.

> **Sửa #12 (`arena-step` mồ côi):** bản v1 để Task169 tự phát minh `arena-step`, trong khi bảng F lại ghi Task161 làm ra nó và AC4 chỉ đòi test cho 5 endpoint. Nay `arena-step` nằm trong danh sách của Task161, và AC4 đếm đúng **6** endpoint.
> **Sửa #14 (`GET /baton` bị hai task cùng nhận):** bản v1 để cả Task161 (dòng 113) và Task163 (dòng 245) đăng ký `GET /baton`. Gin sẽ panic `handlers are already registered` khi khởi động. Nay Task161 sở hữu; Task163 chỉ thêm các endpoint **chưa** có.

**AC:**
- AC1: `POST /invite` → token 24h; `POST /join` với token hết hạn → 410 `token_expired`
- AC2: `DELETE /members/:uid` → 403 khi không phải owner; thành viên bị xóa gọi `GET /projects/:id` → 404
- AC3: Gin chỉ log `%T` của lỗi, 0 byte SQL trong log
- AC4: `go test -p 1 ./internal/httpapi/...` có **≥ 6 test case, mỗi endpoint một case** (invite, join, delete member, GET baton, POST baton/claim, arena-step) — không đếm trùng
- AC5: Đăng ký route xong, gọi `r.Routes()` và khẳng định **không có panic trùng handler**; liệt kê đủ 6 đường dẫn

**Nhãn:** Chưa đo

#### Task162 — UI Mời cộng tác & Danh sách thành viên

> **Sửa #11 (ghi sai file UI):** Nút "Mời cộng tác" nằm ở `web/src/modules/lab/stage/stage.tsx` (cạnh `ShareDialog` + `ExportMenu` dòng 559-562), không phải `lab-workspace.tsx`.

Phạm vi: `web/src/modules/room/` (module mới, chỉ giao diện). Thêm nút vào `stage.tsx:559-562`.

Component:
- `<InviteDialog />` — dialog hiện link token + nút Copy + danh sách thành viên với vai trò
- `<JoinRoomPage />` — trang `/join?token=...` xử lý gia nhập, redirect về project sau join
- Nút "Mời cộng tác" thêm vào `stage.tsx` cạnh `ShareDialog`

> **Sửa #12 (hardcode tên Amelia):** Mọi chuỗi UI phải qua file bản dịch. Không có chuỗi hardcode trong AC.
>
> **Sửa #7 (đường dẫn i18n sai):** bản v1 ghi `messages/vi.json` và `messages/en.json` — **hai file đó không tồn tại**. Repo dùng **39 file JSON mỗi ngôn ngữ** trong `web/messages/vi/` và `web/messages/en/` (ví dụ `auth.json`, `cloud.json`, `labStage.json`). Task162 tạo file mới `web/messages/vi/room.json` + `web/messages/en/room.json` và đăng ký namespace theo đúng cách các module khác đang làm.
>
> **Bẫy route `/join`:** phải nằm trong `[locale]`, tức `web/src/app/[locale]/join/page.tsx`. Đặt `/join` trần ở `web/src/app/` sẽ 404: `web/src/app/[locale]/layout.tsx` gọi `notFound()` khi locale không hợp lệ, và `generateStaticParams` chỉ sinh `vi`/`en`. Ngoài ra `web/src/proxy.ts:16` loại mọi path bắt đầu bằng `api` khỏi middleware i18n.

**AC:**
- AC1: `npm run check:i18n` PASS — mọi chuỗi mới có bản vi + en
- AC2: Playwright: owner mở InviteDialog → copy link → member dùng link → redirect đúng project → owner thấy member trong danh sách
- AC3: `npm run check` PASS. 390px mobile không tràn

**Nhãn:** Chưa đo

#### Task168 — Arena: Chọn kịch bản + điều hướng bước

> **Điều kiện:** Task162 xong (cần phòng để nhiều người vào cùng link).
> **Sửa #15 (3 điều kiện vào mâu thuẫn):** Arena cần phòng, nên KHÔNG song song với STR115. Điều kiện vào: Task162 xong.

Phạm vi: `web/src/modules/arena/` (module mới). Dùng lại `conflict-sim` data từ SP011/Task050-051 (5 kịch bản PostgreSQL, 13 biến thể).

```
arena-store.ts  — Zustand slice: { scenario, step, participants }
<ScenarioPicker /> — danh sách 5 kịch bản + mô tả ngắn
<StepController /> — Bước trước / Bước sau / Play tự động (500ms/bước)
```

**AC:**
- AC1: Chọn kịch bản có id **`deadlock_reverse_order`** (tên hiển thị lấy từ bản dịch) → thấy bước 1 với 2 transaction; bước 3 hiện deadlock detected
- AC2: Nhãn **Mô phỏng** luôn hiện ở header, không thể ẩn
- AC3: `npm run check` PASS. `npm run check:i18n` PASS
- AC4: `<ScenarioPicker />` liệt kê **đúng 5 kịch bản đang có**, đọc id từ `web/src/modules/conflict-sim/engine/scenarios.ts`: `lost_update`, `deadlock_reverse_order`, `write_skew`, `double_booking`, `non_repeatable_read`. Không tự đặt tên mới.

> **Sửa #4 (kịch bản không tồn tại):** bản v1 gọi kịch bản là **"Deadlock 2 chiều"**. Không có kịch bản nào mang tên đó trong code. Id thật là `deadlock_reverse_order` (`scenarios.ts:34`). Tên hiển thị tiếng Việt phải qua bản dịch, không hardcode vào AC.

**Nhãn:** Mô phỏng

#### Task169 — Arena: Đồ thị Cytoscape realtime + Viewer sync qua Polling

> **Sửa #14 (SSE trở lại, trả lời sai câu hỏi):** Arena dùng **polling** cho `{step: N}` thay vì SSE. Băng thông hai bên chênh **0,21 %**, nên chọn polling là hợp lý. **Nhưng chu kỳ 2 giây thì không** — xem "Sửa #20" ngay dưới.
> **Sửa #20 (D17 — "polling cho Render ngủ" là SAI, đã đo):** bản v2 viết "Polling không cần kết nối liên tục → Render ngủ". Đo thật ngày 2026-11-23 trên `https://sqllens.onrender.com` nói ngược lại:
> - Pha A: 600 request cách nhau 2 s trong 19,96 phút → **600/600 trả 200, 0 cold start**, trung vị 83 ms, lớn nhất 509 ms. Service **thức suốt**.
> - Pha B (phản chứng): im hoàn toàn 20,0 phút rồi bắn **một** request → **12.576 ms** (cold start). Vậy điều kiện ngủ có thật, và pha A đúng là đã phá nó.
> - Pha C: 5 viewer poll song song 2 phút → 300 request, **9.167,1 req/giờ**, gấp **5,083×** pha A (lý thuyết 5×). Số request tăng tuyến tính, **số giờ Render thì không** — 1 viewer và 5 viewer tốn cùng giờ.
> - Một phiên 1 giờ tốn **1,25 giờ Render** (1,0 h thức là Thật + 0,25 h đuôi sau request cuối là giả định từ tài liệu, chưa đo).
> - Trần thực tế: **600 giờ Arena/tháng** (khoảng 20 giờ/ngày) mới chạm trần 750 h.
>
> **Chặn cứng thứ hai, nặng hơn — quota có sẵn trong code sẽ trả 429:** `arena-step` nằm dưới `/api/v1/cloud/` nên đi qua `RequireUser` + `GateLimit(quota.CloudSync, false)` (`api/cmd/server/main.go:65-70`). `CloudSync` = **120 lệnh / 5 phút** (`api/internal/quota/quota.go:40`) = 24 lệnh/phút; rate limiter trong bộ nhớ = **30 request/phút** (`api/internal/auth/auth.go:107`). Poll 2 s = **30 request/phút = 150/5 phút**, vượt `CloudSync` **25 %** và chạm đúng trần limiter. Viewer nhận `429 quota_exceeded` sau khoảng **4 phút**. Mỗi request còn tốn một lệnh `EVAL` lên Upstash: **1.800 lệnh/giờ/viewer** trên quota 500.000 lệnh/tháng.
>
> **Chu kỳ tối thiểu nếu vẫn giữ polling:** 2,5 s (chạm đúng trần `CloudSync`); an toàn nên dùng **3 s** (20 request/phút, còn 17 % dư).
>
> **Không có chu kỳ nào vừa nhanh hơn 15 phút vừa để Render ngủ.** Dưới 15 phút thì service thức; trên 15 phút thì mỗi lần lấy dữ liệu là một cold start 12,5 giây — không dùng được. Chọn polling là chọn giữ service thức.
>
> **Chủ dự án đã chốt phương án (b) — polling chu kỳ 3 giây — ngày 2026-11-23.** Phương án (a) nút bấm tay bị loại vì bắt viewer tự bấm mới thấy bước mới, trái mục tiêu "nhiều người xem cùng lúc" của Tầng 3. Chu kỳ 3 giây đã được kiểm là nằm dưới mọi trần có sẵn trong code:
> - `arena-step` đi qua `RequireUser` + `GateLimit(quota.CloudSync, false)` tại `api/cmd/server/main.go:65-70`.
> - `CloudSync` = **120 lệnh / 5 phút** (`api/internal/quota/quota.go:40`), tức 24 lệnh/phút.
> - Rate limiter trong bộ nhớ = **30 request/phút** (`api/internal/auth/auth.go:107`), áp bên trong `GateLimit` (`auth.go:300-308`).
> - Poll 3 giây = **20 request/phút = 100 request/5 phút**, tức **dưới** trần `CloudSync` 120 khoảng **17 %** và dưới trần limiter 30 request/phút. Không còn nguy cơ `429`.
> - Poll 2 giây = 30 request/phút = 150 request/5 phút, **vượt** `CloudSync` **25 %**. Đó là lý do **không dùng 2 giây**.
> - Chi phí Upstash: mỗi request `arena-step` tốn một lệnh `EVAL` (`quota.go:74`). Poll 3 giây = **1.200 lệnh/giờ/viewer**; quota free 500.000 lệnh/tháng đủ cho khoảng **416 giờ-viewer/tháng**, thoải mái cho quy mô hiện tại.
>
> **Giờ Render từ nay do lịch giữ thức quyết định, không do polling.** Service được giữ thức có chủ đích bằng **cron-job.org**, thay cho GitHub Actions `keep-awake`, vì lịch sử chạy thật của GitHub Actions cho thấy nó dồn và bỏ nhịp cron khi tải cao: **3,1 lần/ngày** thay vì 144 lần/ngày theo thiết kế (64 lần trong 20,66 ngày; 63/63 khoảng cách giữa hai lần đều vượt ngưỡng ngủ 15 phút). Cửa sổ giữ thức chốt là **7:00–24:00 giờ Việt Nam**, khớp dòng "Giờ chạy backend" trong `CLAUDE.md`. Trần Render là **750 h/tháng cho cả workspace**, nên 17 h/ngày cho khoảng **510 h/tháng = 68 % trần** và còn dư 240 h; giữ 24/7 sẽ là **730 h/tháng = 97,3 % trần**, chỉ dư 20 h nên không chọn. Trong cửa sổ đó service đã thức sẵn nên polling không cộng thêm giờ Render; ngoài cửa sổ service ngủ và request đầu tiên là cold start khoảng **12,5 giây** (đo được 12.576 ms), hành vi đã được chấp nhận.
> Payload polling: `{step: N}` — không có SQL, không vi phạm Core Rule 7.
> **Endpoint do Task161 sở hữu:** Task169 **không** đăng ký route mới, chỉ gọi `POST`/`GET /api/v1/cloud/projects/:id/arena-step` mà Task161 đã làm.
> **Sửa #12 (con số so sánh sai):** bản v1 viết "chậm hơn **13 ms so với 2 s**". Đó là ghép hai số khác đơn vị: 13 ms là **độ trễ một sự kiện SSE** đo ở Task159, còn 2 s là **chu kỳ polling** — không phải hai số cùng phép đo. Cách viết đúng: SSE giao sự kiện sau **13 ms**; polling 2 s giao sau tối đa **2.000 ms** (trung bình 1.000 ms). Băng thông hai bên chênh **0,21 %** (23.649,6 so với 23.699,7 B/viewer/phút) — đó mới là lý do chọn polling, không phải độ trễ.

Phạm vi: `web/src/modules/arena/graph/` — Cytoscape layout cho Wait-For Graph.

Màu node: 🟢 xanh (running) / 🟡 vàng (waiting) / 🔴 đỏ (deadlocked) / ⬜ xám (committed/rolled back).

Viewer sync: Host điều hướng bước → `POST /api/v1/cloud/projects/:id/arena-step` (Task161) lưu `{step: N}` → Viewer lấy `GET` cùng đường. **Chu kỳ đã chốt (D17): polling 3 giây.** Không dùng 2 giây vì 30 request/phút vượt trần `CloudSync` 120 lệnh/5 phút khoảng 25 %.

**AC:**
- AC1: Playwright 2-browser: Host bấm Next Step → Viewer thấy graph cập nhật trong < 3,5 s (3 s chu kỳ + 0,5 s biên)
- AC2: Nhãn Mô phỏng hiện cả trên Host và Viewer
- AC3: Gin log 0 byte SQL (payload chỉ là `{step: N}`)
- AC4: `npm run check` PASS
- AC5: **Đo tải**: 1 viewer thực hiện đúng chu kỳ đã chốt (3 giây) trong 5 phút liên tục → **0 response `429`**, và số request/5 phút là **khoảng 100 request/5 phút**, vẫn dưới trần `quota.CloudSync` 120. Ghi số đo thật vào bàn giao. Không được chốt AC này bằng suy luận.

**Nhãn:** Mô phỏng

#### Task170 — Arena: AI Mentor phân tích kịch bản (VIP only)

> **Sửa #17 (thiếu Nguyên tắc 6):** Prompt template từ `conflict-sim` data, không nhúng SQL workspace. Nghiệm thu phải có AC kiểm prompt không chứa SQL của người dùng.

Phạm vi: Nút "Phân tích với AI Mentor" trong Arena → gọi **`POST /api/ai/inline-complete`** (route đã có, `api/internal/ai/ai.go:97` và `:100`).

> **Sửa #2 (route không tồn tại):** bản v1 ghi `/api/v1/ai/inline-complete`. **Route đó không tồn tại.** `api/internal/ai/ai.go` chỉ đăng ký `/ai/inline-complete` (dòng 97) và `/api/ai/inline-complete` (dòng 100) — **không có `/v1`**. Frontend thật đang gọi `/api/ai/inline-complete` (`web/src/modules/vip/api/copilot-client.ts:50`). Dùng đúng đường đó.

**AC:**
- AC1: Nút chỉ hiện với user VIP (kiểm `u.IsVIP()` ở `middleware.go:271`)
- AC2: Prompt template **không** nhúng bất kỳ chuỗi SQL nào từ workspace — grep prompt trước khi gửi, nếu có `SELECT|INSERT|UPDATE|DELETE|CREATE` từ tab người dùng → test FAIL
- AC3: Response hiện trong Chat Drawer. `npm run check` PASS
- AC4: Không gọi `/api/v1/ai/*`. Test khẳng định URL gọi ra là `/api/ai/inline-complete`, sai đường dẫn thì FAIL

**Nhãn:** Mô phỏng

---

## E. Tầng 2 SAU: Pair-Programming + The Baton (STR113–STR115)

---

### STR113 — Mở rộng phân quyền phòng

**Điều kiện vào:** **Task162 xong** (cùng điều kiện với STR116 — cả hai cần phòng). Không phụ thuộc "Arena vận hành ổn định": vòng phụ thuộc cũ (STR116 cần STR113, STR113 cần Arena) đã bị cắt.

> **Sửa #10:** STR113 không tạo lại schema. Dùng `cloud_project_members` đã có. Chỉ thêm endpoint thu hồi quyền và cập nhật UI.

Thực tế `cloud_project_members` đã có `role IN ('owner','editor','viewer')` + RLS đầy đủ từ SP023. Task161 đã thêm endpoint invite/join. STR113 bổ sung:
- UI hiển thị danh sách member trong Lab (không phải chỉ trong InviteDialog)
- Phân biệt rõ hơn giữa `owner` (host, có Baton ban đầu) vs `editor` (có thể xin Baton) vs `viewer` (chỉ xem)

> **Sửa #19 (không AC kiểm đồng thời):** STR113 phải có AC: ≥2 editor + ≥2 viewer trong cùng phòng cùng lúc — đây là yêu cầu gốc của chủ dự án.

**AC thêm (sửa #19):**
- AC: Playwright 4-browser: 2 editor + 2 viewer vào cùng project → tất cả 4 thấy danh sách thành viên đúng; owner thu hồi quyền editor 1 → editor 1 không thấy CodeMirror editor mode

**Nhãn:** Chưa đo

---

### STR114 — Đồng biên tập Yjs & Điều phối The Baton

> **Sửa #3 (hai phương tiện cho cùng một chặng):** Chọn dứt khoát **WebRTC DataChannel P2P** cho payload kết quả. Không dùng SSE từ máy Driver. Gin chỉ làm signaling (SDP/ICE relay), không relay payload SQL.
>
> **Sửa #2 (WebSocket 0 dep):** Task163 phải thêm thư viện WebSocket Go vào `api/go.mod` — không phải "đã có".

**Rào chắn Core Rule 7 (C2 đã duyệt Zero-Log Transit):** SQL đi qua Gin RAM là hợp lệ **với điều kiện**:
- 0 byte SQL vào Neon DB
- 0 dòng log SQL ra stdout/file
- Phải có AC đo 0 byte SQL trên dây (như Task148 đo 0 request mang payload)

**Hạn chế Symmetric NAT (R1):** WebRTC DataChannel không kết nối được nếu cả 2 user sau Symmetric NAT. V1 không làm TURN server.

> **Sửa #3 (cảnh báo NAT không có AC):** Thêm AC kiểm: hiện banner cảnh báo "Tính năng hoạt động trên cùng mạng LAN hoặc Open NAT" khi WebRTC kết nối thất bại sau 10s.

#### Task163 — Thêm Yjs, Gin WebSocket signaling + Baton REST API

> **Sửa #2:** Task163 phải minh bạch: thêm `nhooyr.io/websocket` (hoặc tương đương) vào `api/go.mod` và thêm `yjs`, `y-codemirror.next`, `lib0`, `y-webrtc` vào `web/package.json` — cả hai việc đều phải làm bởi phiên agent chính theo QUY_TRINH.md.

Endpoints signaling (mới):
- `GET /api/v1/cloud/projects/:id/signal` — WebSocket upgrade; relay SDP/ICE offer/answer giữa peers trong RAM. **0 byte SQL logged**

> **Đã đo 2026-11-23 — WebSocket qua `rewrites` của Next.js 16.4.4 CHẠY ĐƯỢC.** `new WebSocket(...)` qua `next start` mở sau **15 ms**, echo sau **19 ms**; gọi thẳng server Go (đối chứng) mở sau **11 ms**. Chênh ~4 ms. Có header `Origin` cũng mở được (12 ms). Vậy kiến trúc P2P + Gin signaling **không cần đổi**. Chưa đo trên Vercel thật — Vercel giới hạn thời lượng hàm và không cam kết WebSocket cho mọi gói, phải kiểm lại trên bản deploy.
>
> **Bẫy đường dẫn (quan trọng, đọc trước khi code):** `web/next.config.ts:35` đặt `source: "/api/:path*"`, `destination: \`${apiOrigin()}/:path*\`` — cặp này **cắt tiền tố `/api`** khi chuyển tiếp. Đo thật: trình duyệt gọi `/api/v1/cloud/projects/abc/signal`, Gin nhận `/v1/cloud/projects/abc/signal`. Vì vậy Task163 **không được** đăng ký route ở `/api/v1/.../signal` nếu chưa sửa rewrite; xem mục "Sửa bắt buộc" bên dưới.

> **Sửa bắt buộc trước Task163 — rewrite đang cắt `/api`.** Lỗi này đã ghi ở `SP999` (dòng SPIKE 2026-11-23) và **đang làm hỏng đồng bộ Cloud trên production từ Task150**: `POST /api/v1/cloud/projects` qua Vercel trả **404 `not_found`**, gọi thẳng Render trả **401 `auth_required`** (route khớp). Mọi route khác không bị vì chúng đăng ký **không** có `/api`. Bản sửa đã chọn: thêm rule rewrite hẹp cho tiền tố cloud, đặt **trước** rule chung. Task163 chỉ được coi là "route đúng" sau khi bản sửa đó vào `main`; nếu chưa, `/signal` sẽ nhận 404 y như cloud hiện nay.

Endpoints Baton (mới, **chưa có ở Task161**):
- `POST /api/v1/cloud/projects/:id/baton/request` — xin quyền
- `POST /api/v1/cloud/projects/:id/baton/grant` — cấp quyền (chỉ người đang giữ)
- `POST /api/v1/cloud/projects/:id/baton/heartbeat` — gia hạn 30s

> **Sửa #14 (`GET /baton` bị hai task cùng nhận):** bản v1 để Task163 đăng ký lại `GET /api/v1/cloud/projects/:id/baton`, trùng Task161 dòng 113. Gin panic `handlers are already registered` khi khởi động. Nay `GET /baton` **chỉ** thuộc Task161; Task163 thêm 3 endpoint còn lại.

> **Sửa #16 (Baton trong RAM Gin):** Gin free tier ngủ sau 15 phút không có request và restart khi deploy. Baton state chỉ có ý nghĩa khi phòng đang active. Khi Gin restart, Baton tự về `null` → owner/host tự động nhận lại bằng `/baton/claim` (Task161 AC2). Ghi rõ hạn chế này trong code comment: `// Baton state is ephemeral; resets on server restart. Host reclaims via /baton/claim.`
>
> **Đính chính sau khi đo D17 (2026-11-23):** bản v2 lập luận "polling Arena tránh cần RAM liên tục" — **sai**, vì polling 2 giây giữ service thức, nên RAM thực ra được giữ liên tục trong suốt phiên. Lập luận đó bị bỏ. Hạn chế "Baton state mất khi restart" vẫn đúng và vẫn phải ghi comment, nhưng không được viện cớ polling để miễn kiểm nó.

**AC:**
- AC1: TestBatonLifecycle: request → grant → heartbeat timeout 30s → auto-return host
- AC2: Gin log **0 byte SQL** khi relay SDP/ICE (ép log buffer như Task150)
- AC3: Thêm dep thành công: `go build ./...` PASS, `tsc --noEmit` PASS, `npm run check` PASS
- AC4: **Chứng minh nâng cấp WebSocket thật sự chạy**, không chỉ "build được". Test dựng `httptest.NewServer` với route `/signal`, mở client WebSocket, khẳng định handshake **101 Switching Protocols**, gửi 1 message qua lại và nhận đúng echo. Test FAIL nếu chỉ kiểm `go build`.
- AC5: Route `/signal` nằm đúng đường dẫn mà rewrite giao tới (kiểm bằng cách đọc `r.Routes()` và đối chiếu với `web/next.config.ts`), không đăng ký trùng `GET /baton`

**Nhãn:** Chưa đo

#### Task164 — Yjs Provider + CodeMirror 6 binding

> **Sửa #7 (zustand không phải direct dependency):** Task164 phải thêm `zustand` vào `web/package.json` minh bạch trước khi dùng.

Phạm vi: `web/src/modules/room/collab/`.

```
room-provider.ts   — kết nối Y.Doc qua y-webrtc (P2P, signaling qua Gin /signal)
collab-binding.ts  — Y.Text ↔ CodeMirror 6 EditorState (y-codemirror.next)
baton-store.ts     — Zustand slice: { holder: userId | null, myRole, requestBaton(), grantBaton() }
```

**AC:**
- AC1: Vitest unit: 2 Y.Doc sync độc lập, insert/delete conflict hội tụ về cùng kết quả
- AC2: `zustand` có trong `web/package.json` (không chỉ dep bắc cầu)
- AC3: `tsc --noEmit` PASS. `npm run check` PASS

**Nhãn:** Chưa đo

#### Task165 — UI The Baton: nút Run có trạng thái, toast xin quyền

> **Sửa #12 (hardcode tên Amelia):** AC phải dùng biến, không hardcode.

Phạm vi: **`web/src/modules/lab/lab-workspace.tsx:748-759`** (nút Play hiện có, bên trong `<Tip>`) + thêm `<BatonRequestToast />`.

> **Sửa #3 (component không tồn tại):** bản v1 viết "Chỉnh `<RunButton />` hiện có". **Không có component nào tên `<RunButton />` trong `web/src`** (đã grep toàn bộ). Nút chạy thật là `<Button>` inline trong `lab-workspace.tsx:749-758`, có `aria-label={hasSelectionToRun ? t("runSelected") : t("run")}` và `disabled={!canRun}`. Sửa đúng chỗ đó, đừng tạo component mới rồi bọc lại.

**AC:**
- AC1: Nút Run disabled với tooltip chứa **tên người đang giữ Baton** (lấy từ baton-store, không hardcode)
- AC2: Playwright 2-browser: Request → Grant → Baton chuyển mượt mà
- AC3: `npm run check:i18n` PASS — mọi chuỗi Baton có bản vi + en
- AC4: Viewer (role `viewer`) không thấy nút Run, không thấy nút Xin quyền

**Nhãn:** Chưa đo

#### Task166 — WebRTC DataChannel: broadcast kết quả P2P

**AC:**
- AC1: Playwright 2-browser context: Driver bấm Run → Viewer nhận kết quả trong < 1s
- AC2: Gin log 0 byte SQL trong toàn bộ luồng
- AC3: Playwright: `killbrowser` Driver → 30s sau Viewer nhận `{type:'baton-returned', holder: ownerId}`
- AC4: Mạng thất bại (Symmetric NAT giả lập) → banner cảnh báo NAT hiện sau 10s, không crash
- AC5: `npm run check` PASS

**Nhãn:** Chưa đo

---

### STR115 — Fork sang Local Sandbox (phòng → IndexedDB)

> **Sửa #5 (512KB/32KB):** Fork **không dùng `encodeSnapshot`** (codec URL, chặn ở 32KB). Viết đường kiểm byte riêng cho IndexedDB: tổng `JSON.stringify(tabs)` phải < 512KB.
>
> **Sửa #6 (`createTabs()` không tồn tại):** Dùng `forkSnapshot()` đã có ở `web/src/modules/share/fork.ts` như nền tảng; viết `forkRoomToWorkspace()` **gọi lại** nó với nguồn dữ liệu từ Yjs store thay vì URL fragment.
>
> **Sửa #18 (`0 request` tự mâu thuẫn):** `fork.ts:109` gọi `/api/me` một lần để resolve scope. AC phải ghi: "1 request duy nhất (`/api/me`), không request nào mang SQL".
>
> **Quyết định C3 (giới hạn 5 phòng fork):** Nút Fork disabled khi `forkCount >= 5`. UI hiện "Bạn đang có N phiên fork (tối đa 5). Xóa một phiên trước."
>
> **Sửa #5 (tag `source: 'room-fork'` không tồn tại):** bản v1 đếm fork bằng "project có tag `source: 'room-fork'`". `WorkspaceProject` (`web/src/modules/workspace/types.ts:21-29`) chỉ có `id`, `scopeKey`, `name`, `engine`, `createdAt`, `updatedAt`, `cloud?` — **không có trường tag/source nào**. `CURRENT_DB_VERSION = 1` (`db.ts:4`) và không có migration. Ba cách đã cân nhắc: **(i)** thêm một trường tuỳ chọn vào `WorkspaceProject`; **(ii)** lưu danh sách fork trong `localStorage` như `share/fork.ts` đang làm cho lịch sử fork (`rememberForkedSnapshot`, dòng 95) — rẻ nhất, nhưng mất khi người dùng xoá storage và không đếm được nếu mở nhiều trình duyệt; **(iii)** đếm theo tên dự án (`${name} (fork)`) — **không dùng**, vì người dùng đổi tên được nên đếm sẽ sai.
>
> **Chủ dự án đã chốt phương án (i) ngày 2026-11-23 (D20).** Trường thêm vào là `roomFork?: { projectId: string; forkedAt: number }` trong `WorkspaceProject`, **không bump `CURRENT_DB_VERSION`** (giữ nguyên 1) và không viết thêm `onupgradeneeded`. Đếm bằng `listProjects(scope)` rồi `filter`, không cần index mới. Năm điểm dưới đây đã được kiểm bằng cách đọc code:
> - `WorkspaceProject` (`web/src/modules/workspace/types.ts:21-29`) là kiểu TypeScript thuần. Object store `projects` trong IndexedDB khai `keyPath: "id"` và **không** khai schema cho các trường còn lại (`web/src/modules/workspace/db.ts:21-24`). Thêm một trường tuỳ chọn vào bản ghi **không cần** đổi version và **không cần** `onupgradeneeded`, vì IndexedDB không kiểm schema trường; bản ghi cũ thiếu trường sẽ đọc ra `undefined`.
> - `projectStamp` (`web/src/modules/cloud/status.ts:36-44`) chỉ băm `name`, `engine` và danh sách `[tên tab, sql]`. Trường mới **không** lọt vào stamp, nên thêm nó không làm dự án bị coi là "đã sửa" (không sinh false `modified`).
> - Payload đẩy cloud (`web/src/modules/cloud/sync.ts:369-374`) chỉ gồm `name`, `engine`, `tabs`, `baseUpdatedAt`. Trường mới **không** lọt lên cloud, nên **không vi phạm Core Rule 7**.
> - Khi kéo dự án từ cloud về (`web/src/modules/cloud/apply.ts:97-107`), bản ghi được dựng bằng `...local`, nên trường mới **sống sót** qua vòng kéo cloud.
> - Không cần index mới: đếm bằng `listProjects(scope)` rồi `filter`, và `listProjects` đã có (`web/src/modules/workspace/repository.ts:101-108`).
>
> **Redis bị từ chối cho việc đếm này**, vì bốn lý do. Thứ nhất, nguồn sự thật của workspace là IndexedDB trên máy người dùng, nên đếm trên server là đếm một bản sao lệch: người dùng xoá dự án trong IndexedDB thì Redis không biết, đếm sẽ cao giả và khoá nút Fork vĩnh viễn. Thứ hai, muốn đếm trên Redis thì mỗi lần fork phải gửi một request lên server, phá AC5 của Task167 ("đúng 1 request `/api/me`, 0 request mang nội dung SQL"). Thứ ba, thêm một điểm hỏng: Upstash không truy cập được thì Fork hỏng, dù thao tác fork hoàn toàn cục bộ và đáng lẽ không cần mạng. Thứ tư, không nhẹ hơn: một lệnh Redis mỗi lần fork cộng thêm một vòng mạng, so với đọc `listProjects` đã có sẵn trong IndexedDB (một transaction, không mạng).
>
> **Sửa #8 (vừa wrap vừa viết mới):** bản v1 nói "wrap `forkSnapshot`" nhưng đồng thời định nghĩa `checkForkSize` + `countActiveForks` + đường ghi riêng trong `room/fork.ts` — hai thiết kế khác nhau cho cùng một việc. Chốt: `room/fork.ts` **chỉ** lo phần riêng của phòng (kiểm byte 512KB, đếm 5 fork, lấy `tabs` từ Yjs store) rồi **gọi** `forkSnapshot(snapshot, scope, options)` để ghi. Không viết lại đường ghi IndexedDB.
>
> **Sửa #6b (`FORK_TOO_LARGE` ngoài union):** `ForkErrorCode` là union đóng `"FORK_STORAGE_UNAVAILABLE" | "FORK_QUOTA_EXCEEDED" | "FORK_FAILED"` (`share/fork.ts:19`). `new ForkError('FORK_TOO_LARGE', ...)` **không biên dịch được**. Chọn **một**: mở rộng union thêm `"FORK_TOO_LARGE"` (phải rà mọi `switch` trên `code` để thêm nhánh, kể cả `share-dialog.tsx`), hoặc dùng `ForkError('FORK_FAILED', ...)` với message riêng. **Đề xuất: mở rộng union** — thông báo cho người dùng khác nhau thật, gộp vào `FORK_FAILED` sẽ làm UI hiện sai câu.
>
> **Sửa #9 (AC5 đo sai chỗ):** AC5 đòi "1 request `/api/me`" nhưng request đó do **người gọi** `resolveWorkspaceScope()` phát ra, không phải do `forkSnapshot` hay `forkRoomToWorkspace`. Nếu Task167 không tự gọi `resolveWorkspaceScope` thì AC này không đo được gì. Sửa AC5 thành: đo trên **toàn bộ luồng bấm Fork** (từ click tới khi dự án mới hiện trong Lab), khẳng định đúng **1** request `/api/me` và **0** request nào mang nội dung SQL.

#### Task167 — Fork to Local Sandbox (5 fork limit + 512KB)

Phạm vi: `web/src/modules/room/fork.ts` (mới, chỉ phần riêng của phòng) + `<ForkDialog />`. Phần ghi IndexedDB **gọi lại** `forkSnapshot` từ `share/fork.ts`, không viết lại.

```typescript
// Hằng số (không dùng SNAPSHOT_HARD_LIMIT_BYTES vì codec URL chặn ở 32KB):
const ROOM_FORK_MAX_BYTES = 512 * 1024;  // 512KB cho IndexedDB (không phải URL)
const ROOM_FORK_MAX_ACTIVE = 5;           // Tối đa 5 phòng fork đồng thời

// Kiểm trần bytes riêng cho IndexedDB. Trả về tab vi phạm để AC4 hiện được tên.
function checkForkSize(tabs: WorkspaceTab[]): { ok: true } | { ok: false; bytes: number; tabName: string }

// Đếm số fork đang mở. Nguồn dữ liệu: trường roomFork? trên WorkspaceProject đã chốt ở
// "Sửa #5" (D20), đếm bằng listProjects(scope) rồi filter. Không bump DB version.
async function countActiveForks(scope: WorkspaceScope): Promise<number>
```

**AC:**
- AC1: Playwright: fork 3 tab → vào Lab → thấy dự án mới với đúng 3 tab, nội dung khớp
- AC2: Đã có 5 fork → nút Fork disabled, tooltip đúng (vi + en)
- AC3: Thêm fork thứ 6 bằng API trực tiếp → `countActiveForks` trả 6, UI hiện đúng
- AC4: Tab vượt 512KB → cảnh báo hiện **byte thật** và **tên tab vi phạm** (không âm thầm cắt)
- AC5: Đo trên **toàn bộ luồng bấm Fork**: đúng **1 request `/api/me`**, **0 request nào mang nội dung SQL** — đo bằng Playwright `network` interceptor
- AC6: `npm run check` PASS
- AC7: `new ForkError('FORK_TOO_LARGE', ...)` **biên dịch được** (`tsc --noEmit` PASS), và mọi `switch` trên `ForkErrorCode` có nhánh cho mã mới

**Nhãn:** Chưa đo

---

## F. Bảng tổng quan task (theo thứ tự thi công)

| Task | Story | Mô tả | Điều kiện vào | Nhãn |
|---|---|---|---|---|
| **Task160** | STR116 | Migration **006** schema phòng (mở rộng cloud_project_members) + RLS thật (6 policy + GRANT) | SP023 xong | Chưa đo |
| **Task161** | STR116 | Gin API: invite, join, thu hồi, GET baton, baton/claim, arena-step (**6 endpoint**) | Task160 | Chưa đo |
| **Task162** | STR116 | UI: InviteDialog, JoinRoomPage (`[locale]/join`), nút "Mời" vào stage.tsx | Task161 | Chưa đo |
| **Task168** | STR116 | Arena: ScenarioPicker + StepController (5 kịch bản conflict-sim) | Task162 | Mô phỏng |
| **Task169** | STR116 | Arena: Cytoscape Wait-For Graph + Viewer sync qua Polling (dùng `arena-step` của Task161) | Task168 | Mô phỏng |
| **Task170** | STR116 | Arena: AI Mentor VIP (`/api/ai/inline-complete`, prompt không nhúng SQL workspace) | Task169 | Mô phỏng |
| **Task163** | STR114 | Thêm Yjs/WebRTC dep, Gin WebSocket signaling (`/signal`) + 3 Baton API | Task162 **và** bản sửa rewrite `/api` đã vào `main` | Chưa đo |
| **Task164** | STR114 | Yjs Provider + CodeMirror 6 binding (thêm zustand direct dep) | Task163 | Chưa đo |
| **Task165** | STR114 | UI The Baton: nút Play trong `lab-workspace.tsx:748-759`, toast xin quyền, i18n | Task164 | Chưa đo |
| **Task166** | STR114 | WebRTC DataChannel broadcast kết quả P2P + NAT warning | Task165 | Chưa đo |
| **Task167** | STR115 | Fork to Local Sandbox (5 fork limit, 512KB riêng, gọi lại `forkSnapshot`) | Task164 | Chưa đo |

**Tổng: 11 task** (Task160 → Task170). Arena (Task160-170) đi trước Pair-Programming (Task163-167).

> **Sửa #11 (`Tầng 3 trước` không phản ánh trong bảng F):** bản v1 tuyên bố Tầng 3 đi trước (mục B) nhưng ở bảng F lại để **Task168** và **Task163** cùng gate trên Task162 — tức hai tầng chạy song song, trái với tuyên bố. Nay Task168/169/170 (Tầng 3) đứng trước trong bảng và không có task Tầng 2 nào được mở trước Task170.
>
> **Sửa #10 (vòng phụ thuộc):** bản v1 để STR116 cần STR113 (mục D dòng 51) trong khi STR113 lại cần "Arena vận hành ổn định" (mục E dòng 205) — vòng tròn. Nay cả hai cùng gate trên **Task162**, và STR116 không nhắc gì tới STR113.

> **Điều kiện vào của Task163 ghi rõ:** phụ thuộc bản sửa rewrite `/api` (xem mục "Sửa bắt buộc trước Task163" ở STR114). Nếu bản sửa chưa vào `main`, `/signal` sẽ nhận 404 như cloud hiện nay — không phải lỗi của Task163 mà là điều kiện tiên quyết.

---

## G. Bảng sửa lỗi phản biện DeepSeek

| # | Lỗi | Đã sửa ở | Cách sửa |
|---|---|---|---|
| 1 | Migration số 005 đụng nhau | Task160 | Đổi thành migration **006** |
| 2 | WebSocket 0 dep trong go.mod | Task163 | Ghi rõ phải thêm dep, không ghi "đã có" |
| 3 | Hai phương tiện cho cùng chặng | STR114, Task166 | Chọn dứt khoát WebRTC DataChannel P2P |
| 4 | Core Rule 7 tự tuyên bố đã trả | C2 mục A | Chủ dự án duyệt chính thức 2026-11-23; thêm AC đo 0 byte SQL |
| 5 | Trần Fork 512KB/32KB sai 16× | Task167 | Viết đường kiểm byte riêng, không dùng `encodeSnapshot` |
| 6 | `createTabs()` không tồn tại | Task167 | Dùng `forkSnapshot` hiện có làm nền tảng |
| 7 | zustand không phải direct dep | Task164 | Thêm zustand vào `web/package.json` minh bạch |
| 8 | RLS Task160 chỉ là comment | Task160 | Migration thật có ENABLE, FORCE, policy, RAISE |
| 9 | Policy đệ quy | Task160 | Dùng GUC `app.owned_projects` như 004_cloud_rls.sql |
| 10 | Dựng lại thứ đã có | Task161 | Tái sử dụng `cloud_project_members` + cloud_projects |
| 11 | Nút trong sai file UI | Task162 | Thêm vào `stage.tsx:559-562`, không phải `lab-workspace.tsx` |
| 12 | AC hardcode tên Amelia | Task165 | AC dùng biến, `check:i18n` bắt buộc |
| 13 | Nhãn Thật cho task chưa đo | Mục F | Đổi hết thành "Chưa đo" |
| 14 | SSE trở lại Arena, trả lời sai | Task169 | Dùng Polling cho Arena, không SSE. **Chu kỳ đã chốt 3 s** (D17, xem #20) — 2 s bị loại vì vượt `CloudSync` 25 % |
| 15 | Ba điều kiện vào mâu thuẫn | STR116 | Arena KHÔNG song song STR115; điều kiện: Task162 xong |
| 16 | Baton trong RAM Gin không persist | Task163 | Ghi comment rõ hạn chế; Baton state mất khi Render ngủ/restart |
| 17 | Thiếu Nguyên tắc 6 Task170 | Task170 | AC2: grep prompt, FAIL nếu có SQL của người dùng |
| 18 | AC "0 request" Task167 sai | Task167 | Sửa thành "1 request `/api/me`, 0 request mang SQL" |
| 19 | Không AC kiểm đồng thời | STR113 | AC: 4-browser, 2 editor + 2 viewer cùng lúc |
| 20 | Prereq SP999 cũ | Mục C | Cập nhật: SP999 còn 4 lỗi e2e + Task159 findings |
| 21 | File chưa commit | Mục H | Ghi rõ trạng thái git; sẽ commit sau khi sếp duyệt |

### G2. Mười bốn lỗi kỹ thuật tìm được khi đối chiếu v2 với code thật (2026-11-23)

Bản v2 do một phiên khác viết và bị ngắt giữa chừng. Mười bốn lỗi dưới đây đã được **đối chiếu lại từng dòng với code trong repo** trước khi sửa; mỗi mục ghi rõ bằng chứng.

| # | Lỗi | Bằng chứng trong code | Đã sửa ở | Cách sửa |
|---|---|---|---|---|
| 1 | Task160 RLS chỉ là comment: có `ENABLE`+`FORCE` nhưng **không** `CREATE POLICY`, **không** `GRANT` → AC1/AC2 không thể pass | `api/migrations/003_cloud_projects.sql:353` chỉ GRANT 3 bảng cũ | Task160 | Viết đủ 6 policy + `GRANT` + khối `DO $$` tự `RAISE` nếu thiếu |
| 2 | Task170 gọi `/api/v1/ai/inline-complete` — **route không tồn tại** | `api/internal/ai/ai.go:97,100` chỉ có `/ai/...` và `/api/ai/...`; frontend thật gọi `/api/ai/inline-complete` (`copilot-client.ts:50`) | Task170 | Đổi sang `/api/ai/inline-complete`, thêm AC4 chặn đường sai |
| 3 | Task165 nói "Chỉnh `<RunButton />` hiện có" — **component không tồn tại** | grep toàn `web/src`: 0 kết quả; nút thật là `<Button>` inline ở `lab-workspace.tsx:749-758` | Task165 | Chỉ đúng file: dòng |
| 4 | Task168 AC1 gọi kịch bản "Deadlock 2 chiều" — **không có id này** | `conflict-sim/engine/scenarios.ts:23,34,46,60,74` — id thật là `deadlock_reverse_order` | Task168 | Dùng id thật, thêm AC4 liệt kê đúng 5 id |
| 5 | Task167 đếm fork bằng tag `source: 'room-fork'` — **trường không tồn tại** | `workspace/types.ts:21-29` không có tag/source; `db.ts:4` `CURRENT_DB_VERSION = 1`, không migration | Task167 | **Đã chốt (D20):** thêm trường `roomFork?`, **không bump DB version** (IndexedDB không kiểm schema trường); Redis bị từ chối |
| 6 | Task167 `ForkError('FORK_TOO_LARGE')` — **ngoài union đóng**, không biên dịch được | `share/fork.ts:19` union chỉ có 3 mã | Task167 | Mở rộng union + rà mọi `switch`; AC7 kiểm `tsc --noEmit` |
| 7 | Task162 trỏ `messages/vi.json` / `messages/en.json` — **hai file không tồn tại** | `web/messages/{vi,en}/` có 39 file JSON mỗi ngôn ngữ | Task162 | Trỏ `web/messages/{vi,en}/room.json`, thêm bẫy route `/join` phải trong `[locale]` |
| 8 | Task167 vừa "wrap `forkSnapshot`" vừa định nghĩa đường ghi mới — **hai thiết kế cho một việc** | `share/fork.ts:126` đã có `forkSnapshot(snapshot, scope, options)` | Task167 | Chốt: `room/fork.ts` chỉ lo phần riêng của phòng rồi **gọi** `forkSnapshot` |
| 9 | Task167 AC5 "1 request `/api/me`" đo sai chỗ — request do **người gọi** phát ra, không do fork | `share/fork.ts:109` `resolveWorkspaceScope()` | Task167 | Đo trên toàn bộ luồng bấm Fork |
| 10 | **Vòng phụ thuộc:** STR116 cần STR113, STR113 cần Arena ổn định | mục D dòng 51 so với mục E dòng 205 (v1) | STR116, STR113 | Cả hai cùng gate trên Task162 |
| 11 | "Tầng 3 đi trước" không phản ánh trong bảng F: Task168 và Task163 cùng gate Task162 | mục F v1 | Mục F | Xếp lại thứ tự, Tầng 2 chỉ mở sau Task170 |
| 12 | `arena-step` do Task169 tự phát minh, không có trong danh sách Task161, nhưng bảng F lại ghi Task161 làm ra nó; AC4 đòi ≥6 test cho 5 endpoint | mục F v1 so với Task161 v1 | Task161, Task169, F | `arena-step` vào Task161; AC4 đếm đúng 6 endpoint |
| 13 | C3 nói "thay vì cảnh báo byte" nhưng Task167 vẫn làm cả 512KB lẫn 5 fork, và AC4 vẫn đòi cảnh báo byte | mục A C3 so với Task167 v1 | Mục A C3 | Ghi rõ **hai trần độc lập, cùng hiệu lực** |
| 14 | `GET /baton` bị **cả Task161 và Task163** cùng đăng ký → Gin panic `handlers are already registered` | Task161 v1 dòng 113 + Task163 v1 dòng 245 | Task161, Task163 | Task161 sở hữu; Task163 thêm 3 endpoint khác |

**Đã kiểm là KHÔNG phải lỗi** (đừng "sửa" lại):
- Gin 1.12.0 nhận `POST /join` cạnh `POST /:id/baton/claim` và `GET /:id/signal` — đã dựng thử module tạm, route resolve đúng, không đụng nhau.
- `stage.tsx:559-562` đúng là chỗ có `ShareDialog` + `ExportMenu`.
- Migration 006 trống thật (`api/migrations/` chỉ có 001–005).
- Task164 "thêm zustand direct dep" đúng: `web/package.json` không có `zustand`.

---

## H. Trạng thái Git & Việc cần làm ngay

**Hiện tại:** đã commit lên `main` ngày 2026-11-23 cùng lúc với chủ dự án duyệt v3.
- `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md`
- `_bmad-output/SP024/STR113/README.md`
- `_bmad-output/SP024/STR114/README.md`
- `_bmad-output/SP024/STR115/README.md`
- `_bmad-output/SP024/STR116/README.md`
- `_bmad-output/DE_XUAT_STORY_SP024_TEAM_MULTIPLAYER.md`

**Số STR đã đốt mà không có thư mục:** STR109, STR110, STR111, STR112 (cấp số ở DE_XUAT:75-78 khi Tầng 1 còn được định làm, nay đã NO-GO). **Đã ghi vào `BAN_DO_STORY.md`** ngày 2026-11-23 (D19): mục SP024 ghi rõ STR109-112 "số đã đốt — KHÔNG dùng lại", kèm STR107 bỏ trống và STR108-116 với trạng thái thật.

**Chặn trước khi mở Task163 — lỗi production đang sống:** `web/next.config.ts:35` đặt `rewrites: [{ source: "/api/:path*", destination: \`${apiOrigin()}/:path*\` }]`. Cặp này **cắt tiền tố `/api`** khi chuyển tiếp, nên route cloud `/api/v1/cloud/projects` (Gin đăng ký đúng như vậy ở `cloud_projects.go:79`) tới Gin thành `/v1/cloud/projects` → rơi vào `NoRoute` → **404 `not_found`**. Đồng bộ Cloud **đã hỏng trên production từ Task150**; chủ dự án xác nhận ngày 2026-11-23 là tự tay thử upload lên cloud và không được. Đo thật: `POST https://sqllens-bice.vercel.app/api/v1/cloud/projects` body 60 B → **404**; cùng request gọi thẳng `https://sqllens.onrender.com/api/v1/cloud/projects` → **401 `auth_required`** (route khớp, chỉ thiếu đăng nhập).

> **ĐÃ SỬA ngày 2026-11-23** bằng cách thêm một rule rewrite hẹp **đứng trước** rule chung: `{ source: "/api/v1/cloud/:path*", destination: \`${apiOrigin()}/api/v1/cloud/:path*\` }`. Không đổi rule chung, vì `destination: ${apiOrigin()}/api/:path*` sẽ phá `/api/healthz`, `/api/me`, `/api/ai/*`, `/api/mysql/*`, `/api/auth/*` — các route đó đăng ký **không** có `/api` phía Gin. Đo lại: `GET /api/v1/cloud/projects` → **503 `not_configured`** (trước 404, route đã khớp); `GET /api/healthz` → **200** không đổi; `POST` body 1,5 MB → **503** (trước `413`, tức rơi về trần chung 1 MB); `POST` body 3,5 MB → **413** (trần cloud 3 MB đã áp đúng). `npm run check` exit 0, 1.461 test pass. **Chưa đo trên Vercel thật** và **chưa đo ca upload cloud thành công end-to-end** với Neon thật.

**Khoảng trống phải bịt:** **không có test tự động nào phủ `rewrites`.** Toàn bộ 42 spec `web/e2e/*.spec.ts` mock bằng `page.route`, nên chúng không bao giờ chạm rewrite thật — đó là lý do bug sống sót trên `main` dù e2e xanh. Cần một spec gọi thật qua `next start` + Gin giả, hoặc một test Go khẳng định `r.Routes()` khớp với đường dẫn mà `next.config.ts` giao tới.

**Phát hiện phụ từ spike D17 — số nền Render của Task159 là cận trên không có thật:** `render.yaml` **không** có keep-awake. Cơ chế duy nhất là `.github/workflows/keep-awake.yml`, cron `*/10 0-16 * * *` (07:00–23:50 giờ VN). Nhưng lịch sử chạy thật (`gh run list --workflow keep-awake.yml -L 100`) là **64 lần trong 20,66 ngày = 3,1 lần/ngày**, không phải 144 lần/ngày; 63/63 khoảng cách giữa hai lần đều **vượt 15 phút** (nhỏ nhất 136,7 phút, trung vị 462,6 phút). GitHub Actions dồn và bỏ nhịp cron khi tải cao. Hệ quả: giờ Render thật khoảng **23,25 h/tháng (3,10 % trần)**, không phải 512,5 h (68,33 %) như Task159 tính. Nhãn **Ước lượng** (lịch sử cron là Thật, 15 phút ngủ là giả định). Không đổi kết luận no-go của Task159, nhưng bức tranh ngân sách đổi hẳn: chính Arena là thứ tạo ra mức tiêu thụ đáng kể đầu tiên.

**Hành động tiếp theo — chủ dự án đã duyệt v3 ngày 2026-11-23:**
1. ~~Commit tất cả file SP024 lên `main`~~ — xong ngày 2026-11-23
2. ~~Cập nhật `BAN_DO_STORY.md`: thêm STR108-116 với trạng thái chính xác, ghi STR109-112 đã đốt~~ — xong
3. ~~Cập nhật `SP024/README.md`: phản ánh Tầng 2/3 đã được định nghĩa~~ — xong
4. Phiên agent chính nhận Task160 để bắt đầu thi công
5. **Chặn:** xác nhận bản sửa rewrite `/api` đã vào `main` trước khi mở Task163 — đã sửa và commit, **còn phải đo trên bản deploy Vercel thật**

**Năm câu hỏi D15–D20 đã đóng hết, Task160/Task167/Task169 mở được:**
- **D15, D19 đã chốt ngày 2026-11-23.** D15 = duyệt Zero-Log Transit (ghi có thẩm quyền ở `SP024/README.md`). D19 = ghi 4 số STR109-112 đã đốt vào `BAN_DO_STORY.md` (đã ghi).
- **D16 đã đóng:** dưới kiến trúc WebRTC DataChannel P2P, SQL không đi qua Gin, nên Zero-Log Transit là hàng rào cho phương án dự phòng chứ không phải giấy phép.
- **D18 đã đóng** bằng spike WebSocket ngày 2026-11-23: WebSocket qua `rewrites` của Next 16.4.4 chạy được, mở sau 15 ms so với 11 ms khi gọi thẳng. STR114 giữ nguyên kiến trúc P2P + Gin signaling.
- **D17 đã chốt ngày 2026-11-23: phương án (b), polling chu kỳ 3 giây**, cộng giữ Render thức bằng **cron-job.org** trong cửa sổ 7:00–24:00 giờ Việt Nam thay cho GitHub Actions `keep-awake` (GitHub Actions đo được 3,1 lần/ngày thay vì 144). Poll 3 giây = 100 request/5 phút, dưới trần `CloudSync` 120 khoảng 17 % và dưới limiter 30 request/phút; poll 2 giây vượt trần 25 % nên bị loại. Giữ thức 17 h/ngày tốn khoảng 510 h/tháng = 68 % trần 750 h; giữ 24/7 là 97,3 % nên không chọn. Chi tiết ở "Sửa #20" của Task169.
- **D20 đã chốt ngày 2026-11-23:** đếm 5 phòng fork bằng trường tuỳ chọn `roomFork?: { projectId: string; forkedAt: number }` trong `WorkspaceProject` (IndexedDB), **không bump `CURRENT_DB_VERSION`** (giữ nguyên 1), đếm bằng `listProjects(scope)` rồi `filter`. **Redis bị từ chối** vì đếm trên server là đếm bản sao lệch, phá AC5 của Task167, thêm điểm hỏng mạng, và không nhẹ hơn. Đã kiểm `projectStamp` và payload cloud không bị ảnh hưởng. Xem "Sửa #5" ở Task167.
