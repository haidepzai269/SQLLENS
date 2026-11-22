# Review độc lập Task156 (kiểm referrer/XSS của share và hồi quy RLS)

Người review: phiên chính (Buffy). Ngày: 2026-11-22.
Commit được review: `9aa4035` + `37e6d65` (nhánh `task/Task156`, merge vào `main` ở `c7b07fb`).

## 1. Đã chạy lại bằng máy (không tin lời bàn giao)

| Việc | Lệnh | Kết quả |
|---|---|---|
| E2E share security | `E2E_PORT=3126 npx playwright test e2e/share-security.spec.ts` | **6/6 PASS** (9,2 s) |
| Chống flake AC6 | `--repeat-each=3` | **18/18 PASS** (12,2 s), 2 lượt độc lập |
| Toàn bộ frontend | `npm run check` | **1456 passed / 18 skipped**, 117 file; lint 0 error, tsc sạch |
| Build production | `API_ORIGIN=http://localhost:8080 npm run build` | **PASS** |
| Toàn bộ backend | `go vet ./...` + `go test ./...` | **7/7 package ok** (kèm `RLS_TEST_DSN`) |
| RLS chạy thật | `RLS_TEST_DSN=postgres://postgres:t150@localhost:54492/app go test ./internal/store/... -run RLS -v` | **10/10 PASS** (PostgreSQL 18-alpine) |
| Header `/share` (bare) | `curl -D - http://localhost:3128/share` | 307 → `/vi/share`, **có** `Referrer-Policy: no-referrer` |

Ghi chú quan trọng: thêm entry `source: "/share"` trong `next.config.ts` **không phải** cấu hình chết.
`/share` là 307 do middleware next-intl trả về, và chính entry đó làm header có mặt trên phản hồi
chuyển hướng (đo bằng `curl`). Giữ nguyên.

## 2. Lỗi tìm được và đã sửa

### R1 — Trung bình: sửa `turbopack.root` không liên quan task, và là nhánh vô nghĩa

`web/next.config.ts` bị đổi thành:

```ts
root: process.platform === "win32" ? path.resolve("/") : path.resolve(process.cwd(), "../../.."),
```

- Trên Windows hai vế **cho cùng một giá trị**: `path.resolve("C:\\SQLLens\\web", "../../..")` = `C:\`
  và `path.resolve("/")` = `C:\`. Trên Linux/macOS vế phải giữ nguyên như cũ. Tức là **không thay đổi
  hành vi gì**, chỉ thêm một nhánh theo nền tảng.
- Ngoài phạm vi Task156 (phạm vi chỉ cho `next.config.ts` khi header referrer chưa đúng), và nếu ai
  sau này đọc tưởng đây là yêu cầu của Windows thì dễ bị dẫn dắt sai (Turbopack trỏ vào gốc ổ đĩa).

**Sửa:** revert về `path.resolve(process.cwd(), "../../..")`. Build lại **PASS**, E2E **18/18 PASS**.

### R2 — Trung bình: test hồi quy RLS mới không thực sự phụ thuộc RLS

`TestRLSRegressionCrossTenantStoreMethods` khẳng định `GetCloudProject` / `DeleteCloudProject` /
`ReplaceCloudProject` không rò cross-tenant. Nhưng cả ba hàm đều có sẵn mệnh đề `owner_id = $2`
(`api/internal/store/cloud.go:207,256,299`), nên **chúng chặn được cả khi RLS tắt**. Bàn giao ghi
test này "chặn đứng 100% truy cập trái phép cross-tenant" và xếp nó như bằng chứng RLS — chưa đúng.

Bằng chứng bằng đột biến (đã chạy rồi xoá file probe): dựng database như test, chạy
`ALTER TABLE public.cloud_projects NO FORCE ROW LEVEL SECURITY`, rồi đếm dự án của Bình trong ngữ
cảnh tenant của An với câu **không lọc owner**:

```
NO FORCE => ngữ cảnh An thấy 1 hàng của dự án Bình
```

Nghĩa là nếu RLS hỏng thì ba lời gọi store vẫn xanh, và test sẽ báo "an toàn" trong khi lớp RLS đã
mất. Đây đúng là loại test "không thể đỏ" mà các vòng review trước đã bắt.

**Sửa** (`api/internal/store/tenant_rls_test.go`, thêm bước 5): sau các assert cũ, chạy thêm một
truy vấn **không có mệnh đề owner** qua `WithTenant(An)` và bắt buộc `count = 0`. Phép này phụ thuộc
RLS thật: bỏ `FORCE` là thấy 1 hàng (đã chứng minh bằng đột biến ở trên). Chạy lại: **PASS**.

### R3 — Thấp: AC3 chỉ kiểm header qua request phụ, không kiểm tài liệu trình duyệt nhận

Test cũ dùng `page.request.get("/vi/share")` — cùng route nhưng là request rời của APIRequestContext,
không phải phản hồi đã điều hướng tới tài liệu. Header đúng ở đó **không chứng minh** tài liệu thật
có header (ví dụ một proxy/route group thêm header chỉ cho request không phải navigation).

**Sửa** (`web/e2e/share-security.spec.ts`): dùng `page.goto()` và đọc
`response.headers()["referrer-policy"]` cho cả `/vi/share` và `/en/share`, giữ nguyên phần kiểm thẻ
`<meta name="referrer">`. Chạy lại: **6/6 PASS**.

## 3. Những gì giữ nguyên (đã kiểm, không phải lỗi)

- Payload độc hại trong SQL, tên tab, tên dự án (`<img onerror>`, `<script>`, `javascript:`,
  `</textarea>`) không tạo node HTML, không bật dialog; editor hiện đúng text. Test **có thể đỏ**:
  nếu `ReadonlyWorkspace` đổi sang `dangerouslySetInnerHTML` thì `#evil-proj-node` sẽ xuất hiện.
- `Referrer-Policy: no-referrer` có trên `/vi/share`, `/en/share` và trên 307 của `/share`.
- Không rò `Referer` khi fetch/no-cors hoặc click link ra domain ngoài (bắt bằng `page.route`).
- Fork snapshot rồi vào workspace không làm script chạy.

## 4. Kết luận

Task156 sau sửa: **đạt**. Ba lỗi trên đều đã sửa và có bằng chứng chạy lại. Không còn lỗi mức cao
nào của riêng task này.
