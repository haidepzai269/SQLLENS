# Bàn giao Task157

Đã làm: đóng 2 trong 3 phát hiện mà cổng `security-audit` của Task155 để lại ở `SP999`, và ghi
nhóm 4 lỗi e2e có sẵn trên `main` thành dòng riêng trong `SP999/README.md` (trước đó chỉ nằm trong
`AGENTS.md`).

## F1 (trung bình) — route cloud thiếu hạn mức: ĐÃ SỬA

- `api/internal/quota/quota.go`: thêm luật **`CloudSync`** = 120 request / 5 phút / user.
- `api/internal/auth/auth.go`: tách `Gate` thành `Gate` (giữ nguyên) + **`GateLimit(rule, strict)`**
  công khai. `strict = true` giữ hành vi cũ (thiếu Upstash → 503) cho MySQL/AI; `strict = false`
  bỏ qua lớp quota khi chưa cấu hình Redis, vì cloud CRUD vẫn phải chạy được.
- `api/internal/httpapi/cloud_projects.go`: `CloudConfig.Guards []gin.HandlerFunc`, chèn ngay sau
  `RequireUser` và trước handler.
- `api/cmd/server/main.go`: `Guards: a.GateLimit(quota.CloudSync, false)`.

Hệ quả cần nhớ: giới hạn thô trong bộ nhớ (30 request/phút/user) **chặt hơn** luật quota, nên trên
thực tế request thứ 31 trong một phút nhận `rate_limited` (không tốn lệnh Upstash), còn
`quota_exceeded` chỉ xuất hiện khi người dùng rải request qua nhiều phút mà tổng vẫn vượt 120/5 phút.

## F3 (thấp) — snapshot không giới hạn số tab: ĐÃ SỬA

- `web/src/modules/share/snapshot.ts`: `MAX_SNAPSHOT_TABS = 100` (trùng quota tab cloud),
  `validateSnapshotStructure` từ chối snapshot quá trần, thêm mã lỗi **`SNAPSHOT_TOO_MANY_TABS`** và
  helper `snapshotTabLimitExceeded`.
- `web/src/modules/share/codec.ts`: chặn ở **cả hai chiều** (`encodeSnapshot` và `decodeSnapshot`)
  và ném đúng mã mới, để giao diện báo lý do thay vì "dữ liệu hỏng".
- `web/src/modules/share/share-view.tsx` + `messages/{vi,en}/share.json`: chuỗi
  `share.view.errorTooManyTabs`.

## F2 — trần dung lượng cloud: KHÔNG LÀM

Vẫn nằm ở `SP999` với trạng thái `Chờ chủ dự án quyết` (giữ ~100 MB/user hay thêm trần 20 MB/user);
tác động phụ thuộc gói Neon nên không tự chọn.

## Kiểm tra đã chạy (số thật)

- `go vet ./...` + `go build ./...`: PASS.
- PostgreSQL trong Docker (`postgres:18-alpine`, cổng 54493) — **phiên bản thật là 18.7**, bàn giao
  đầu ghi 18.6 (lệch vá, không đổi kết luận):
  `T150_DATABASE_URL=... go test ./internal/httpapi -run Cloud` → **8/8 PASS**, gồm hai test mới
  `TestCloudAppliesRateLimitGuard` (429 + `Retry-After`, guard chạy trước handler, dưới hạn mức vẫn
  201) và các test cũ không đổi hành vi;
  `T042_DATABASE_URL=... go test ./internal/auth -run "TestCloudGate|TestMySQLGate|TestNotConfigured"`
  → **3/3 PASS**, gồm `TestCloudGate` (30 request đầu 204; request 31 `rate_limited` và không gọi
  Upstash; thiếu Upstash vẫn 204).
- `go test ./...` (không đặt biến môi trường, các test cần Postgres tự skip): 7/7 package ok.
- Chạy hai package dùng chung database **phải** dùng `-p 1`: chạy song song thì chúng cùng
  `DROP`/`Migrate` và cho `deadlock detected` / `relation "schema_migrations" does not exist`.
  `T150_DATABASE_URL=... T042_DATABASE_URL=... go test -p 1 ./internal/httpapi ./internal/auth`
  → **2/2 package ok**.
- `cd web`: `npm run check:i18n` PASS, `tsc --noEmit` PASS, `eslint` trên 4 tệp đã sửa PASS,
  `npx vitest run src/modules/share` → **6/6 tệp, 125 test PASS** (gồm 3 test mới cho trần tab:
  100 tab hợp lệ, 101 tab bị chặn khi giải mã và khi mã hóa).

## Bổ sung sau review độc lập (`SP023/STR105/review_task155_156.md`)

Review độc lập đã chạy lại toàn bộ và tìm thêm **hai lỗi trong chính đợt này**, cả hai đã sửa:

1. **Giao diện báo sai lý do khi quá 100 tab** (do F3 sinh ra). `share-dialog.tsx` gộp **mọi**
   `SnapshotError` vào `status = "blocked"`, nên dự án 101 tab hiện câu "vượt quá 32 KB" dù dữ liệu
   chỉ vài KB, **và** vẫn mời tải file `.sqllens` mà chính `decodeSnapshot` sẽ từ chối. Đã tách
   trạng thái `blocked-tabs` (không có nút tải file) và `failed`, thêm hàm thuần
   `statusForEncodeError`, chuỗi `blockedTabs`/`failed` cho vi/en, 2 test mới. Đã chứng minh test
   **đỏ** khi bỏ nhánh.
2. **Task156 AC6 "test chạy ở CI" không đúng**: job `api` của `.github/workflows/ci.yml` không đặt
   `RLS_TEST_DSN`, nên **10/10 `TestRLS*` SKIP im lặng**, exit 0. Đã thêm job `rls` (PostgreSQL 18
   service, DSN thật, đỏ nếu có `--- SKIP`, đòi ≥ 10 `--- PASS: TestRLS`).

Hai việc nhỏ còn lại, ghi `SP999`, **không** sửa trong đợt này:

- `Retry-After` của giới hạn thô lớn hơn cửa sổ 1 giây (`auth.go:302-304`, `wait.Seconds()+1` với
  cửa sổ 60 s) — có từ trước, không do F1.
- Giới hạn thô 30 request/phút dùng **chung một xô** cho mọi route theo user id (`auth.go:107`), nên
  30 request cloud làm 1 request MySQL của cùng user nhận 429 (đã đo bằng probe). F1 làm lộ ra;
  cách xử lý (xô riêng theo route hay giữ chung) là quyết định của chủ dự án.

Số đo của review độc lập (thay cho phần "chưa chạy" bên dưới): `npm run check` đầy đủ → **1461
passed / 18 skipped (1479 test, 119 file)**, exit 0; `npm run build` PASS; `go test -p 1 ./...` trên
PG 18.7 → **7/7 package ok**, 10/10 `TestRLS*` PASS, 0 SKIP; e2e `share-security` + `share-run` →
**16/16 PASS**, và `share-security --repeat-each=3` → **18/18 PASS**.

## Chưa làm / giới hạn

- Không chạy `npm run check` đầy đủ (1.400+ test toàn repo) vì thay đổi chỉ chạm module share; đã
  chạy đúng tệp liên quan + typecheck + i18n. *(Đã chạy bù ở lượt review: PASS.)*
- Không chạy lại 4 spec e2e đang đỏ trên `main` (cần dev server + Playwright); chúng đã được xác
  nhận bằng build sạch ở các task trước và nay có dòng riêng trong `SP999/README.md`.
- Không dựng worktree/task riêng theo `QUY_TRINH.md` vì thay đổi nhỏ và làm trực tiếp trên `main`
  theo yêu cầu của chủ dự án; bàn giao này là bản ghi thay thế.
- **Chưa commit.** Toàn bộ thay đổi của Task157 + hai bản sửa của lượt review vẫn nằm trong working
  tree (19 tệp sửa + 4 mục chưa theo dõi).
