# Bàn giao Task078

Đã làm: Thể hiện trực quan cuộc đua giữa Seq Scan và Index Scan bằng số dòng và số trang đã đọc (không dùng thời gian), và làm cây B-Tree tối đi khi query không dùng được index.
File chính: `web/src/modules/btree-reader/race/btree-race.tsx`, `web/src/modules/btree-reader/anim/btree-drop.tsx`, `web/src/modules/btree-reader/view/btree-view.tsx`, `web/src/modules/lab/stage/stage.tsx`, `web/e2e/btree-race.spec.ts`.
Kết quả kiểm tra: `npm run check` (i18n, lint, typecheck, 506 vitest unit tests pass), `npm run build` (51 static pages), `npx playwright test btree-race.spec.ts` (6/6 tests pass trên 1440px, 390px và reduced motion).
Kết quả review: Reviewer task-reviewer độc lập xác nhận PASS 7/7 AC, không phát hiện lỗi (0 confirmed, 0 needs_validation).
Chưa làm được: MySQL chưa dựng cây thật (thuộc STR034 theo lộ trình sau).
Phát sinh: Không có.
Việc tiếp theo cần biết: Component `BTreeRace` nhận `pagesRead` và `actualRows` từ `Plan`, thanh đo tỷ lệ tự động thích ứng với chênh lệch quy mô lớn nhờ `minWidth: 4px`. Tab B-Tree tự động đồng bộ trạng thái dimmed khi `run.select` quét toàn bảng.
