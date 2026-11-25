# SP024: Live Rooms — Phòng cộng tác nhiều người

Trạng thái: **MỞ, chỉ Tầng 0**. Chủ dự án chốt ngày 2026-11-22: làm song song với SP013 và SP999, đo trước rồi mới xây.

## Vì sao Epic này tồn tại

Chủ dự án đề xuất biến SQLLens thành nền tảng cộng tác nhóm. Văn kiện gốc ở `_bmad-output/Y_TUONG_TEAM_MULTIPLAYER_COLLABORATION.md`. Bản phản biện và đề xuất story ở `_bmad-output/DE_XUAT_STORY_SP024_TEAM_MULTIPLAYER.md`.

Văn kiện gốc không có một số đo nào, nên Epic này **không** bắt đầu bằng code. Nó bắt đầu bằng một cổng đo.

## Quyết định của chủ dự án ngày 2026-11-22

| # | Câu hỏi | Chủ dự án trả lời |
|---|---|---|
| 1 | SQL rời khỏi trình duyệt (Core Rule 7) | **Ghi nợ.** Chưa quyết. Không được tự đổi Core Rule 7. Đây là cổng chặn mọi story có gửi SQL qua mạng. **Đã trả nợ ngày 2026-11-23 — xem mục dưới.** |

## Quyết định của chủ dự án ngày 2026-11-23: trả nợ Core Rule 7

Chủ dự án chốt **duyệt Zero-Log Transit** cho Tầng 2/3 của SP024. Nội dung duyệt:

- SQL của người dùng **được phép** đi qua RAM của Gin. Đây là ngoại lệ có điều kiện, không phải bãi bỏ Core Rule 7.
- Điều kiện bắt buộc, mỗi task liên quan phải có AC chứng minh bằng số đo:
  1. **0 byte SQL vào Neon** — không cột, không log, không bảng nào ở Neon chứa văn bản SQL của người dùng.
  2. **0 dòng log SQL ra file/stdout** — Gin chỉ được log loại lỗi (`%T`), không log nội dung câu lệnh.
- Kiến trúc đã chốt là WebRTC DataChannel P2P, Gin chỉ relay SDP/ICE. Nghĩa là SQL **không** đi qua Gin trong thiết kế hiện tại; điều khoản này là hàng rào cho mọi phương án dự phòng, không phải giấy phép để đưa SQL lên server.
- **Cấm** dùng `y-websocket` làm phương án dự phòng: nó đẩy toàn bộ văn bản `.sql` qua Gin, trái điều khoản này.

Ghi chú về hồ sơ: bản nháp v2 của `BAN_NHAP_STORY_SP024.md` đã tự ghi "chủ dự án duyệt chính thức 2026-11-23" trong khi chưa có xác nhận nào ngoài chính file đó. Chủ dự án đã xác nhận lại trực tiếp ngày 2026-11-23; mục này là bản ghi có thẩm quyền.

## Quyết định của chủ dự án ngày 2026-11-23: D17 và D20

Chủ dự án chốt hai câu hỏi còn treo của bản nháp Story SP024. Chi tiết và số đo nằm ở `BAN_NHAP_STORY_SP024.md`, mục "Sửa #20" của Task169 và mục "Sửa #5" của Task167.

**D17 — đồng bộ Arena (Task169): polling chu kỳ 3 giây, giữ Render thức bằng cron-job.org.**

- Chu kỳ chốt là **3 giây**. Poll 3 giây sinh 20 request/phút, tức khoảng 100 request/5 phút, nằm dưới trần `CloudSync` 120 lệnh/5 phút khoảng 17 % và dưới rate limiter trong bộ nhớ 30 request/phút, nên không còn nguy cơ `429`. Chu kỳ 2 giây bị loại vì 30 request/phút = 150 request/5 phút, vượt trần `CloudSync` 25 %.
- Giữ Render thức bằng **cron-job.org**, thay cho GitHub Actions `keep-awake`. Lịch sử chạy thật của GitHub Actions chỉ đạt 3,1 lần/ngày thay vì 144 lần/ngày theo thiết kế, vì GitHub dồn và bỏ nhịp cron khi tải cao.
- Cửa sổ giữ thức là **7:00–24:00 giờ Việt Nam** (17 giờ/ngày), khớp dòng "Giờ chạy backend" trong `CLAUDE.md`. Trần Render là 750 giờ/tháng cho cả workspace, nên cửa sổ này tốn khoảng **510 giờ/tháng = 68 % trần**, còn dư 240 giờ. Giữ 24/7 sẽ là 730 giờ/tháng = 97,3 % trần, quá sát nên không chọn.
- Ngoài cửa sổ đó service ngủ; request đầu tiên sau đó là cold start khoảng 12,5 giây (đo được 12.576 ms), hành vi đã được chấp nhận.

**D20 — đếm 5 phòng fork (Task167): trường `roomFork?` trong IndexedDB, không dùng Redis, không bump DB version.**

- Thêm trường tuỳ chọn `roomFork?: { projectId: string; forkedAt: number }` vào `WorkspaceProject`, đếm bằng `listProjects(scope)` rồi `filter`. Không cần index mới.
- **Không bump `CURRENT_DB_VERSION`** (giữ nguyên 1) và không cần `onupgradeneeded`: object store `projects` chỉ khai `keyPath: "id"`, IndexedDB không kiểm schema trường, bản ghi cũ thiếu trường đọc ra `undefined`.
- Đã kiểm trường mới không lọt vào `projectStamp` (không sinh false `modified`), không lọt vào payload đẩy cloud (không vi phạm Core Rule 7), và sống sót qua vòng kéo dự án từ cloud vì bản ghi được dựng bằng `...local`.
- **Redis bị từ chối:** đếm trên server là đếm bản sao lệch so với IndexedDB, phá AC5 của Task167 (mỗi lần fork sẽ phải gọi server), thêm điểm hỏng khi Upstash không truy cập được, và không nhẹ hơn so với một transaction IndexedDB không mạng.
| 2 | Đo trước hay xây thẳng | **Đo trước, làm ngay.** |
| 3 | "Một người viết, nhiều người xem" có đủ không | **Không.** Cấp quyền khi chia sẻ; ai có quyền chỉnh sửa thì được sửa, ai không thì chỉ xem. Nhiều người sửa và nhiều người xem cùng lúc. |
| 4 | Thứ tự với SP013/SP999 | **Song song.** |

## Ranh giới phải giữ

- Quyết định 3 nói về **quyền trên tài liệu**, không nói engine chạy ở đâu. Engine vẫn chỉ chạy được trên máy một người tại một thời điểm (PGlite một phiên). Cách biến "nhiều người có quyền sửa" thành chuyện chạy được là nội dung của Tầng 2, chưa mở.
- Core Rule 7 đang **nợ**, không phải đã cho phép. Mọi số đo ở Tầng 0 phải nêu rõ: số này có gửi SQL ra khỏi máy hay không.

## Các tầng

| Tầng | Nội dung | Trạng thái |
|---|---|---|
| 0 | Đo & quyết định (STR108 / Task159) | **Xong** (merge `33ff8d7`) — đo đủ 6 AC, 3 lần mỗi phép, qua review độc lập. Kết luận **no-go cho Live Rooms**. Xem `STR108/Task159/ket_qua_do.md` |
| 1 | Live Presentation: host phát, N viewer xem | **Không làm** — cổng Tầng 0 kết luận no-go (`STR108/Task159/ket_qua_do.md`) |
| 2 | Nhiều người sửa: quyền khi chia sẻ, soạn thảo chung, chạy engine có kiểm soát | Chưa mở |
| 3 | Đấu trường tranh chấp, nhãn Mô phỏng | Chưa mở |

## Việc đã làm

| Task | Nội dung | Trạng thái |
|---|---|---|
| Task159 | Cổng đo Tầng 0 | **Xong** (merge `33ff8d7`) — đo đủ 6 AC, 3 lần mỗi phép. Review độc lập chấm **no-go** đứng vững trên 6 lý do riêng; 5 lỗi Trung bình và 8 lỗi Thấp đã sửa ở `4e908c7` + `663cb16`. Báo cáo: `STR108/Task159/ket_qua_do.md`. Bàn giao: `STR108/Task159/ban_giao_task159.md` |
| Task160 | Migration 006: schema phòng (invite token + Baton) | **Xong code, đã merge** (`84083ef`, 2026-11-23) — 3/3 test PASS trên PostgreSQL 18 thật bằng role non-superuser, `go test -p 1 ./...` 7/7 package. **Chưa qua review độc lập.** Party-mode review ngày 2026-11-23 dựng lại được **6 lỗi** (2 Nghiêm trọng, 3 Trung bình, 1 Thấp) — nặng nhất: sáu helper dọn database trong test xoá mất khóa ngoại của 006 mà test vẫn xanh. Việc sửa giao `SP999/STR117/Task171`. Bàn giao: `STR116/Task160/ban_giao_task160.md` |
| Task163 | WebSocket signaling SDP/ICE cho phòng cộng tác | **Xong 100%** (merge `c153c63` & `e390e2f`, 2026-11-23) — relay WebRTC DataChannel P2P, Zero-Log Transit, 16/16 test PASS. Bàn giao: `STR114/Task163/ban_giao_task163.md` |
| Task168 | Arena: chọn kịch bản + điều hướng bước | **Xong 100%** (merge `93b97bf`, 2026-11-23) — 13 files, 23/23 tests PASS, 0 byte mạng. Bàn giao: `STR116/Task168/ban_giao_task168.md` |
| Task162 | UI mời cộng tác & danh sách thành viên | **Xong 100%** (merge 2026-11-25) — `InviteDialog` + `/[locale]/join` + `GET /:id/members` (D1). Qua 3 vòng sửa và reviewer độc lập PASS 100% (`TestListMembersUnderRLS` với `sqllens_app`, 7/7 E2E Chromium, `npm run check`, 8/8 package Go). Bàn giao: `STR113/Task162/ban_giao_task162.md` |
| Task164 | Yjs P2P provider + CodeMirror 6 binding + Baton store | **Xong 100%** (merge 2026-11-25) — tự viết `room-provider.ts` trên `/signal` + DataChannel lọc `toPeerId` theo D3 (D1, không `y-webrtc`), `collab-binding.ts`, `baton-store.ts` (D2: nợ 3 REST endpoint `/baton/request`, `/baton/grant`, `/baton/heartbeat`), 16/16 collab unit tests + `npm run check` + `next build` PASS sau review độc lập. Bàn giao: `STR114/Task164/ban_giao_task164.md` |
| Task165 | UI The Baton (nút Play + `<BatonRequestToast />`) | **Xong 100%** (merge 2026-11-25) — `baton-store.ts` (`memberNames`), `BatonRequestToast`, nút Play inline trong `lab-workspace.tsx` (ẩn với `viewer`, disable + tooltip tên người giữ Baton), 3/3 E2E `room-baton.spec.ts` + `npm run check` + `next build` PASS sau review độc lập. Bàn giao: `STR114/Task165/ban_giao_task165.md` |
| Task169 | Arena: đồ thị Cytoscape + polling 3s | **Xong 100%** (merge 2026-11-25) — `ArenaWaitGraph` 4 màu + cycle, `ARENA_POLL_INTERVAL_MS = 3000` đo 100 req/5 phút (0 byte SQL, nhãn Mô phỏng), 2/2 E2E `arena-sync.spec.ts` + `npm run check` + `next build` PASS sau review độc lập. Bàn giao: `STR116/Task169/ban_giao_task169.md` |
| Task161 | Gin API phòng & Migration 007 (6 endpoint) | **Xong 100%** (merge 2026-11-24) — Reviewer độc lập nghiệm thu PASS 100%, 5/5 AC, 9 ca biên, 8/8 package ok, 7 đột biến M1–M7. Báo cáo: `STR116/Task161/review_task161.md`. Bàn giao: `STR116/Task161/ban_giao_task161.md` |
