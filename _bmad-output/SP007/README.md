# SP007: `plan-runner`

Kết quả: Người dùng thấy sơ đồ bảng, cây plan thật của câu query, và animation join theo plan thật.

Hợp đồng chung: `web/src/contracts/plan.ts` (`Plan`, `PlanNode`), chốt trước khi chia task để các task chạy song song.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR029 Chuẩn hóa plan | Task046 | `explain` của PGlite và bộ chuyển `EXPLAIN` MySQL về `Plan` | Không | 1 |
| STR030 Sơ đồ bảng | Task047 | React Flow, thẻ shadcn/ui, dagre | Không | 2 |
| STR031 Cây plan | Task048 | React Flow, bấm một bước mở chi tiết | Không | 2 |
| STR032 Animation join | Task049 | Nested Loop, Hash Join, Merge Join trên mẫu minh họa | Không | 3 |

Gắn sơ đồ và cây vào vùng `stage` làm ở task riêng sau khi Task044 và Task045 xong, vì cùng sửa `web/src/modules/lab/**`.

## Các file bị đụng

| Task | File |
|---|---|
| Task046 | `web/src/engines/postgres/explain*`, `worker.ts`, `protocol.ts`, `adapter.ts`, `web/src/contracts/engine.ts`, `web/src/modules/plan-runner/normalize/**`, `web/e2e/plan-explain.spec.ts` |
| Task047 | `web/src/modules/plan-runner/schema-diagram/**`, `web/src/app/[locale]/e2e-schema/**`, `web/messages/*/schema-diagram.json`, `web/e2e/schema-diagram.spec.ts` |
| Task048 | `web/src/modules/plan-runner/plan-tree/**`, `web/src/app/[locale]/e2e-plan/**`, `web/messages/*/plan-tree.json`, `web/e2e/plan-tree.spec.ts` |
| Task049 | `web/src/modules/plan-runner/join-anim/**`, `web/src/app/[locale]/e2e-join/**`, `web/messages/*/join-anim.json`, `web/e2e/join-anim.spec.ts` |
