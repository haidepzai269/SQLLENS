# Bàn giao Task156

Đã làm: Khóa hai rủi ro bảo mật trọng yếu của đợt chia sẻ và cloud sync:

1. Kiểm thử bảo mật E2E Playwright trên Chromium thật chống XSS trong SQL, tên tab, tên dự án
   (`<img onerror>`, `<script>`, `javascript:`, `</textarea>`), mở trong iframe, và fork vào
   workspace — 0 dialog alert, không inject HTML DOM, dữ liệu hiển thị an toàn dưới dạng raw text.
2. Kiểm tra `Referrer-Policy: no-referrer` trên **phản hồi điều hướng thật** ở `/vi/share`,
   `/en/share` và trên 307 của `/share`, kèm thẻ `<meta name="referrer" content="no-referrer">`;
   chứng minh khi fetch hoặc click link ra domain ngoài thì header `Referer` rỗng, không rò `#d=`.
3. Thêm ca hồi quy RLS `TestRLSRegressionCrossTenantStoreMethods` trong `api/internal/store/tenant_rls_test.go`:
   các method tầng store (`ReplaceCloudProject`, `DeleteCloudProject`, `GetCloudProject`) kết nối
   bằng role chủ non-superuser (chân dung Neon) không rò cross-tenant, **và** một phép khẳng định
   không lọc `owner_id` để thật sự phụ thuộc RLS (xem mục Review bên dưới).

File chính:
- `web/e2e/share-security.spec.ts` (6 kịch bản E2E Playwright)
- `web/next.config.ts` (`Referrer-Policy: no-referrer` cho `/:locale(vi|en)/share` và `/share`)
- `web/src/app/[locale]/share/page.tsx` (`referrer: "no-referrer"` trong Metadata cho thẻ meta DOM)
- `api/internal/store/tenant_rls_test.go` (`TestRLSRegressionCrossTenantStoreMethods`)

## Kết quả kiểm tra (số thật bằng máy, phiên review chạy lại)

- E2E Playwright (`npx playwright test e2e/share-security.spec.ts`): **6/6 PASS**; lặp
  `--repeat-each=3` hai lượt: **18/18 PASS** (12,4 s mỗi lượt) ⇒ AC6 không flake.
- RLS (`RLS_TEST_DSN=postgres://postgres:t150@localhost:54492/app go test ./internal/store/... -run RLS -v`,
  PostgreSQL 18-alpine Docker): **10/10 PASS**.
- Backend: `go vet ./...` sạch; `go test ./...` **7/7 package ok**.
- Frontend: `npm run check` **1456 passed / 18 skipped** (117 file), lint 0 error, `tsc` sạch;
  `npm run build` **PASS**.
- `curl -D - http://localhost:3128/share` → `307` kèm `Referrer-Policy: no-referrer`.

## Review độc lập (2026-11-22) — 3 lỗi đã sửa

Chi tiết đầy đủ ở `_bmad-output/SP023/STR105/Task156/review_task156.md`. Tóm tắt:

| Lỗi | Mức | Nội dung | Sửa |
|---|---|---|---|
| R1 | Trung bình | `next.config.ts` bị đổi `turbopack.root` sang nhánh `process.platform === "win32" ? path.resolve("/") : ...` — ngoài phạm vi task và **vô nghĩa** (trên Windows cả hai vế đều ra `C:\`) | Revert về `path.resolve(process.cwd(), "../../..")`; build lại PASS |
| R2 | Trung bình | Test hồi quy mới **không thực sự phụ thuộc RLS**: ba hàm store đều có `owner_id = $2` nên vẫn xanh khi RLS tắt. Đột biến `NO FORCE` cho thấy dữ liệu chéo vẫn đọc được | Thêm bước 5: truy vấn **không lọc owner** qua `WithTenant(An)` phải trả 0 hàng. Đột biến `NO FORCE` ⇒ thấy 1 hàng, tức phép mới đỏ đúng lúc |
| R3 | Thấp | AC3 kiểm header bằng `page.request.get` (request phụ), không phải phản hồi tài liệu mà trình duyệt nhận | Đổi sang `page.goto()` + `response.headers()["referrer-policy"]` cho cả vi và en |

## Chưa làm được

Không có.

## Phát sinh

Không phát sinh lỗi mới. Hai điểm ghi nhận **không** thuộc phạm vi task, đã ghi `SP999`
(từ Task155): route cloud thiếu rate limit; snapshot không giới hạn số tab.

## Việc tiếp theo cần biết

Epic SP023 đóng sau Task155. Ba lớp bảo vệ referrer hiện có: header ở `next.config.ts` cho
`/:locale(vi|en)/share` và `/share` (phủ cả 307), cộng `<meta name="referrer">` trong Metadata.
Đừng bỏ entry `/share`: nó là thứ duy nhất phủ phản hồi chuyển hướng của đường dẫn không có locale.
