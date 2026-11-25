# Task162 — UI Mời cộng tác & Danh sách thành viên

Thuộc: SP024 / STR113
Mục tiêu: chủ phòng tạo được liên kết mời 24 giờ và nhìn thấy danh sách thành viên với vai trò; người nhận liên kết `/join?token=...` vào được phòng và mở đúng dự án trong workspace của mình.
Phạm vi: `web/src/modules/room/` (mới), `web/src/app/[locale]/join/page.tsx` (mới), `web/src/app/[locale]/e2e-room/` (harness Playwright), `web/src/modules/lab/stage/stage.tsx` (một dòng nút cạnh `ShareDialog`), `web/messages/{vi,en}/room.json` (mới), `web/messages/{vi,en}/error.json` (thêm `forbidden`), `web/e2e/room-invite.spec.ts` (mới).
Không làm: không đụng Task163 (`/signal`, đã merge), không làm Baton/Yjs/WebRTC, không đổi Core Rule 7, không gửi byte SQL nào lên server.

## Sai lệch bắt buộc so với bản nháp v3

**D1 — Thêm `GET /api/v1/cloud/projects/:id/members`.** Bản nháp Task162 đòi "danh sách thành viên với vai trò" và AC2 đòi "owner thấy member trong danh sách", nhưng Task161 chỉ có 6 endpoint và **không endpoint nào đọc danh sách thành viên**. Không có dữ liệu thì AC2 không thể đạt bằng bất kỳ UI nào, nên task này thêm đúng một endpoint đọc và một hàm store:

- `store.ListMembers(ctx, userID, projectID) ([]RoomMember, error)` — **`requireReader` TRƯỚC** (người ngoài luôn 404, kể cả khi test chạy bằng role bỏ qua RLS như superuser), **rồi `requireOwner`** (thành viên không phải chủ 403), sau đó đọc chủ dự án từ `cloud_projects JOIN users` và các hàng `cloud_project_members JOIN users`. Thứ tự này bắt buộc: chỉ `requireOwner` thì người ngoài nhận 403 trên môi trường superuser, sai hợp đồng "404 để không lộ tồn tại".
- `GET /api/v1/cloud/projects/:id/members` trả `{ "members": [{ "userId", "name", "avatarUrl", "role" }] }`, chủ dự án đứng đầu với `role: "owner"`; `Cache-Control: no-store`; chỉ log `%T` của lỗi.

**Lý do chỉ chủ dự án đọc được danh sách:** policy SELECT của `cloud_project_members` (migration 004, dòng 86–92) chỉ cho mỗi người thấy hàng của chính mình, cộng với chủ thấy mọi hàng của dự án mình. Thành viên thường gọi endpoint này sẽ nhận 403 thay vì một danh sách thiếu người — trả danh sách cụt là nói dối người dùng. Muốn thành viên thấy đủ danh sách phải sửa policy (migration mới), việc đó ngoài phạm vi task này và được ghi thành phát sinh.

## Hợp đồng

```text
POST /api/v1/cloud/projects/:id/invite   (Task161) → {token, role, expiresAt}
POST /api/v1/cloud/projects/join         (Task161) body {token} → {projectId, role, alreadyMember}
GET  /api/v1/cloud/projects/:id/members  (mới)     → {members: [{userId, name, avatarUrl, role}]}
```

Liên kết mời: `${origin}/${locale}/join?token=<token>`.

## Giao diện

- `<InviteDialog />` — nút "Mời cộng tác" trong `stage.tsx` cạnh `ShareDialog`. Trạng thái: chưa lưu cloud (hướng dẫn lưu trước), đang tải, sẵn sàng (tạo link + copy + danh sách thành viên), không phải chủ (403), lỗi mạng.
- `/[locale]/join?token=...` — chưa đăng nhập thì chuyển `/login?next=...`; đã đăng nhập thì bấm "Tham gia phòng", gọi `POST /join`, tìm dự án local đã liên kết `cloud.remoteId` tương ứng, nếu chưa có thì `pullProject`, ghi dấu `markPendingProject` rồi tải lại workspace. Lỗi 410/404/403/mạng/lưu máy có câu riêng.
- Mọi chuỗi qua `room.json` (vi + en), không hardcode.

## Tiêu chí xong

- AC1: `npm run check:i18n` PASS — mọi chuỗi mới có bản vi + en.
- AC2: Playwright `web/e2e/room-invite.spec.ts`: chủ mở InviteDialog → thấy thành viên → tạo link → copy; người nhận mở link → `/join` → bấm tham gia → chuyển về workspace và dự án được kéo về; chủ thấy thành viên mới trong danh sách (mock API, Chrome thật).
- AC3: `npm run check` PASS; 390px không tràn ngang.
- AC4: `go test -p 1 ./internal/httpapi -run Room` PASS, gồm `GET /members` (chủ 200 có đủ người, thành viên 403, người ngoài 404, id sai 400).
- AC5: 0 byte SQL rời máy — mọi request của module room chỉ mang token/id, không mang nội dung tab (kiểm bằng test unit đọc payload).

## Ca biên

- Dự án local chưa có `cloud.remoteId`: dialog không gọi mạng, hiện hướng dẫn lưu lên cloud.
- Người nhận đã là thành viên: `alreadyMember=true`, vẫn mở được dự án (không nhân bản dự án local).
- Người nhận đã có dự án local gắn `cloud.remoteId` đó: mở lại dự án cũ, không `pullProject`.
- Token rỗng, token hết hạn (410), token bịa (404), phiên hết hạn (401), mất mạng, IndexedDB bị chặn: mỗi ca một câu, có nút thử lại.
- Link mời được tạo lại nhiều lần: mỗi lần một token mới, link cũ vẫn dùng được tới hạn (hành vi Task161).

## Kiểm tra

```bash
cd api && go test -p 1 ./internal/httpapi -run Room -count=1
cd web && npm run check
cd web && npm run build && npx playwright test e2e/room-invite.spec.ts
```

## Góc review thêm

- Bảo mật: endpoint members chỉ chủ dự án; không log token/tên; không trả hàng vé mời; không lộ dự án của người khác (404).
- Nhãn: Task này **Chưa đo** — không được ghi "Thật" cho luồng nhiều người cho tới khi có số đo trên bản deploy.
- Giao diện: đủ vi/en, 390px, trạng thái rỗng/lỗi.

## Review Findings (vòng 2 — bmad-code-review, 24/11/2026)

Tám phát hiện dưới đây **đã sửa hết ngày 25/11/2026**, kèm test khóa hành vi; bảng “Vòng sửa 2” ở `ban_giao_task162.md` ghi cách sửa và bằng chứng từng dòng.

- [x] [Review][Patch] Chủ tự mở link mời của mình sinh hàng thành viên trùng — `store.ListMembers` ghép thêm hàng `cloud_project_members` của chính chủ, nên danh sách có chủ hai lần (một `owner` dựng từ `cloud_projects.owner_id`, một `editor` từ bảng thành viên), React trùng `key`, và `RemoveMember` không xoá được hàng đó (`ErrOwnerCannotLeave`). [api/internal/store/live_rooms.go:296-300]
- [x] [Review][Patch] Link mời cũ/hết hạn chặn việc tạo link mới — `invite` không bị xoá khi đóng hộp thoại và nút "Tạo liên kết mời" bị thay bằng ô link, nên sau 24 giờ giao diện vẫn chỉ có link chết cho tới khi tải lại trang. [web/src/modules/room/components/invite-dialog.tsx:145-160]
- [x] [Review][Patch] Màn hình "đã tham gia" thành ngõ cụt khi điều hướng bị chặn — `window.location.assign` nằm trong `try` rỗng, nhánh `phase === "done"` chỉ có spinner + chữ, không nút/link nào để mở workspace bằng tay. [web/src/modules/room/join-room-page.tsx:99-110]
- [x] [Review][Patch] Hộp thoại mời có thể nhắm dự án không phải dự án đang xem — `projects.find(...) ?? projects[0]` rơi về dự án đầu tiên khi `activeProjectId` không khớp. [web/src/modules/room/components/invite-dialog.tsx:63]
- [x] [Review][Patch] AC5 không được kiểm thật — test "request của module room không mang nội dung SQL" chỉ soi `createInvite` (body `undefined`) nên xanh kể cả khi `joinRoom` gửi cả nội dung tab. [web/src/modules/room/api.test.ts:74-80]
- [x] [Review][Patch] Ca `status === "unavailable"` (E5) không có test nào — chỉ có suy luận khi đọc code. [web/src/modules/room/join-room-page.tsx:117]
- [x] [Review][Patch] Ca đóng hộp thoại khi `POST /invite` còn bay (A8) không có test — bỏ `createSeq` vẫn xanh. [web/src/modules/room/components/invite-dialog.test.tsx]
- [x] [Review][Patch] Nhánh người chưa đăng nhập (A2: nút Đăng nhập + Về trang chủ) không test nào chạm tới — E2E điều hướng đi ngay nên không thấy khối này. [web/e2e/room-invite.spec.ts]

Góc đã đối chứng là **không có lỗi** (bị loại): `send()` không có timeout (sửa phải thêm plumbing abort — chưa đáng), danh sách thành viên không phân trang (quy mô phòng mời theo link), `aria-label` trên nút mời trùng đúng chuỗi hiển thị, `canRetry` vẫn hiện cho 401/403 (mất nhiều nhất một cú bấm), `copyTimer` không dọn khi đóng (chỉ đặt lại state của hộp thoại đã đóng; đã dọn khi unmount).

## Đọc thêm

- `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md` §Task162
- `_bmad-output/SP024/STR116/Task161/ban_giao_task161.md`
- `web/src/modules/share/components/share-dialog.tsx` (khuôn dialog), `web/src/modules/cloud/sync.ts` (`pullProject`)

### Review Findings (vòng 3 — bmad-code-review, 25/11/2026)

Nguồn diff: thay đổi chưa commit trên `main` @ `87b2bd0`, phạm vi `api/` + `web/` (21 file, 2.344 dòng). `review_mode = full` (spec: file này). Bốn tầng: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor — chạy tuần tự trong cùng một phiên (phiên này không có công cụ subagent), nên **các tầng không độc lập về tiến trình**.

**Decision-needed**

- [x] [Review][Decision] Hạn vé mời tính bằng đồng hồ client tại một mốc chốt lúc mở hộp thoại — `invite-dialog.tsx:94` so `Date.parse(expiresAt)` với `nowMs` (đặt một lần trong `change(true)`). Hai hệ quả thật: (a) vé hết hạn **trong lúc hộp thoại đang mở** vẫn hiện như còn sống và không có nút tạo lại, vì nhánh `link` chiếm chỗ — chú thích trong code nói “lúc đó bấm tạo lại vẫn được” là sai, phải đóng rồi mở lại mới thấy nút; người dùng copy một link đã chết và người nhận mới biết. (b) Máy người dùng lệch đồng hồ quá 24 giờ thì vé **vừa tạo** bị coi là hết hạn ngay: không hiện link để copy, tạo lại cũng vậy → không mời được ai. Cần chọn: (1) cho mốc thời gian chạy và hiện thêm nút “Tạo liên kết mới” cạnh link khi hết hạn; (2) bỏ phán đoán phía client, chỉ tin 410 của server khi có người bấm vào link; (3) giữ nguyên nhưng thêm dung sai (ví dụ bỏ qua vé còn hạn theo server).
- [x] [Review][Decision] Đã là thành viên nhưng kéo dự án hỏng vẫn báo “Không tham gia được phòng” — `join-room-page.tsx:84-96`: `joinRoom` thành công (đã ghi hàng thành viên trên server) rồi `ensureJoinedProject` lỗi → nhánh `catch` đặt `storage`/`network`, hiện “Không tham gia được phòng. Hãy thử lại.”/“Trình duyệt không cho lưu phòng…”. Người dùng đọc thành “chưa vào phòng”, tưởng link hỏng, trong khi việc duy nhất còn sai là bản sao trên máy. Cần chọn: câu riêng “đã vào phòng nhưng chưa mở được trên máy này” + nút “Mở workspace” (thêm 2 chuỗi vi/en) hay giữ nguyên và chỉ sửa chú thích.

**Patch**

- [x] [Review][Patch] Chưa có test nào chứng minh `ListMembers` đọc được mọi hàng thành viên dưới RLS [api/internal/store/live_rooms.go:265] — Test duy nhất (`TestRoomListMembers`, env `T150_DATABASE_URL`) chạy bằng role **superuser**, mà superuser bỏ qua cả policy lẫn FORCE. Policy `cloud_project_members_select` (004) cho chủ đọc mọi hàng chỉ nhờ nhánh `app.owned_projects`; nếu `WithTenant` không đặt GUC đó (hoặc policy đổi), chủ trên Neon chỉ thấy hàng của chính mình và **test vẫn xanh 100%**. Đúng họ lỗi `COPY FROM` của Task150 mà `AGENTS.md` đã ghi thành bài học. Cần `TestListMembersUnderRLS` dựng bằng `newRLSEnv` (role `sqllens_app`) trong `api/internal/store`: chủ thấy 2 hàng, thành viên thường gọi `ListMembers` phải nhận `ErrNotOwner`.
- [x] [Review][Patch] AC3 “390px không tràn ngang” mới đo hộp thoại, chưa đo trang `/join` [web/e2e/room-invite.spec.ts:151] — kịch bản hiện có mở `e2e-room` rồi đo hộp thoại; trang `/join` (tiêu đề dài, `Alert` câu dài, hai nút cạnh nhau, màn “đã tham gia”) chưa từng được đo ở 390px trong khi AC3 nói về cả task.
- [x] [Review][Patch] Lỗi đọc IndexedDB khi tìm dự án không được bọc, người dùng nhận câu sai [web/src/modules/room/join.ts:88] — `openDb` và `pullProject` đã dịch lỗi thành `CloudSyncError`, nhưng `getRepository(db).listProjects(scope)` thì không. Chú thích cuối file khẳng định “Lỗi lưu máy luôn đi qua `CloudSyncError`” — sai với dòng 88. Khi lần đọc đó ném (DB bị nâng version ở tab khác, transaction hỏng), `classifyJoinError` trả `failed` → “Không tham gia được phòng. Hãy thử lại.” thay vì `storage` → “tắt chế độ ẩn danh”, nên người dùng bấm Thử lại mãi.
- [x] [Review][Patch] Test F2 chưa chứng minh bấm “Tạo liên kết mời” lại thì được vé mới [web/src/modules/room/components/invite-dialog.test.tsx:174] — stub trả `expiresAt: "2020-01-01"` cho **mọi** lần `POST /invite`, nên test chỉ khẳng định được nút tạo còn hiện, không khẳng định được điều mà ban_giao tuyên bố (“vẫn tạo được liên kết mới”): bấm lần hai vẫn ra câu hết hạn. Cần stub trả vé hết hạn cho lần đầu, vé còn hạn cho lần hai, rồi đòi `room-invite-link` xuất hiện.
- [x] [Review][Patch] Thông điệp lỗi trong `api.ts` hardcode tiếng Việt [web/src/modules/room/api.ts:74] — bốn chuỗi (“Máy chủ từ chối yêu cầu phòng (…)”, “Máy chủ trả về vé mời/kết quả gia nhập/danh sách thành viên không hợp lệ”, dòng 74/105/119/139) nằm ngoài `room.json`, trái yêu cầu “mọi chuỗi qua room.json”. Hiện chưa lộ ra giao diện (UI dịch theo `kind`), nhưng `RoomApiError.message` là thứ tự nhiên để một caller sau này hiển thị, và người dùng `en` sẽ nhận câu tiếng Việt.

**Rejected**

- `low` — `ListMembers` tốn 4 round trip mỗi lần mở hộp thoại (`requireReader` + `requireOwner` + chủ + thành viên). Gộp truy vấn là việc nặng hơn một sửa trực tiếp, và mở hộp thoại không phải đường nóng.
- `low` — Dự án scope `guest` đã gắn cùng `remoteId` vẫn bị nhân bản khi join bằng scope `user` (`join.ts:88`): `pushProject` cần đăng nhập nên dự án guest thực tế không có `cloud.remoteId`; không dựng được đường tới lỗi này trong code hiện tại.
- `low` — `alreadyMember=true` không có test tích hợp: code bỏ qua cờ đó và hành vi “không nhân bản” đã được `join.test.ts` chứng minh qua nhánh “đã có dự án local cùng remoteId”.
- `low` — Không test nào khẳng định `InviteDialog` thật sự có mặt trong `stage.tsx`; đây là một dòng import + render, `tsc`/`next build` phủ, còn linh kiện có E2E riêng.
- `low` — Người đăng nhập sai tài khoản gặp 403 chỉ có “Thử lại” và “Về trang chủ”, không có đường đổi tài khoản: đổi tài khoản cần luồng đăng xuất của Task129, ngoài phạm vi task này.
- `low` — Trang `/join` không cho xem tên phòng trước khi tham gia: cần đổi hợp đồng `POST /join` hoặc thêm endpoint, ngoài phạm vi.
- `low` — Danh sách thành viên không phân trang: phòng hiện không có trần thành viên, nhưng sửa là thêm phân trang, không phải sửa trực tiếp.
- `low` — `TestRoomListMembers` không chứng minh thứ tự tất định (mới 2 phần tử): thêm ca trùng tên là việc nhỏ nhưng không phải khiếm khuyết của code.
