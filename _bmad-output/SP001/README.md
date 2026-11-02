# SP001: Nền móng

Kết quả: repo chạy được, CI kiểm tra được, giao diện có chuẩn, và một luồng mỏng đi từ dán SQL đến kết luận gắn nhãn.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR001 Khung repo | Task001 | Khung `web/` | Không | 1 |
| STR001 Khung repo | Task002 | Khung `api/` | Không | 1 |
| STR001 Khung repo | Task003 | CI GitHub Actions | Task001, Task002 | 2 |
| STR002 Hệ thống giao diện | Task004 | Mẫu HTML để chủ dự án duyệt | Không | 1 |
| STR002 Hệ thống giao diện | Task005 | `DESIGN.md`, `EXPERIENCE.md`, token | Task001, Task004 đã duyệt | 3 |
| STR002 Hệ thống giao diện | Task006 | Khung ứng dụng, tab engine | Task005, Task007 | 4 |
| STR003 Hai ngôn ngữ | Task007 | i18n, kiểm tra thiếu bản dịch | Task001 | 2 |
| STR004 Hợp đồng chung | Task008 | Kiểu `Conclusion`, `EngineAdapter`, lỗi API | Task001 | 2 |
| STR005 Gin và deploy | Task009 | Gin: lỗi, log an toàn, Docker | Task002 | 2 |
| STR005 Gin và deploy | Task010 | Deploy Vercel, Render, giữ thức | Task007, Task009, tài khoản của chủ dự án | 3 |
| STR006 Luồng mỏng | Task011 | Dán SQL, PGlite chạy, hiện kết luận | Task003, Task007, Task008 | 3 |

## Các file bị đụng theo đợt

Các task cùng đợt không sửa chung file.

| Đợt | Task | File |
|---|---|---|
| 1 | Task001 | `web/**` |
| 1 | Task002 | `api/**` |
| 1 | Task004 | `_bmad-output/SP001/STR002/Task004/**` |
| 2 | Task003 | `.github/workflows/ci.yml` |
| 2 | Task007 | `web/messages/**`, `web/src/i18n/**`, `web/src/app/**`, `web/src/components/language-switcher.tsx`, `web/scripts/**`, `web/next.config.ts`, `web/package.json`, cấu hình ESLint |
| 2 | Task008 | `web/src/contracts/**` |
| 2 | Task009 | `api/**` |
| 3 | Task005 | `DESIGN.md`, `EXPERIENCE.md`, `web/src/app/globals.css` |
| 3 | Task010 | `render.yaml`, `.github/workflows/keep-awake.yml`, `web/next.config.ts` |
| 3 | Task011 | `web/src/app/[locale]/lab/**`, `web/src/modules/lab/**`, `web/src/engines/**`, `web/messages/*/lab.json`, `web/playwright.config.ts`, `web/e2e/**`, `.github/workflows/ci.yml`, `web/package.json` |
| 4 | Task006 | `web/src/app/[locale]/layout.tsx`, `web/src/components/shell/**`, `web/messages/*/shell.json` |
