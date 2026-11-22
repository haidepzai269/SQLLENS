# Bàn giao Task155

Đã làm: Chạy một lượt kiểm bảo mật theo skill `security-audit` trên **diff thật** của toàn Epic
(`Task143`–`Task154`, 149 file, +20.277/−165) và viết báo cáo
`_bmad-output/SP023/STR105/bao-cao-security-audit.md`.

Báo cáo gồm 7 mục: phạm vi, cách chạy + bằng chứng môi trường, bảng 15 hạng mục đã kiểm với kết quả,
danh sách phát hiện (file:dòng + cách tái hiện), phần Core Rule 7 với grep chạy offline, checklist
AC1–AC6 và kết luận.

## Kết quả chính

- **Không có lỗi mức critical/high** trong phạm vi. Auth cloud bắt buộc session + kiểm `Origin`,
  `owner_id` chỉ đến từ session, RLS chặn cross-tenant ở role chủ non-superuser (chứng minh bằng
  đột biến bỏ `FORCE`), nội dung share chỉ nằm trong fragment và không rò qua referrer, log không
  chứa SQL.
- **F1 (trung bình)**: route cloud không có rate limit/abuse, trần body 3 MB → tốn CPU/RAM Gin +
  I/O Neon, chặn bằng một luật quota mới (đã ghi `SP999`).
- **F2 (`needs_validation`)**: trần dung lượng cloud 50 dự án × 2 MB ≈ 100 MB/user, không có trần
  tổng; tác động phụ thuộc gói Neon nên chờ chủ dự án chốt (đã ghi `SP999`).
- **F3 (thấp)**: `validateSnapshotStructure` không giới hạn số tab; link 32 KB tạo được ~1.400 tab
  khi Fork (đã ghi `SP999`).
- **Core Rule 7: đúng.** Grep chạy trong `docker run --network none`: 0 lời gọi log nhắc tới
  sql/query/body/tab; handler cloud chỉ log `%T`; `store` không log gì; client không `console` trong
  module cloud/share; CSS share/print không có URL ngoài.

## Cách chạy (để tái lập)

```bash
# 1. Phân tích tĩnh, tắt mạng thật
docker run --rm --network none -v "C:/SQLLens:/src:ro" -w /src postgres:18-alpine sh -c '<grep như mục 5>'

# 2. Kiểm động localhost
docker run -d --rm --name sqllens-rls -e POSTGRES_PASSWORD=t150 -e POSTGRES_DB=app -p 54492:5432 postgres:18-alpine
cd api && RLS_TEST_DSN="postgres://postgres:t150@localhost:54492/app" go test ./... 
cd web && npm run check && API_ORIGIN=http://localhost:8080 npm run build
npx playwright test e2e/share-security.spec.ts e2e/share-run.spec.ts
```

## Chưa làm được

- AC1 chỉ đạt **một phần** theo nghĩa chặt: phân tích tĩnh chạy trong container `--network none`
  (đã kiểm `ip route` rỗng), nhưng toolchain Go/Node chạy trên host. Đã ghi rõ trong báo cáo mục 1,
  không ghi là "toàn bộ audit chạy trong Docker tắt mạng".
- Chưa quét phụ thuộc (`npm audit`) và chưa pentest động ngoài các ca đã có trong bộ test; hai việc
  này không thuộc phạm vi task và đã có dòng riêng từ Task001 ở `SP999`.

## Phát sinh

Không phát sinh lỗi chặn Epic. Ba việc còn lại đã vào `SP999` kèm mức và lý do.

## Kết luận

**Được đóng Epic SP023 (Cloud sync & RLS)** sau khi Task156 đã qua review độc lập và sửa 3 lỗi.
