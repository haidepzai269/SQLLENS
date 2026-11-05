# Task076: Tách Index Cond khỏi Filter để không tô xanh nhầm

Thuộc: SP009 / STR041
Mục tiêu: Rủi ro chỉ được màu xanh khi index thật sự dùng điều kiện của cột trong luật, không phải khi cột đó chỉ nằm ở Filter của một lần quét index khác.
Phạm vi: `web/src/contracts/plan.ts`, `web/src/modules/plan-runner/normalize/**`, `web/src/modules/plan-runner/plan-tree/**` (chỉ khi cần hiện trường mới), `web/src/modules/findings/evidence/**`.
Không làm: thêm luật, đổi giao diện cột Rủi ro.

Hợp đồng: `PlanNode` thêm `filter?: string` bên cạnh `condition`. `condition` là điều kiện dùng để tìm trong index hoặc join, `filter` là điều kiện lọc sau khi đọc dòng. Chỗ nào đang đọc `condition` phải tìm hết bằng grep và sửa nếu cần.

Tiêu chí xong:
- AC1: `normalizePostgres` lấy `Index Cond`, `Recheck Cond`, `Hash Cond`, `Merge Cond`, `Join Filter` theo đúng nghĩa, và `Filter` vào `filter`. Ghi rõ quyết định cho từng loại vào bàn giao. `normalizeMysql` xử lý `attached_condition` đúng nghĩa, kiểm bằng mẫu MySQL thật đã có trong `samples/`.
- AC2: `WHERE email LIKE '%77' ORDER BY id LIMIT 5` trên bảng lớn có PK: nếu planner chọn Index Scan trên PK thì kết luận không được xanh, phải là `unverified` kèm câu nói rõ quan sát được gì. Dựng plan thật trên PGlite, nếu planner không chọn kế hoạch này thì dùng dữ liệu hoặc `SET enable_*` trong test để ép, và ghi lại.
- AC3: Index Scan có `Index Cond` đúng cột của luật vẫn xanh như trước, có test thật.
- AC4: Bỏ comment `shortcut:` của Task069 trong `evidence/index.ts` sau khi sửa xong.
- AC5: Cây plan vẫn hiện đủ thông tin, có thêm filter nếu trước đây đã mất. `npm run check` thoát 0, `web/e2e/plan-explain.spec.ts`, `web/e2e/findings.spec.ts` đạt với `--workers=1`.

Ca biên: Bitmap Heap Scan với Recheck Cond và Filter cùng lúc, nút join có Join Filter, bí danh bảng, cột có tiền tố `alias.col`.
Kiểm tra: `cd web && npm run check`; `E2E_PORT=3176 npx playwright test e2e/plan-explain.spec.ts e2e/findings.spec.ts --workers=1`.
Góc review thêm: nhãn kết luận, đúng hành vi PostgreSQL.
Đọc thêm: bàn giao Task046, Task068, Task069.
