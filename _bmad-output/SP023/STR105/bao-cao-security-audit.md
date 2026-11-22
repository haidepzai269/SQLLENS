# Báo cáo kiểm bảo mật Epic SP023 (Task155)

Ngày: 2026-11-22. Người chạy: phiên chính (Buffy), theo skill `security-audit` + `ATTACK-CLASSES.md`.
Phạm vi: diff của `Task143`–`Task148` (URL share) và `Task149`–`Task154` (cloud sync & RLS),
tức `git diff 12e078f^..a1dc71c`.

| Số liệu phạm vi | Giá trị |
|---|---|
| File thay đổi | 149 |
| Dòng thêm / xoá | +20.277 / −165 |
| Trong đó backend (`api/`, không tính test) | 12 file, +2.036 / −12 |
| Trọng tâm kiểm | auth, RLS, SQL người dùng, nội dung công khai trong URL, log |

## 1. Cách chạy và bằng chứng môi trường (AC1)

- **Phần phân tích tĩnh chạy trong Docker tắt mạng thật**:
  `docker run --rm --network none -v "C:/SQLLens:/src:ro" -w /src postgres:18-alpine sh -c ...`.
  Kiểm chứng mất mạng: `ip route` in ra **rỗng**. Toàn bộ grep/grep nội dung của mục 5 chạy trong
  container đó, mount read-only.
- **Phần kiểm động dùng dịch vụ localhost duy nhất** (được phép của skill: "isolated loopback"):
  PostgreSQL 18-alpine ở `localhost:54492`, `next start` ở `localhost:31xx`. Không gọi host ngoài;
  riêng bộ `share-run` của Task148 còn tự khẳng định **0 request ra origin khác**.
- **Giới hạn phải nói rõ**: toolchain Go/Node chạy trên máy host, **không** nằm trong container tắt
  mạng. Vì vậy AC1 đạt theo nghĩa "không truy cập Internet và phân tích tĩnh chạy trong container
  `--network none`", không phải "toàn bộ toolchain chạy trong container tắt mạng".
- Không chạm production, không dùng dữ liệu thật: mọi kiểm động dùng fixture `testdata/rls_fixtures.sql`
  và tài khoản `postgres` localhost.

## 2. Bảng kết quả kiểm (chạy thật, không suy đoán)

| Hạng mục | Cách kiểm | Kết quả |
|---|---|---|
| Auth cloud: bắt buộc session | `TestCloudEdgeCases` (401 khi không uid) + `RequireUser` ở `cloud_projects.go:66` | Đạt |
| Auth cloud: `owner_id` chỉ từ session | struct body không có `ownerId`; `h.owner` đọc `auth.UserID` | Đạt |
| Auth cloud: CSRF | `auth.Mount` gắn `originCheck` toàn cục trước khi `MountCloud` chạy (`main.go:55,63`); POST/PUT/DELETE đòi `Origin` khớp `PUBLIC_ORIGIN` (`auth.go:160-172`) | Đạt |
| Auth cloud: cookie | `HttpOnly`, `Secure` (trừ localhost), `SameSite=Lax` (`auth.go:217`) | Đạt |
| Cross-tenant đọc/ghi/xoá | `TestRLSCrossTenantCannotReadOrWrite`, `TestRLSCrossTenantInsertTabRejected` | Đạt |
| `viewer` không ghi được tab | `TestRLSMemberRoleGateOnTabs` + migration `005` siết 3 policy ghi | Đạt |
| Owner non-superuser vẫn bị chặn | `TestRLSOwnerRoleStillBlocked` (bỏ `FORCE` thì thấy dữ liệu chéo) | Đạt |
| Rò ngữ cảnh qua pool | `TestRLSContextLeakOnSamePool` | Đạt |
| Store methods cross-tenant | `TestRLSRegressionCrossTenantStoreMethods` (đã siết ở review Task156) | Đạt |
| SQL người dùng trên server | grep: mọi câu ghi cloud dùng placeholder (`insertCloudTabs`, `WithTenant`); không có `fmt.Sprintf` ghép SQL từ input | Đạt |
| SQL người dùng trên client | `share/try-run.ts` chạy trong PGlite/SQLite WASM của người nhận, `BEGIN...ROLLBACK`, không gọi mạng | Đạt |
| Nội dung trong URL | payload nằm ở fragment; `Referrer-Policy: no-referrer` trên `/vi/share`, `/en/share`, `/share` (307); E2E 6/6 + 18/18 khi lặp 3 lần | Đạt |
| XSS trong share | E2E `share-security.spec.ts` (SQL, tên tab, tên dự án, iframe, fork) | Đạt |
| Log không chứa SQL (Core Rule 7) | mục 5 | Đạt |
| Secret trong diff | regex `sk-`, `ghp_`, `AIza`, `BEGIN ... PRIVATE KEY` trên diff | Không thấy |

## 3. Phát hiện

### F1 — Trung bình: route cloud không có giới hạn tần suất/abuse, trong khi mọi route tốn tiền khác đều có

- **Bằng chứng**: `api/internal/httpapi/cloud_projects.go:73` — `r.Group("/api/v1/cloud/projects", guard)`,
  chỉ có `RequireUser`. So sánh: `api/cmd/server/main.go:58` — AI dùng `a.Gate(quota.AIMessage)`;
  MySQL cũng có ngân sách riêng. Route cloud được nâng trần body lên **3 MB**
  (`cloud_projects.go:46`, `router.go:39`).
- **Chủ thể / ranh giới**: người dùng đã đăng nhập (hạng thấp) → Render free + Neon app (tài nguyên
  dùng chung của mọi người dùng).
- **Tác động cụ thể**: một tài khoản có thể gửi vô hạn request 3 MB (PUT lặp trên một dự án), làm
  tốn CPU/RAM Gin và I/O Neon; không có ngưỡng nào chặn trước khi hết tài nguyên. Không phải lỗi rò
  dữ liệu — là rủi ro sẵn sàng/cost.
- **Tái hiện an toàn**: đọc mã (không cần bắn tải); muốn động thì gọi `PUT` 100 lần với body 2 MB
  vào một dự án của chính mình trên bản Docker local.
- **Sửa tối thiểu**: bọc nhóm route cloud bằng một luật quota mới (`quota.CloudSync`, ví dụ
  120 request / 5 phút / user) như AI. **Chưa làm trong task này** vì phải thêm luật + hằng số +
  i18n và đổi hành vi API — xem `SP999`.

### F2 — `needs_validation` (chưa xếp mức): trần dung lượng cloud tính theo dự án, không theo người dùng

- **Bằng chứng**: `api/internal/store/cloud.go:19-25` — 50 dự án/user, 2 MB/dự án ⇒ **tối đa ~100 MB
  một tài khoản**. Không có câu nào cộng tổng byte theo owner.
- **Vì sao chưa xếp mức**: tác động phụ thuộc **gói Neon của dự án** (dung lượng cấp cho database),
  là cấu hình triển khai không có trong repo. Nếu Neon free (~0,5 GB), vài tài khoản là đầy; nếu gói
  lớn hơn thì chỉ là chi phí. Theo skill: không suy đoán cấu hình triển khai ⇒ `needs_validation`.
- **Cách xác minh của chủ dự án**: xem dung lượng gói Neon + chạy
  `SELECT pg_database_size(current_database())` sau khi đẩy 1 dự án 2 MB.
- Ghi vào `SP999` để chủ dự án chốt: thêm trần tổng theo user (ví dụ 20 MB) hay giữ nguyên.

### F3 — Thấp: snapshot không giới hạn số tab, link 32 KB tạo được hàng nghìn tab cục bộ khi Fork

- **Bằng chứng**: `web/src/modules/share/snapshot.ts:84-97` chỉ kiểm kiểu (`string`), không kiểm số
  lượng hay độ dài tên; `web/src/modules/share/codec.ts` chặn ở 32 KB. Một tab tối thiểu
  `{"name":"","sql":""}` ≈ 20 byte ⇒ **~1.400 tab** vừa 32 KB.
- **Tác động**: người nhận link bấm **Fork** sẽ ghi 1.400 tab vào IndexedDB và dựng 1.400 nút tab.
  Phiền và tốn RAM, phải xoá tay; **không** rò dữ liệu, không thoát sandbox.
- **Sửa tối thiểu** (chưa làm, cần chủ dự án chốt ngưỡng): chặn `tabs.length > 100` trong
  `validateSnapshotStructure`, kèm câu báo song ngữ. 100 trùng quota tab cloud nên dễ giải thích.
- Ghi `SP999`.

### F4 — Thông tin: API cloud chỉ phục vụ chủ sở hữu

`GetCloudProject`/`ListCloudProjects`/`ReplaceCloudProject`/`DeleteCloudProject` đều lọc
`owner_id = $2` (`store/cloud.go:209,258,298`), nên thành viên `viewer`/`editor` (đọc được ở tầng
RLS) nhận **404** qua API. Đây là hành vi có chủ đích (chưa có tính năng chia sẻ dự án), không phải
lỗ hổng — nhưng phải ghi lại để lần sau thêm API thành viên không tưởng là API đang chia sẻ.

### Giới hạn đã biết của RLS — vẫn còn, không mới

- `app.owned_projects` tính **một lần đầu transaction** (`store/tenant.go:55`): tạo dự án rồi thêm
  thành viên trong cùng transaction sẽ vi phạm `WITH CHECK`. Đường hiện tại chưa ghi
  `cloud_project_members` nên chưa ảnh hưởng.
- `WithTenant` tốn thêm một round trip mỗi request (đọc danh sách dự án sở hữu).

## 4. Những chỗ đã kiểm và thấy đúng (không phải lỗi)

- `handler.fail` chỉ log `%T` của lỗi (`cloud_projects.go:193`); `requestLog` chỉ in
  `method + route pattern + status + duration` (`router.go:87`); `recovery` chỉ log `%T`
  (`router.go:101`). Không nơi nào in body, path, query hay tab.
- `insertCloudTabs` dựng **một** câu INSERT nhiều dòng với placeholder (bài học Task150: không dùng
  `COPY FROM` trên bảng có RLS).
- `WithTenant` từ chối user id không phải UUID trước khi mở transaction, và dùng
  `set_config(..., true)` nên ngữ cảnh chết theo transaction.
- Migration `004`/`005` đọc lại catalog và `RAISE EXCEPTION` nếu policy sai — không tin câu lệnh vừa chạy.
- Share: không `dangerouslySetInnerHTML`/`innerHTML` trong `web/src` (grep), CSS share/print không
  tham chiếu URL ngoài, metadata `robots: index:false`.

## 5. Core Rule 7 — không log SQL (bằng chứng grep, chạy offline)

Chạy trong `docker run --network none` (mount repo read-only). Nguyên văn đầu ra:

```
== A1: log calls mentioning sql/query/body/tab (expect NONE) ==
NONE
== A2: log calls in cloud handler ==
193:		log.Printf("cloud: request failed (%T)", err)
== A3: request logger ==
87:		l.Printf("%s %s %d %s", method, route, c.Writer.Status(), time.Since(start))
101:				l.Printf("panic recovered (%T)", v)
== A4: store package logging (expect NONE) ==
NONE
== A5: client console in cloud+share (expect NONE) ==
NONE
== A6: external URLs in share+print CSS (expect NONE) ==
NONE
```

Đối chiếu thêm ngoài container (`grep -rnE "(Printf|Println|Sprintf)\(.*\b(sql|query|body|tabs?)\b" api`):
**0 kết quả**. Ở client, chỗ duy nhất còn `console` trong đường workspace là `engine-binding.ts:140`,
ghi **thông điệp lỗi** của lời gọi nhả phiên MySQL, không ghi câu SQL.

Kết luận Core Rule 7: **đúng cho toàn bộ diff của đợt này**.

## 6. Checklist AC của Task155

| AC | Kết quả |
|---|---|
| AC1 chạy Docker tắt mạng, không Internet | Đạt một phần — phân tích tĩnh trong `--network none` (đã kiểm `ip route` rỗng); kiểm động chỉ dùng localhost. Toolchain chạy trên host, đã ghi rõ ở mục 1 |
| AC2 mọi phát hiện có file, dòng, cách tái hiện | Đạt — F1/F2/F3 đều có file:dòng và đường tái hiện |
| AC3 không còn lỗi nghiêm trọng/cao chưa xử lý | Đạt — không có lỗi critical/high; F1 trung bình, F2 `needs_validation`, F3 thấp |
| AC4 lỗi còn lại ghi SP999 kèm lý do và mức | Đạt — 3 dòng mới trong `_bmad-output/SP999/README.md` |
| AC5 phần riêng Core Rule 7 với bằng chứng grep | Đạt — mục 5 |
| AC6 kết luận rõ | Đạt — mục 7 |

## 7. Kết luận

**Được đóng Epic SP023.** Trong phạm vi diff của đợt này không có lỗi mức critical/high: auth cloud
bắt buộc session + kiểm Origin, `owner_id` chỉ đến từ session, RLS chặn cross-tenant ở cả role chủ
non-superuser (đã chứng minh bằng đột biến bỏ `FORCE`), nội dung share chỉ nằm trong fragment và
không rò qua referrer, log không chứa SQL.

Còn lại ba việc không chặn đóng Epic, đã đưa vào `SP999`: giới hạn tần suất cho route cloud (F1,
trung bình), chốt trần dung lượng cloud theo user (F2, chờ chủ dự án), và chặn số tab trong snapshot
(F3, thấp).
