# Bàn giao Task156

Đã làm: Khóa hai rủi ro bảo mật trọng yếu của đợt chia sẻ và cloud sync: (1) Kiểm thử bảo mật E2E Playwright trên Chromium thật chống tấn công XSS trong SQL, tab name, project name (`<img onerror>`, `<script>`, `javascript:`, `</textarea>`), mở trong iframe, và fork vào workspace — 0 dialog alert, không inject HTML DOM, dữ liệu hiển thị an toàn dưới dạng raw text; (2) Kiểm tra chặt chẽ header HTTP `Referrer-Policy: no-referrer` và thẻ `<meta name="referrer" content="no-referrer">`, chứng minh khi fetch hoặc click link ra domain ngoài thì header Referer hoàn toàn rỗng và không rò rỉ fragment `#d=`; (3) Thêm ca hồi quy RLS `TestRLSRegressionCrossTenantStoreMethods` trong `api/internal/store/tenant_rls_test.go` khẳng định các method tầng store (`ReplaceCloudProject`, `DeleteCloudProject`, `GetCloudProject`) kết nối bằng role chủ non-superuser (chân dung Neon) chặn đứng 100% truy cập trái phép cross-tenant.

File chính:
- `web/e2e/share-security.spec.ts` (6 kịch bản E2E Playwright)
- `web/next.config.ts` (bảo vệ kép `Referrer-Policy: no-referrer` cho cả `/:locale(vi|en)/share` và `/share`)
- `web/src/app/[locale]/share/page.tsx` (thêm `referrer: "no-referrer"` vào Metadata cho thẻ meta DOM)
- `api/internal/store/tenant_rls_test.go` (thêm test hồi quy `TestRLSRegressionCrossTenantStoreMethods`)

Kết quả kiểm tra (số thật bằng máy):
- E2E Playwright (`npx playwright test e2e/share-security.spec.ts`): 6/6 test PASS 100%. Chạy lặp 3 lần liên tiếp đạt chuẩn AC6 không flake: Lần 1 (8.5s), Lần 2 (12.8s), Lần 3 (11.1s).
- RLS Tests (`go test ./internal/store/... -run RLS -v` với PostgreSQL 18.6 Docker): 9/9 test PASS 100% trong 10.58s (toàn bộ 8 test gốc của Task152 + ca hồi quy mới của Task156).
- Toàn bộ backend Gin: `go vet ./...` sạch; `go test ./...` 7/7 package PASS 100%.
- Toàn bộ frontend Next.js: `npm run check:i18n` sạch, `npm run typecheck` sạch, `npm run lint` sạch (0 error), `npm run test` vitest 117 file / 1.452 test PASS (18 skipped), `npm run build` PASS tối ưu production.

Kết quả review: Sẵn sàng cho Agent DeepSeek review độc lập (Commit gốc: `dc12ee0`, Commit hiện tại: `9aa4035`).

Chưa làm được: Không có.

Phát sinh: Không có.

Việc tiếp theo cần biết: Route `/share` đã được bọc 2 lớp bảo vệ referrer (HTTP header trong `next.config.ts` và `<meta name="referrer">` trong Metadata) nên mọi navigation ra ngoài đều không phát sinh rò rỉ payload fragment. Sau khi Task156 nghiệm thu, toàn bộ Epic SP023 (Cloud sync & RLS) chính thức hoàn thành 100%.
