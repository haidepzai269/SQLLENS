# Review độc lập Task155 + Task156 (và phần chưa commit của Task157)

Người review: phiên chính (lead). Ngày: 2026-11-22.
Phạm vi: `_bmad-output/SP023/STR105/Task155/task155.md`, `_bmad-output/SP023/STR105/Task156/task156.md`,
cộng thêm 18 file đang sửa dở trong working tree (`SP999` Task157: F1 + F3 của báo cáo audit).

Nguyên tắc của lượt này: **không tin lời bàn giao**. Mỗi khẳng định dưới đây hoặc là lệnh đã chạy kèm
số thật, hoặc được ghi rõ là **chỉ đọc mã**. Chỗ nào bàn giao nói sai thì ghi lại đúng.

## 1. Môi trường và cách chạy

| Thành phần | Phiên này dùng | Ghi chú |
|---|---|---|
| Docker | **Có** (Docker Desktop 4.38.0, engine 27.5.1) | Khác phiên trước: lượt trước Docker bị `Access is denied` nên không tái hiện được bằng chứng PostgreSQL 18 của bàn giao |
| PostgreSQL cho test RLS | `docker run postgres:18-alpine`, cổng **54493**, `postgres (PostgreSQL) 18.7` | Đúng như bàn giao Task157 mô tả (bàn giao ghi 18.6, thực tế image hiện tại là 18.7 — lệch vá, không ảnh hưởng kết luận) |
| Node / npm | Node 22 (`C:\Program Files\nodejs`), npm qua `node npm-cli.js` | `npm.ps1` trên máy này hỏng ("Could not determine Node.js install directory") |
| Go | 1.25 | |

**Về AC1 của Task155** ("chạy audit trong môi trường tắt mạng"): phần phân tích tĩnh chạy lại được
trong `docker run --rm --network none` (đã kiểm `ip route` in ra **rỗng**). Nhưng **báo cáo audit ghi
sai một chi tiết**: mục 1 nói PostgreSQL 18-alpine ở `localhost:54492`, còn số đo thật của lượt đó là
PostgreSQL **17.5 trên máy host** (phiên trước không có Docker). Đây là lỗi ghi chép, không phải lỗi
bảo mật, nhưng nó làm câu "chạy thật trên PG18" trong báo cáo thành không đáng tin. **Lượt này đã
chạy lại toàn bộ trên PG 18.7 thật trong Docker** và kết quả dưới đây thay thế số cũ.

## 2. Chạy lại bằng máy (số thật của lượt này)

| Việc | Lệnh | Kết quả |
|---|---|---|
| Toàn bộ test backend trên PG18 | `T041/T042/T149/T150/T151_DATABASE_URL=RLS_TEST_DSN=postgres://postgres:x@127.0.0.1:54493/app go test -count=1 -p 1 ./...` | **7/7 package ok** (`store` 12,4 s; `auth` 6,8 s; `httpapi` 3,9 s) |
| 10 test RLS + 2 test cổng cloud (verbose) | `go test -p 1 -v ./internal/store ./internal/auth ./internal/httpapi` | **10/10 `TestRLS*` PASS**, `TestCloudGate` PASS, `TestCloudAppliesRateLimitGuard` PASS, **0 SKIP** |
| Đột biến chứng minh RLS thật (PG18) | probe `ALTER TABLE cloud_projects NO FORCE ROW LEVEL SECURITY` rồi chạy đúng bước 5 | `TRƯỚC: 0 hàng` → `SAU: 1 hàng` ⇒ test gốc **sẽ đỏ** nếu mất `FORCE` |
| Test RLS khi thiếu DSN | `go test -run TestRLS -v ./internal/store` (không đặt `RLS_TEST_DSN`) | **10/10 SKIP, exit 0** — xem lỗi R4 |
| `go vet` + `go build` | `go vet ./...`, `go build ./...` | sạch |
| Toàn bộ frontend | `npm run check` | **1461 passed / 18 skipped (1479 test, 119 file)**, lint 0 error, `tsc` sạch |
| Build production | `API_ORIGIN=http://localhost:8080 npm run build` | **PASS** |
| E2E share security | `E2E_PORT=3135 npx playwright test e2e/share-security.spec.ts --repeat-each=3` | **18/18 PASS** (15,3 s) |
| E2E share (2 spec) | `e2e/share-security.spec.ts` + `e2e/share-run.spec.ts` | **16/16 PASS** (58,0 s) |

## 3. Kiểm chứng "test có thể đỏ" (đột biến, không chỉ đọc mã)

Đây là phần các vòng review trước yêu cầu và là chỗ dễ tự lừa nhất, nên làm bằng cách **phá code rồi
xem test có bắt được không**.

| Đột biến | Kỳ vọng | Kết quả thật |
|---|---|---|
| `ALTER TABLE cloud_projects NO FORCE ROW LEVEL SECURITY` rồi chạy bước 5 của `TestRLSRegressionCrossTenantStoreMethods` | bước 5 thấy 1 hàng của Bình | **Đúng**: `TRƯỚC 0` → `SAU 1`. Đã trả `FORCE` lại, xoá probe |
| Đổi `Referrer-Policy` của route `/:locale(vi\|en)/share` thành `origin` | AC3 đỏ | **Đỏ đúng**: `Expected "no-referrer", Received "origin"` |
| Đổi `referrer: "no-referrer"` trong `app/[locale]/share/page.tsx` thành `origin` (thẻ `<meta>`) | AC4 đỏ | **Đỏ đúng**: `capturedReferer` = `http://localhost:3134/` thay vì `null` |
| `statusForEncodeError`: bỏ nhánh `SNAPSHOT_TOO_MANY_TABS` (trả về `blocked`) | test mới của share-dialog đỏ | **Đỏ đúng**: 1 failed / 22 passed |
| Job CI `rls`: chạy script kiểm với log chỉ có `--- SKIP` / log rỗng / log đủ 10 `--- PASS` | 2 ca đầu bị chặn, ca 3 cho qua | **Đúng cả 3** (chạy trong `alpine:3.21`) |

Một phát hiện phụ về **cách kiểm**: lần đầu tôi đột biến `next.config.ts` rồi chạy `npm run e2e` mà
test vẫn xanh 6/6. Nguyên nhân: `playwright.config.ts` dùng `webServer.command = npm run start`, tức
**phục vụ bản `.next` đã build sẵn**, không build lại. Đột biến chỉ vào được sau khi chạy lại
`npm run build`. Ai review bằng cách sửa config rồi chạy e2e mà quên build lại sẽ kết luận sai là
"test không bắt được lỗi". Đã ghi vào `SP999`.

## 4. Lỗi tìm được trong lượt này

### R4 — Trung bình: Task156 AC6 ("test chạy ở CI") **không đúng**, 10 test RLS SKIP im lặng trong CI

- **Bằng chứng**: `.github/workflows/ci.yml` job `api` chỉ chạy `go test ./...` và **không** đặt
  `RLS_TEST_DSN`. `api/internal/store/tenant_rls_test.go:72` đọc biến đó; thiếu thì `t.Skip`.
  Chạy thật để xác nhận: `go test -run TestRLS -v ./internal/store` (không DSN) → **10/10
  `--- SKIP: TestRLS*`, exit 0**, job vẫn xanh.
- **Tác động**: toàn bộ hồi quy RLS của SP023 — thứ được coi là "lớp bảo vệ thật của Epic" — không
  hề chạy trên CI. Một PR gỡ `FORCE ROW LEVEL SECURITY` sẽ merge được với CI xanh.
- **Vì sao trước đây không ai thấy**: bàn giao Task156 ghi "RLS chạy thật 10/10 PASS (PostgreSQL
  18-alpine)" — đúng, nhưng đó là **chạy tay trên máy**, không phải CI. AC6 nói về CI.
- **Sửa**: thêm job `rls` trong `.github/workflows/ci.yml`: service `postgres:18`, đặt
  `RLS_TEST_DSN`, chạy `go test -p 1 -v -run TestRLS`, rồi **kiểm chính đầu ra**: có `--- SKIP` thì
  đỏ, và phải đủ ≥ 10 `--- PASS: TestRLS`. Đã mô phỏng 3 ca trong container (mục 3) và chạy thật
  với DSN: **10 PASS, 0 SKIP**.
- **Đây là phạm vi mới** (thêm job CI), không nằm trong Task155/156. Ghi rõ để chủ dự án biết.

### R5 — Trung bình: dự án quá 100 tab bị báo sai là "quá 32 KB" và vẫn mời tải file

- **Bằng chứng**: `web/src/modules/share/components/share-dialog.tsx` (bản trước sửa) có
  `if (err instanceof SnapshotError && err.code === "SNAPSHOT_TOO_LARGE") { setStatus("blocked") } else { setStatus("blocked") }`
  — hai nhánh **giống hệt nhau**, nên mọi mã lỗi đều thành `blocked`. Nhánh UI `blocked` chỉ hiện
  `t("blocked")` = câu "vượt quá giới hạn URL an toàn (32 KB)".
- **Tái hiện**: dự án 101 tab rỗng (`buildSnapshotFromStore` không cắt) → `encodeSnapshot` ném
  `SNAPSHOT_TOO_MANY_TABS` (mới thêm ở Task157) → hộp thoại hiện "Dữ liệu vượt quá 32 KB" dù dữ liệu
  chỉ vài KB, **và** vẫn hiện nút "Tải file .sqllens" cho một snapshot mà chính `decodeSnapshot` sẽ
  từ chối.
- **Vì sao quan trọng**: đây là lỗi do chính bản sửa F3 của Task157 sinh ra — thêm mã lỗi mới nhưng
  không nối nó vào giao diện. Nếu merge nguyên trạng thì người dùng nhận lời giải thích sai.
- **Sửa**: tách `ShareStatus` thành `blocked` (quá 32 KB) / `blocked-tabs` (quá 100 tab) / `failed`
  (lỗi khác); thêm hàm thuần `statusForEncodeError(err)` để kiểm được cả ba nhánh; hai khối UI mới
  `share-too-many-tabs-warning` và `share-failed-warning`; chuỗi `blockedTabs` (có `{limit}`) và
  `failed` trong `messages/{vi,en}/share.json`. Khối `blocked-tabs` **không** có nút tải file.
- **Test**: 2 test mới trong `share-dialog.test.tsx` (một test dựng dự án 101 tab thật, một test
  thuần cho `statusForEncodeError`). Đã chứng minh **đỏ** khi bỏ nhánh (mục 3).
- **Sửa thêm một câu chữ quá lời**: bản nháp đầu của tôi viết chuỗi `blockedTabs` là "file `.sqllens`
  quá 100 tab sẽ bị từ chối **khi mở**". Kiểm lại thì **ứng dụng không có đường nhập file `.sqllens`
  nào** (chỉ có tải ra; `grep` toàn `web/src` không thấy chỗ đọc file). Đã đổi thành câu đúng: định
  dạng đó **không chứa được** quá 100 tab, nên tải file không giải quyết được — không hứa một hành vi
  chưa tồn tại. Đây là ví dụ cho thấy câu chữ trong thông báo lỗi cũng phải kiểm như code.

### R6 — Thấp: `Retry-After` của giới hạn thô có thể lớn hơn cửa sổ thật

- **Bằng chứng**: `api/internal/auth/auth.go:302-304` gửi
  `strconv.Itoa(int(wait.Seconds())+1)` khi `rateLimiter.allow` từ chối. `wait` là
  `b.reset.Sub(now)` nên tối đa bằng cửa sổ (60 s) — cộng 1 thành **61**, trong khi cửa sổ là 60 s.
- **Tác động**: client chờ dư 1 giây. Không phải lỗi bảo mật, chỉ là con số không chính xác; đã có
  từ trước Task157, không do đợt này.
- **Chưa sửa**: ngoài phạm vi "fix bug Task155/156", ghi `SP999`.

### R7 — Thấp (ghi nhận, không sửa): giới hạn thô 30 request/phút **dùng chung một xô** cho mọi route

- **Bằng chứng**: `auth.Gate`/`auth.GateLimit` đều gọi `a.rate.allow(id)` trên **cùng** `a.rate`
  (`auth.go:107`), khóa chỉ là user id, không có tên route. Chạy probe thật: 30 request
  `GET /cloud/ping` rồi 1 request `POST /mysql/ping` của cùng user → **429 `rate_limited`**.
- **Tác động**: người dùng bấm Lưu cloud liên tục có thể tạm chặn chính mình khỏi MySQL/AI trong
  tối đa 1 phút. Trước Task157 cloud không có cổng nào nên chưa xảy ra; **F1 làm lộ ra**.
- **Vì sao không sửa ngay**: đây là đánh đổi thiết kế (một xô chung = bảo vệ Upstash/Neon tốt hơn;
  xô riêng = công bằng hơn giữa các route). Chọn thay đổi này là quyết định của chủ dự án, và
  `sync.ts` **chỉ chạy khi người dùng bấm** (đã kiểm: không `setInterval`/`setTimeout`/tự đồng bộ),
  nên rủi ro thực tế thấp. Ghi `SP999`.

## 5. Những điểm bàn giao nói đúng (đã kiểm lại, không phải lỗi)

- **F1 (Task157)**: `quota.CloudSync` = 120/5 phút (`quota.go:40`), `auth.GateLimit(rule, strict)`
  (`auth.go:283`), `CloudConfig.Guards` chèn sau `RequireUser` (`cloud_projects.go:76-79`),
  `main.go` gắn `a.GateLimit(quota.CloudSync, false)`. Hai test mới **chạy thật và có thể đỏ**:
  `TestCloudAppliesRateLimitGuard` (429 + `Retry-After` + `quota_exceeded`, guard chạy trước handler,
  dưới hạn mức 201) và `TestCloudGate` (30 request 204, request 31 `rate_limited`, không tốn lệnh
  Upstash, thiếu Upstash vẫn 204). Nhận xét về `strict=false`: hợp lý — cloud CRUD là chức năng lõi,
  đóng cả route khi thiếu Redis là đánh đổi sai; giới hạn thô trong bộ nhớ vẫn còn.
- **F3 (Task157)**: `MAX_SNAPSHOT_TABS = 100` (`snapshot.ts:32`), `snapshotTabLimitExceeded` tách
  riêng để không gộp vào `SNAPSHOT_CORRUPT`, chặn ở **cả hai chiều** (`codec.ts:224` encode,
  `codec.ts:345` decode), `share-view.tsx:50` dịch mã lỗi mới. Test 100/101 tab cả hai chiều có thật.
- **R1/R2/R3 của review Task156 trước**: đã kiểm lại trong mã — `turbopack.root` không còn nhánh
  `process.platform`, bước 5 của `TestRLSRegressionCrossTenantStoreMethods` có truy vấn không lọc
  owner và **đột biến chứng minh nó phụ thuộc RLS thật** (mục 3), AC3 dùng `page.goto()` +
  `response.headers()`.
- **Core Rule 7**: grep lại trong `--network none`: 0 lời gọi log nhắc tới `sql/query/body/tab` trong
  `api/` (không tính test); `cloud_projects.go:199` chỉ log `%T`; `router.go:87,101` chỉ log
  method/route/status/duration và `%T`. Không có `console.*` trong `web/src/modules/{cloud,share}`.
- **Không có secret trong diff**: quét lại `git diff 12e078f^..a1dc71c` (**21.981 dòng**) với
  `sk-…`, `ghp_…`, `AIza…`, `BEGIN … PRIVATE KEY` → **0 kết quả**.
- **Phạm vi audit đúng**: `git diff --stat 12e078f^..a1dc71c` → **149 file, +20.277 / −165**, khớp
  báo cáo.
- **`gofmt`**: 7 file Go đã sửa đều sạch. `gofmt -l .` toàn `api/` còn đúng **2 file** lệch là
  `internal/ai/ai_test.go` và `internal/ai/inline_complete_test.go` — cả hai **đã lệch từ trước**
  (đã đối chiếu: bản ở `HEAD` cũng lệch), không do đợt này. `internal/auth/*` trước đây cũng lệch và
  nay đã sạch. Đã cập nhật dòng `SP999` cho đúng số còn lại.

## 6. Chỗ báo cáo audit (Task155) đã sửa cho trung thực

Đã sửa trực tiếp trong `bao-cao-security-audit.md` ở cùng lượt review này:

1. **Mục 1**: câu "PostgreSQL 18-alpine ở localhost:54492" là **sai** — lượt đó máy chưa chạy được
   Docker nên PostgreSQL dùng cho test RLS là **17.5 trên host**. Đã thêm khối "Đính chính" ghi rõ
   điều này và thay bằng số đo PG 18.7 của lượt review.
2. **Mục 1**: đã ghi rõ E2E chạy trên **bản `.next` build sẵn**, nên đột biến config phải build lại
   mới có tác dụng (bẫy đã gặp, mục 3).
3. **Mục 6, AC1**: giữ nguyên "Đạt một phần" — đúng, vì toolchain Go/Node chạy trên host. Thêm ghi
   chú rằng bảng AC khi đó **thiếu** việc Task156 AC6 chưa đúng (lỗi R4).
4. **F1/F3**: đã thêm khối "CẬP NHẬT: đã sửa ở Task157" kèm file:dòng, và ghi cả việc bản sửa F3
   sinh ra lỗi R5.

## 7. Kết luận

- **Task155**: về nội dung audit — **đạt**. Không có lỗi critical/high; Core Rule 7 đúng; phạm vi
  diff khớp; không có secret. Về **tính trung thực của báo cáo** — **đã đạt sau khi sửa**: mục 1
  trước đó ghi sai phiên bản PostgreSQL (17.5 thành 18-alpine) và F1/F3 chưa được đánh dấu đã sửa;
  cả bốn điểm ở mục 6 nay đã vào báo cáo.
- **Task156**: về test — **đạt**, và lần này đã chứng minh bằng đột biến là cả AC3 lẫn AC4 **có thể
  đỏ** (điều mà review trước chỉ khẳng định bằng suy luận). Về **AC6** — **chưa đạt ở thời điểm
  review**: test RLS không chạy ở CI (lỗi R4); nay đã thêm job `rls` nên AC6 mới thật sự đúng.
- **Task157 (chưa commit)**: hai bản sửa F1 và F3 đúng về mặt kỹ thuật và có test thật. Nhưng nó
  **sinh ra lỗi R5** (giao diện báo sai lý do khi quá 100 tab), nay đã sửa. Bàn giao Task157 tự khai
  là chưa chạy `npm run check` đầy đủ — lượt này đã chạy: **1461 passed / 18 skipped**, PASS.
- Còn 3 việc **không chặn** đóng Epic, đã ghi `SP999`: R6 (`Retry-After` lệch 1 giây), R7 (xô rate
  limit dùng chung — chờ chủ dự án chọn), và F2 (trần dung lượng cloud theo user — vẫn chờ chủ dự án).

Không có lỗi mức nghiêm trọng/cao nào còn lại trong phạm vi Task155 + Task156 sau lượt này.
