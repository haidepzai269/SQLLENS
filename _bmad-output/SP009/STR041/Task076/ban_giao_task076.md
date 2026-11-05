# Bàn giao Task076

Đã làm: `PlanNode` có thêm `filter`. `condition` chỉ còn là điều kiện dùng để tìm trong index hoặc để nối. Bằng chứng của `findings` chỉ cho màu xanh khi `condition` của nút index nhắc đúng cột của luật. Đã bỏ comment `shortcut:` của Task069. Chi tiết nút trong cây plan có thêm dòng "Bộ lọc", gói bằng chứng của Mentor chép và cắt `filter`.

Quyết định cho từng loại (PostgreSQL, `postgres.ts`):
- Index Cond, Recheck Cond, Hash Cond, Merge Cond: vào `condition`, lấy cái đầu tiên theo thứ tự này.
- Join Filter và Filter: vào `filter`, nối bằng " AND " nếu nút có cả hai.
- Bitmap Heap Scan có Recheck Cond và Filter cùng lúc: Recheck vào `condition`, Filter vào `filter`.
MySQL (`mysql.ts`): `index_condition` vào `condition`. `attached_condition` vào `filter`, trừ bảng nối bằng hash join (`using_join_buffer` có "hash") thì là điều kiện nối, vào `condition` như Hash Cond.

File chính: `web/src/contracts/plan.ts`, `web/src/modules/plan-runner/normalize/{postgres,mysql}.ts`, `web/src/modules/findings/evidence/index.ts`, `web/src/modules/plan-runner/plan-tree/plan-tree-flow.tsx`, `web/src/modules/mentor/evidence/buildEvidencePack.ts`, `web/messages/{vi,en}/plan-tree.json`.

Kết quả kiểm tra:
- `npm run check` thoát 0 (lint, typecheck, 466 test đạt, 16 bỏ qua) ở commit 7f11c14. Sau sửa MySQL chạy lại `vitest` cho plan-runner và findings (105 đạt), `tsc --noEmit` và `eslint` sạch.
- `E2E_PORT=3176 npx playwright test e2e/plan-explain.spec.ts e2e/findings.spec.ts --workers=1`: 15 đạt. Server đã tắt. Ảnh Task069 bị spec ghi đè đã `git checkout`, không commit.
- AC2 chạy thật trên PGlite, không cần ép `enable_*`: với 20.000 dòng có PK, planner tự chọn Index Scan `users_pkey`, không có Index Cond, Filter chứa `email`. Kết quả `unverified`, câu `indexUnrelated`. Test có assert tiền đề này, planner đổi kế hoạch thì test báo.
- AC3: `email = 'u77'` ra `not_broken`, test thật.

Kết quả review: 1 reviewer (sonnet), góc nhãn và hành vi PostgreSQL. Không lỗi chặn. 1 mục needs_validation (hash join MySQL) đã sửa và thêm test. Test cho `index_condition` đã thêm. Chưa có test riêng cho `filter` trong `buildEvidencePack`. Chưa review lại vòng 2.

Chưa làm được: `Tid Cond`, `One-Time Filter` chưa xử lý (trước task cũng không).
Phát sinh: cột có tiền tố `alias.col` trong `condition` vẫn không khớp, nghiêng về `unverified` (đã có test). Test `buildEvidencePack` cho `filter`.
Việc tiếp theo cần biết: chỗ nào đọc `condition` để biết "index dùng cột nào" phải bỏ qua `filter`. Task075 (adapter MySQL) dùng cùng quy ước.
