# Bàn giao Task158 — đóng nốt SP999

Nhánh `task/Task158`, base `main` @ `8d3b5c2`. Ngày 2026-11-22.

## AC1 — 4 lỗi e2e hồi quy
- `web/src/components/sql-editor/sql-editor-impl.tsx`: thêm media query `max-width: 639.98px` (khớp breakpoint `sm` 640px) đặt `.cm-content, .cm-gutters` về `16px !important` ngay trong `fontSizeTheme`; máy tính vẫn theo cỡ người dùng chọn.
- `web/src/modules/lab/lab-workspace.tsx`: gán `useSearchParams()` vào biến rồi cho effect đồng bộ engine dùng `searchParams.has("engine")` — có query thì `bindEngine` (tôn trọng URL), không có thì `router.replace` như cũ. Mỗi lần chỉ chạy một nhánh nên không có vòng lặp `router.replace`.
- `web/src/modules/lab/lab-workspace.tsx`: `editorError` gắn lại lỗi parse khi có `error.position`, bỏ qua khi `prepareDump` đã xóa khối `COPY`/`LOCK` (`removedAny`) vì vị trí khi đó không khớp chuỗi trong ô soạn.
- `web/e2e/golden-path.spec.ts`: thêm `ControlOrMeta+a` trước `ControlOrMeta+Enter`, đúng hành vi thật (bôi đen cả khối rồi chạy) sau khi Task113/114 đổi Ctrl+Enter thành "chạy câu tại con trỏ"; assertion giữ nguyên 3 dòng.

Số đo thật, `npx playwright test e2e/sql-editor.spec.ts e2e/golden-path.spec.ts e2e/lab.spec.ts` trên bản `npm run build` mới (`API_ORIGIN=https://api.example.invalid`, `E2E_PORT=3128`): **55 passed, 0 failed (2,6 phút)**; chạy lại lần hai độc lập (`E2E_PORT=3131`): **55 passed, 0 failed (2,7 phút)**. Baseline cùng bộ lệnh trước khi sửa: **9 failed / 46 passed** (golden-path 4, lab.spec 4, sql-editor mobile 1).

## AC2 — gofmt
`cd api && gofmt -l .` không in gì. Chỉ định dạng: `internal/ai/ai_test.go` (2 dòng trống cuối) và `internal/ai/inline_complete_test.go` (thụt lề struct tag). `go test -p 1 ./internal/ai` → `ok 3.369s`.

## AC3 — Retry-After
`internal/auth/auth.go`: `strconv.Itoa(int(wait.Seconds())+1)` → `a.retryAfterSeconds(wait)`: làm tròn LÊN, sàn 1, trần bằng độ dài cửa sổ. Ca biên 59,4 s ra **60**, không phải 61. Test `TestRetryAfterSeconds` (9 ca + cửa sổ 500 ms) cộng `retryAfterHeader` kiểm header thật trong `TestMySQLGate`/`TestCloudGate`. Đột biến ngược: trả lại `int(wait.Seconds())+1` → đỏ (`chờ 30s: 31, muốn 30`; `chờ 1s: 2, muốn 1`); hoàn nguyên → xanh.

## AC4 — guardLocalOnly
`internal/store/store_cloud_test.go`: sau khi kiểm scheme, từ chối mọi khóa query `host`, `hostaddr`, `service` (không phân biệt hoa thường), vì pgx đọc query SAU phần authority nên `?host=` thắng `Hostname()`. Test: 7 URL bị từ chối (gồm `postgres://u:p@localhost:5432/app?host=db.invalid`, `?hostaddr=`, `?service=`, `?HOST=`), 2 URL localhost có query vô hại vẫn qua. Đột biến ngược: xóa vòng lặp → `phải từ chối URL "postgres://u:p@localhost:5432/app?host=db.invalid"`; hoàn nguyên → `ok`.

## AC5 — mysql.spec
Hợp đồng giả định spec này cần sandbox Azure; thực tế **không**, vì spec tự mock `/api/me`, `/api/mysql/sessions` và query bằng `page.route`. Đã chạy thật: **22 passed, 0 failed (46,3 giây)**. Phần chạy với sandbox MySQL thật trên máy Azure: **chưa chạy** (không có quyền truy cập máy đó).
Trên `main` spec này có 2 test đỏ thật (`AC3 phiên hết hạn giữa chừng`, vi + en): `expect(mine(s)).toEqual([2 câu])` chỉ nhận 1 câu, vì `expect.poll` cũ chỉ đợi MỘT câu `information_schema` trong khi câu đọc schema còn đang bay nên nhận 404 trước lần bấm của người dùng. Đã siết thành `filter(...).length >= 2` (chờ đủ cả `refreshTables` và vùng stage); assertion về số câu người dùng giữ nguyên, không nới.

## Kiểm tra khác
- `cd api && gofmt -l . && go vet ./... && go test -count=1 -p 1 ./internal/ai ./internal/auth ./internal/store` → gofmt rỗng, vet exit 0, ba package `ok` (1,95 s / 8,53 s / 8,55 s) với `T042_DATABASE_URL` và `T149_DATABASE_URL` trỏ Postgres 18 trong Docker.
- `cd web && npm run check` → 117 file / 1461 test passed, 18 skipped, exit 0 (204 s); `npm run build` exit 0; `npm run check:i18n` exit 0 (không thêm chuỗi mới).
- Không sửa `web/next.config.ts`, không đụng `cloud-panel.tsx`/`web/src/modules/cloud/**`, không đổi nhãn Thật/Mô phỏng/Ước lượng.

## Chưa làm được, rủi ro còn lại
- **Chưa có reviewer độc lập**: phiên này ở độ sâu subagent tối đa nên không gọi được reviewer; tôi tự review theo QUY_TRINH §5.
- Bộ e2e rộng (11 spec, 3 worker) còn 27 đỏ nhưng **không do Task158**. Chạy riêng từng spec trên chính mã đã sửa: `lab-stage.spec.ts` **14 failed / 26 passed** (đỏ vì chuỗi rỗng "Chưa có cảnh để hiện" không còn trong `#stage` — stage giờ hiện danh sách thẻ mẫu; và `getByRole("tab")` đếm 7 thay vì 0), `share-run.spec.ts` **10 passed** (đỏ ở lần chạy rộng chỉ do tranh tài nguyên). `lab-polish.spec.ts` AC3 Ctrl+Enter và `shell.spec.ts` AC1 đổi ngôn ngữ + AC2 phím mũi tên vẫn đỏ; đã `git stash` phần `web/src` rồi chạy lại trên mã chưa sửa: **4 failed / 18 passed, đỏ đúng 4 test đó** — tức có sẵn trên `main`, không phải hồi quy mới. Cần task riêng.
- Chạy 3 worker song song trên máy đang tải nặng thỉnh thoảng quá hạn 30 giây (`lab.spec.ts` AC1+AC3 vi ở lần chạy 4 spec; `mysql.spec.ts` AC2 ở lần chạy 11 spec). Chạy riêng đều xanh.
