# SP005: Đăng nhập và quota

Kết quả: Người dùng đăng nhập bằng Google hoặc GitHub. MySQL và AI chỉ mở cho người đã đăng nhập và còn quota. PostgreSQL vẫn dùng tự do. Gin kiểm quyền và quota, không tin frontend.

## Key và biến môi trường

Agent không đọc `KEY_CAN_LAY.md` và không cần giá trị key thật. Test dùng Postgres và Redis chạy trong Docker, và nhà cung cấp OAuth giả bằng `httptest`. Khi deploy, chủ dự án tự đặt giá trị vào Render.

Gin đọc các biến sau, tên do Task041 đến Task043 dùng thống nhất:

| Biến | Nguồn |
|---|---|
| `DATABASE_URL` | Neon |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub |
| `PUBLIC_ORIGIN` | `https://sqllens-bice.vercel.app`, hoặc `http://localhost:3000` khi chạy ở máy |

`rewrites` của Next.js bỏ tiền tố `/api`, nên callback `https://sqllens-bice.vercel.app/api/auth/google/callback` đến Gin ở `/auth/google/callback`.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR021 CSDL của app | Task041 | Migration và lớp lưu tài khoản, phiên đăng nhập | Không | 1 |
| STR023 Quota | Task043 | Middleware quota bằng Upstash REST | Không | 1 |
| STR022 OAuth | Task042 | Đăng nhập, đăng xuất, `/me`, cookie `sid`, kiểm Origin | Task041 | 2 |
| STR022, STR024 | Task044 | Giao diện đăng nhập, cổng MySQL và AI, màn hình hết quota | Task042, Task043, Task027 | 3 |

## Các file bị đụng

| Task | File |
|---|---|
| Task041 | `api/internal/store/**`, `api/migrations/**`, `api/go.mod`, `api/go.sum` |
| Task043 | `api/internal/quota/**` |
| Task042 | `api/internal/auth/**`, `api/internal/httpapi/router.go`, `api/cmd/**`, `render.yaml`, `api/go.mod`, `api/go.sum` |
| Task044 | `web/src/modules/auth/**`, `web/src/components/shell/**`, `web/src/modules/lab/**` (chỉ chỗ gắn cổng), `web/messages/*/auth.json`, `web/e2e/auth.spec.ts` |

Task041 và Task043 chạy song song. Task043 không thêm thư viện Go, gọi Upstash bằng `net/http`, nên không đụng `go.mod`.
