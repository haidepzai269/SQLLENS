# Bàn giao Task010

Đã làm: phần cấu hình và kiểm trên máy. Chưa deploy được vì agent không có quyền vào Vercel và Render. `web/next.config.ts` có `rewrites` chuyển `/api/:path*` đến `${API_ORIGIN}/:path*`. Build production thiếu `API_ORIGIN` báo lỗi rõ, giá trị có path, `?` hoặc `#` cũng báo lỗi. Dev và test cục bộ mặc định `http://localhost:8080`. `render.yaml` (Docker, free, `rootDir: api`, `healthCheckPath: /healthz`). `keep-awake.yml` (cron `*/10 0-16 * * *` UTC, `permissions: {}`, `curl --fail --max-time 120 --retry 2`, thiếu `API_HEALTH_URL` thì job đỏ). `ci.yml` thêm `API_ORIGIN` giả cho hai bước build.
File chính: `web/next.config.ts`, `render.yaml`, `.github/workflows/keep-awake.yml`, `.github/workflows/ci.yml`.
Kết quả kiểm tra (chạy thật): `actionlint` (Docker `rhysd/actionlint`) sạch. `npm run build` không có `API_ORIGIN` thoát lỗi "API_ORIGIN is required for build". AC3: build với giá trị thử, `grep -r` trong `web/.next/static` không thấy; giá trị chỉ nằm trong `routes-manifest.json` phía server. Gin chạy local cổng 18080, `next start` cổng 3110: `/api/healthz` trả 200 `{"status":"ok"}`, `/vi` trả 200, `/api/nope` trả 404 JSON của Gin. `npm run check` đạt. CI trên GitHub xanh ở 5df013a.
Kết quả review: task-reviewer mới, 0 lỗi confirmed, 3 needs_validation, kiểm lại 1 vòng, không còn lỗi. Đã sửa 2 (regex chặn `?` `#`; `dockerfilePath ./api/Dockerfile` kèm `dockerContext ./api`). Còn lại: phát hiện build bằng `process.argv.includes("build")` có thể rơi về localhost nếu Vercel nạp config theo cách khác. AC1 sẽ lộ ngay nếu sai. Không dùng `NEXT_PHASE` vì không có lúc nạp config (đã thử). Cách `dockerfilePath` tính với `rootDir` chưa xác nhận, nếu Render báo không thấy Dockerfile thì bỏ `rootDir` và giữ hai đường dẫn hiện tại, hoặc bỏ tiền tố `api/` trong `dockerfilePath`.
Chưa làm được (chờ chủ dự án deploy): AC1, AC2, AC4, AC6, AC7. Không có số đo trễ cron.
Phát sinh: (1) `compress: false` của Task014 chưa đưa vào `web/next.config.ts`; cần cho `next start` tự host, trên Vercel nén do nền tảng làm, AC7 sẽ cho biết. (2) `HEAD /healthz` trả 405 (từ Task009), keep-awake dùng GET nên không ảnh hưởng. (3) GitHub tắt workflow theo lịch sau 60 ngày repo không có hoạt động (nếu repo public). (4) `next start` thiếu `API_ORIGIN` lúc chạy vẫn rơi về localhost:8080.

## Thao tác cho chủ dự án

Render:
1. Vào dashboard.render.com, chọn New, rồi Blueprint, nối repo GitHub `haidepzai269/SQLLENS`, chọn branch `main` (hoặc `task/Task010` để thử trước), Render đọc `render.yaml` và tạo dịch vụ `sqllens-api`.
2. Nếu không dùng Blueprint: New, Web Service, chọn repo, Language là Docker, Root Directory là `api`, Instance Type là Free, mục Health Check Path điền `/healthz`.
3. Chờ deploy xong, ghi lại URL dạng `https://sqllens-api.onrender.com`, rồi chạy `curl -i https://<render>/healthz` và kiểm trả 200.

Vercel:
4. Vào vercel.com, Add New Project, nhập repo GitHub, đặt Root Directory là `web`, Framework là Next.js.
5. Trong Settings, Environment Variables, thêm `API_ORIGIN` bằng URL Render ở bước 3, không có dấu `/` cuối, áp cho Production và Preview. Không thêm tiền tố `NEXT_PUBLIC_`.
6. Deploy (hoặc Redeploy nếu đã deploy trước khi có biến). Ghi lại domain Vercel.

GitHub:
7. Vào repo, Settings, Secrets and variables, Actions, tab Variables, New repository variable, tên `API_HEALTH_URL`, giá trị `https://<render>/healthz`.
8. Vào tab Actions, chọn workflow `keep-awake`, bấm Run workflow (cần workflow có trên default branch, nên làm sau khi merge vào `main`). Job phải xanh.

## Lệnh cho phiên chính sau deploy (thay `<vercel>`)

```
curl -s -w '\n%{http_code}\n' https://<vercel>/api/healthz        # AC1: 200 và {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' https://<vercel>/vi      # AC2: 200
curl -s https://<vercel>/en | grep -o '<html[^>]*>'                # AC6: lang="en"; đối chiếu chữ trong messages/en
gh workflow run keep-awake.yml && gh run list --workflow keep-awake.yml -L1   # AC4
curl -s -o /dev/null -w '%{http_code}\n' https://<vercel>/api/nope   # kỳ vọng 404 JSON của Gin
```
AC7: làm theo "AC4" trong `_bmad-output/SP002/STR008/Task014/ket_qua.md`; nếu Vercel gom stream thì thử Route Handler proxy và ghi so sánh.

Việc tiếp theo cần biết: đổi domain Render thì cập nhật cả `API_ORIGIN` (Vercel) và `API_HEALTH_URL` (GitHub), rồi Redeploy Vercel vì `API_ORIGIN` được nướng vào lúc build.
