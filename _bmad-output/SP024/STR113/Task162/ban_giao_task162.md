# Bàn giao Task162 — UI Mời cộng tác & Danh sách thành viên

Đã làm: nút **Mời cộng tác** trong `stage.tsx` mở `InviteDialog` — tạo liên kết mời 24 giờ (`POST /invite`), sao chép link, và hiện danh sách thành viên kèm vai trò (chủ phòng đứng đầu). Trang `/[locale]/join?token=...` nhận liên kết: chưa đăng nhập thì chuyển `/login?next=...`, đã đăng nhập thì bấm **Tham gia phòng** → `POST /join` → tìm dự án local đã gắn `cloud.remoteId`, chưa có thì `pullProject` kéo về IndexedDB → ghi dấu `markPendingProject` → tải lại workspace, mở đúng phòng. Project chưa lưu cloud hiện hướng dẫn lưu trước, không gọi endpoint nào. Lỗi hết hạn (410), link sai/phòng đã xoá (404), không có quyền (403), chưa đăng nhập (401), mất mạng, IndexedDB bị chặn đều có câu riêng và nút thử lại (trừ hai ca không cứu được bằng thử lại). `error.forbidden` đã thêm vi/en đúng như Task161 ghi nợ. 0 byte SQL rời máy: request của module chỉ mang token/id.

File chính: `web/src/modules/room/{api.ts,join.ts,join-room-page.tsx,components/invite-dialog.tsx}`, `web/src/app/[locale]/join/page.tsx`, `web/messages/{vi,en}/room.json`, `web/src/modules/lab/stage/stage.tsx` (một dòng nút), `api/internal/store/live_rooms.go` (`ListMembers`), `api/internal/httpapi/live_rooms.go` (`GET /:id/members`), `api/internal/httpapi/live_rooms_test.go`, `web/e2e/room-invite.spec.ts`, `web/src/app/[locale]/e2e-room/` (harness Playwright).

Kết quả kiểm tra (chạy thật):
- `cd web && npm run check` → **PASS 1500 test (18 skip), 124 file** (typecheck + eslint + check:i18n + vitest). Sau vòng sửa review: **1508 test**.
- `cd web && npm run build` (API_ORIGIN giả) → PASS, có route `/vi/join`, `/en/join`, `/vi/e2e-room`.
- `npx playwright test e2e/room-invite.spec.ts` (Chromium thật) → **3/3 PASS** (sau vòng sửa: **6/6**): AC2 hai trình duyệt (chủ tạo link → copy đọc lại từ clipboard → người nhận vào `/join` → về `/vi` và thấy tab `01_hello.sql` của phòng; chủ mở lại hộp thoại thấy Bình vai trò Biên tập), link hết hạn, 390px `scrollWidth - clientWidth = 0`.
- `cd api && T150_DATABASE_URL=postgres://postgres:t152@localhost:54495/app161 go test -p 1 ./internal/httpapi -run Room -count=1` → **ok 19,0 s**, gồm `TestRoomListMembers` (chủ 200 đúng 2 người, thành viên 403, người ngoài 404, id sai 400, `Cache-Control: no-store`, `avatarUrl` null).
- `cd api && T150_DATABASE_URL=…54495/app161 T149_DATABASE_URL=…54492/app160 RLS_TEST_DSN=… go test -p 1 ./... -count=1` → **8/8 package ok** (httpapi 25,5 s, store 26,4 s).
- Đột biến tự chạy: bỏ `requireOwner` trong `ListMembers` → `TestRoomListMembers` đỏ ngay ("thành viên GET /members = 200 … mong đợi 403"), đã khôi phục bằng `cp` từ bản sao.

Sai lệch so với bản nháp v3 (**D1**, ghi trong `task162.md`): bản nháp đòi danh sách thành viên nhưng Task161 không có endpoint nào đọc danh sách, nên AC2 bất khả thi. Đã thêm `GET /api/v1/cloud/projects/:id/members` + `store.ListMembers`. Endpoint **chỉ chủ dự án** đọc được: policy SELECT của `cloud_project_members` (migration 004) chỉ cho mỗi người thấy hàng của mình, nên thành viên thường nhận 403 thay vì một danh sách cụt (nói dối người dùng). Trong lúc test phát hiện `requireOwner` một mình trả 403 cho người ngoài khi chạy bằng superuser (RLS bị bỏ qua) — đã thêm `requireReader` trước để người ngoài luôn nhận 404, đúng hợp đồng.

Chưa làm được: chưa đo trên bản deploy Vercel/Render thật (mới chạy local + mock API trong E2E). Nhãn của task vẫn là **Chưa đo**.

Phát sinh cần đưa vào SP999: (1) thành viên không phải chủ **không thấy** danh sách thành viên vì policy SELECT của `cloud_project_members` chỉ trả hàng của chính họ; muốn mở phải thêm policy/migration mới (không đọc chéo `cloud_projects` để tránh đệ quy) — hiện UI nói thẳng "chỉ chủ dự án xem được". (2) Route `/join` nằm ngoài `bare-routes` nên vẫn có khung app đầy đủ; nếu muốn trang gọn như `/share` thì phải xét thêm `AuthProvider` cho mọi route bare (bài học Task145). (3) `InviteDialog` gọi `POST /invite` mỗi lần bấm, không dọn vé cũ; vé sống 24 giờ và không có endpoint thu hồi — chấp nhận được ở quy mô hiện tại nhưng cần dọn định kỳ nếu phòng đông.

Việc tiếp theo cần biết: endpoint `GET /:id/members` là hợp đồng mới cho Task163/STR113 (UI danh sách member trong Lab) — dùng lại, đừng đăng ký lần hai. Nút "Mời cộng tác" chỉ hoạt động với dự án đã có `project.cloud.remoteId`; luồng "tạo phòng" hiện là "lưu dự án lên cloud" ở `CloudPanel`, không có nút tạo phòng riêng.

## Review độc lập (bmad-review, 24/11/2026) — 21 phát hiện, **ĐÃ SỬA HẾT** (xem mục “Vòng sửa” cuối bảng)

Review ba lớp (Adversarial 12, Edge-Case 5, Verification-Gap 4) trên diff chưa commit.

| # | Vị trí | Lỗi | Vì sao đáng sửa |
|---|---|---|---|
| A1 | `invite-dialog.tsx:65,101-108,121` | `link`/`expiresAt` không xoá khi `cloudId` đổi | Đổi dự án rồi mở lại: vẫn thấy link mời của dự án **cũ** và không có nút tạo link mới (nút bị thay bằng link cũ) → chủ gửi nhầm phòng. |
| A2 | `join-room-page.tsx:51-54` | Nhánh `anon` chỉ `router.replace`, không có nút đăng nhập dự phòng | Nếu điều hướng client hỏng, trang chỉ có tiêu đề, không thao tác được. |
| A3 | `invite-dialog.tsx:86-96,119-127` | 401 (khách chưa đăng nhập) rơi vào câu "Không tải được thông tin phòng" | Nút Mời hiện cả trong Lab của khách; khách tưởng phòng hỏng thay vì được mời đăng nhập. |
| A4 | `join.ts:104-115` | `joinAndOpen` được export nhưng **không nơi nào gọi** | Code chết; ý định bọc lỗi IndexedDB thành `storage` không bao giờ chạy. |
| A5 | ~~`join-room-page.tsx:71` + `join.ts:92`~~ | **ĐỐI CHỨNG LẠI: phát hiện này SAI.** `openDb` đã bọc mọi lỗi mở IndexedDB thành `CloudSyncError("STORAGE_UNAVAILABLE")`, nên `classifyJoinError` vốn đã trả `storage`; tuyên bố cũ "IndexedDB bị chặn có câu riêng" trong bàn giao là ĐÚNG | Không có lỗi để sửa. Đã thêm test `ensureJoinedProject ... là lỗi lưu máy` để khóa hành vi (chạy thật: xanh). |
| A6 | `next.config.ts:19-32` | `/join?token=...` thiếu `Referrer-Policy: no-referrer` | Token bearer 24 giờ rò sang bên thứ ba qua `Referer` nếu có tài nguyên ngoài; `/share` đã xử lý đúng vì lý do y hệt. |
| A7 | `invite-dialog.tsx:130-141` | Copy hỏng thì im lặng; nếu `inputRef` null vẫn báo "Đã sao chép" | Người dùng tưởng đã copy và dán thứ khác. |
| A8 | `invite-dialog.tsx:101-108,113-127` | Đóng hộp thoại khi `POST /invite` đang chạy không huỷ request | Vé tạo ngầm, lần mở sau link xuất hiện bất ngờ; bấm lại sinh thêm vé. |
| A9 | `invite-dialog.tsx:24-45,213-240` | `avatarUrl` lấy về và khai báo kiểu nhưng không render | Hợp đồng thừa, người sau tưởng UI đã có avatar. |
| A10 | `invite-dialog.tsx` (nút sao chép) | "Đã sao chép" không `aria-live`, icon không `aria-hidden` | Trình đọc màn hình không biết copy xong. |
| A11 | `task162.md:12` | Tài liệu ghi "`requireOwner` trước"; code chạy `requireReader` **rồi** `requireOwner` | Người sau xoá `requireReader` theo tài liệu thì người ngoài lại nhận 403 và test superuser đỏ. |
| A12 | `api/internal/httpapi/live_rooms.go:65-67` | Chú thích nói `error.forbidden` "chưa có trong messages" | Task162 đã thêm chuỗi; chú thích còn treo ở thì tương lai. |
| E1 | `join-room-page.tsx:56-77` | `join()` không có khoá "đang tham gia" | Hai lần gọi chồng nhau → hai `pullProject` song song → hai bản sao phòng trong IndexedDB. |
| E2 | `join-room-page.tsx:70-77` | `markPendingProject`/`location.assign` ném sau khi đã join + pull xong | Báo "Không tham gia được phòng" trong khi đã vào phòng; bấm lại vô ích. |
| E3 | `invite-dialog.tsx:121` | `create` về muộn sau khi `cloudId` đã đổi | Link dự án cũ ghi vào trạng thái dự án mới (cùng gốc A1, khác đường tới). |
| E4 | `api.ts:139-152` | Server trả `role` lạ thì hàng bị bỏ **im lặng** | Nếu chủ mang role mới, danh sách trông như phòng không có chủ. |
| E5 | `join-room-page.tsx:56` | `status === "unavailable"` vẫn cho nút "Đăng nhập" thay vì câu máy chủ không phản hồi | Vòng lặp đăng nhập không lối ra. |
| V1 | `join.ts:84-99` | Không test nhánh "đã có dự án local cùng `remoteId` → mở lại, không pull" | Đổi sang so tên hoặc bỏ nhánh vẫn xanh → người dùng nhận hai bản sao phòng. |
| V2 | `join-room-page.tsx:51-54` | Không test người chưa đăng nhập mở `/join?token=` → `/login?next=<đúng URL kèm token>` (và ca thiếu token) | Mất `encodeURIComponent` hoặc mất `token` trong `next` cũng không test nào đỏ. |
| V3 | `invite-dialog.tsx:65` | Không test đổi dự án rồi mở lại hộp thoại | Lỗi A1 không thể bị bắt. |
| V4 | `live_rooms_test.go:414-500` | `GET /members` không được kiểm **sau khi xoá** thành viên | Query join sai khiến người đã bị xoá vẫn hiện, test vẫn xanh. |

Hai chỗ trùng gốc giữa các lớp: A1↔E3 (lỗi hành vi) và A4↔V1 (thiếu kiểm chứng) — giữ cả hai vì một bên là lỗi, một bên là lỗ hổng test.

Điểm đã đúng, giữ nguyên khi sửa: `requireReader` trước `requireOwner` (người ngoài 404 cả khi test chạy superuser), câu 403 "chỉ chủ dự án" thay vì trả danh sách cụt, phân biệt 410/404, và harness `/e2e-room` đã nằm trong nhóm bị middleware chặn ở production.

## Vòng sửa (24/11/2026) — đã sửa và đo lại

| # | Cách sửa | Bằng chứng |
|---|---|---|
| A1, E3 | Vé đổi thành `{ cloudId, url, expiresAt }`; link chỉ hiện khi `invite.cloudId === cloudId` hiện tại | 2 test mới: đổi sang dự án chưa lưu cloud → thấy hướng dẫn lưu, không còn link cũ; đổi sang dự án đã lưu cloud → có lại nút tạo |
| A2 | Nhánh `anon` render thêm nút **Đăng nhập** + **Về trang chủ** dưới thông báo (điều hướng tự động vẫn giữ) | E2E “chưa đăng nhập mở link mời” |
| A3 | `MembersState`/`CreateError` có thêm `auth` cho 401, câu `room.invite.authRequired` vi/en | test “401: hộp thoại mời đăng nhập thay vì báo phòng hỏng” |
| A4 | Xoá `joinAndOpen` (code chết); lý do `storage` ghi thành chú thích ở `classifyJoinError` | grep: không còn tham chiếu; `tsc` PASS |
| A5 | Không sửa code (phát hiện sai — xem bảng trên), thêm test khóa hành vi thật | `join.test.ts` ca “IndexedDB bị chặn là lỗi lưu máy” |
| A6 | `next.config.ts` thêm `Referrer-Policy: no-referrer` cho `/:locale(vi\|en)/join` | E2E đọc header tài liệu `/vi/join?token=…` = `no-referrer` |
| A7 | `copyState: idle→copied\|failed`; clipboard hỏng thì chọn sẵn link **và** hiện `copyFailed` (vi/en), không còn báo “Đã sao chép” khống | test “clipboard bị chặn…” (kiểm cả focus + vùng chọn) |
| A8 | `createSeq` tăng mỗi lần đóng hộp thoại/tạo lại; kết quả request cũ về muộn bị bỏ, `creating` được nhả khi đóng | `change(false)` + nhánh `seq !== createSeq.current` |
| A9 | Bỏ `avatarUrl` khỏi `RoomMember` (server vẫn trả, client không giữ trường không dùng) | `api.test.ts` cập nhật |
| A10 | Nhãn nút sao chép có `role="status" aria-live="polite"`; icon `aria-hidden` | jsdom không kiểm được trình đọc màn hình, chỉ kiểm DOM |
| A11 | `task162.md:12` ghi đúng `requireReader` TRƯỚC rồi `requireOwner`, kèm lý do superuser | — |
| A12 | Chú thích `failRoom` viết lại: `error.forbidden` đã có bản vi/en | — |
| E1 | Khoá theo `useRef` (`joining`) chứ không theo state, nên hai cú bấm sát nhau chỉ chạy một lần | đọc code + E2E join vẫn xanh |
| E2 | `markPendingProject` và `location.assign` nằm trong `try` riêng sau `setStep("done")`: hỏng thì vẫn báo “đã tham gia” | — |
| E4 | `RoomMemberRole = RoomRole \| "unknown"`; hàng role lạ vẫn hiện với nhãn `role.unknown` (vi “Thành viên” / en “Member”) | test “vai trò lạ vẫn hiện thành viên” |
| E5 | Nút **Đăng nhập** chỉ hiện khi có người dùng; `unavailable` chỉ có **Thử lại** khi `user` tồn tại | đọc code |
| V1 | `join.test.ts`: ca “đã có dự án local cùng remoteId: mở lại, không kéo thêm bản sao” (+ ca trùng tên khác id vẫn kéo) | **đột biến tự chạy**: đổi `p.cloud?.remoteId === remoteId` thành `false` → ca này ĐỎ, khôi phục xong xanh |
| V2 | E2E “chưa đăng nhập mở link mời: sang /login với next giữ nguyên token” + “link thiếu token: khoá nút tham gia” | 6/6 E2E PASS |
| V3 | 2 test đổi dự án trong `invite-dialog.test.tsx` | 8/8 test file PASS |
| V4 | `TestRoomListMembers` thêm bước `DELETE /members/:uid` rồi đọc lại, đòi còn đúng chủ | `go test -run Room` PASS |

Kiểm tra lại sau khi sửa (chạy thật, 24/11/2026): `npm run check` **PASS 1508 test (18 skip), 124 file**; `next build` PASS; `npx playwright test e2e/room-invite.spec.ts` **6/6 PASS** (thêm 3 kịch bản mới); `go test -p 1 ./...` **8/8 package ok** với PostgreSQL 18 thật (`t161-pg`/`t160-pg`). Docker đã tắt sau khi chạy.

## Vòng sửa 2 (25/11/2026) — 8 phát hiện của review vòng 2, đã sửa hết

Review vòng 2 (`bmad-code-review`) để lại 8 phát hiện chưa sửa trong `task162.md`. Đối chứng lại từng dòng trên code hiện tại: cả 8 đều còn thật.

| # | Cách sửa | Bằng chứng |
|---|---|---|
| F1 | `store.ListMembers` bỏ hàng `cloud_project_members` trùng `owner_id`. Chủ tự mở link mời của mình trước đây hiện hai lần (một `owner` dựng từ `cloud_projects`, một `editor` từ bảng thành viên), React trùng `key`, và hàng đó không xoá được vì `RemoveMember` chặn chủ rời phòng | `TestRoomListMembers` thêm bước chủ join bằng link của chính mình rồi đòi chủ xuất hiện **đúng một lần**, vẫn đủ 2 người. **Đột biến tự chạy:** bỏ dòng lọc → test đỏ (“hàng của chủ mang vai trò "editor"”), khôi phục xong xanh |
| F2 | Vé quá `expiresAt` không còn chiếm chỗ nút tạo: mốc “bây giờ” chốt lúc mở hộp thoại (`nowMs`, không đọc `Date.now()` khi render — lint `react-hooks/purity` chặn), vé hết hạn hiện câu `room.invite.linkExpired` và nút **Tạo liên kết mời** | test “liên kết đã hết hạn: báo rõ và vẫn tạo được liên kết mới” |
| F3 | Nhánh `phase === "done"` có thêm link **Mở workspace** (`room.join.openWorkspace`) bên dưới spinner, để điều hướng bị chặn không thành ngõ cụt | test “đã tham gia xong: có đường mở workspace…” |
| F4 | Bỏ hẳn `?? projects[0]`: hộp thoại chỉ nhắm dự án có `id === activeProjectId`, không khớp thì hiện “chưa lưu cloud” và **không gọi endpoint nào** | test “activeProjectId không khớp dự án nào: không mời nhầm dự án đầu tiên” |
| F5 | AC5 kiểm cả **ba** lời gọi (`createInvite`, `joinRoom`, `listMembers`) chứ không chỉ hàm có body `undefined` | `api.test.ts` đòi 3 request và không chuỗi nào khớp `SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP` (phân biệt hoa/thường vì đường dẫn có chữ “join”) |
| F6 | Ca `status === "unavailable"` có test riêng: câu “Không kết nối được máy chủ”, **không** có nút Đăng nhập, **không** có Thử lại | `join-room-page.test.tsx` |
| F7 | Ca đóng hộp thoại khi `POST /invite` còn bay có test thật: fetch treo, bấm Đóng, giải phóng response muộn → không có link, mở lại vẫn thấy nút tạo | `invite-dialog.test.tsx` (dùng `act` + promise treo) |
| F8 | Nhánh chưa đăng nhập có test chạm tới khối dự phòng: `room-join-signed-out`, nút **Đăng nhập**, link **Về trang chủ** (`href="/"`), và `router.replace` gọi `/vi/login?next=…` | `join-room-page.test.tsx` |

Thay đổi file: `api/internal/store/live_rooms.go`, `api/internal/httpapi/live_rooms_test.go`, `web/src/modules/room/components/invite-dialog.tsx`, `web/src/modules/room/join-room-page.tsx`, `web/src/modules/room/join-room-page.test.tsx` (mới), `web/src/modules/room/api.test.ts`, `web/src/modules/room/components/invite-dialog.test.tsx`, `web/messages/{vi,en}/room.json` (+`invite.linkExpired`, `join.openWorkspace`).

Kiểm tra lại sau vòng 2 (chạy thật, 25/11/2026):

- `cd web && npm run check` → **PASS 1514 test (18 skip), 127 file** (trước vòng 2: 1508).
- `cd web && API_ORIGIN=http://127.0.0.1:8080 npm run build` → PASS.
- `npx playwright test e2e/room-invite.spec.ts` (Chromium thật) → **6/6 PASS**.
- `cd api && T149_DATABASE_URL=…54492/app160 T150_DATABASE_URL=…54495/app161 RLS_TEST_DSN=…54495/app161 go test -p 1 ./... -count=1` (PostgreSQL 18 thật) → **8/8 package ok**.
- Đột biến F1 chạy thật (bỏ dòng lọc chủ) → test đỏ, đã khôi phục.

Còn lại: **chưa gọi reviewer độc lập vòng 3**, chưa merge, chưa đo trên bản deploy. Nhãn task vẫn là **Chưa đo**.
