# Bàn giao Task119: Client-Side Safe EXPLAIN & 40-Token AST Plan Minifier

Đã làm:
- Hiện thực hóa bộ nén AST Plan `minifyPlanJson` và hàm ước lượng token `estimateTokens` tại `web/src/modules/plan-runner/minifier/plan-minifier.ts`, nén kế hoạch thực thi PostgreSQL xuống dưới 45 tokens cho câu đơn và dưới 80 tokens cho câu JOIN phức tạp theo chuẩn format `[PLAN_EVIDENCE: <Node Type> on <Relation> | Actual Rows: <X> (Est: <Y>) | Buffers: <H> hit, <R> read | Filter: <Cond>]`.
- Hiện thực hóa module thực thi an toàn `safe-explain.ts` tại `web/src/engines/postgres/safe-explain.ts` gồm Gatekeeper `canExplainSql` và `runSafeExplainAnalyze` bọc truy vấn trong `BEGIN; EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <sql>; ROLLBACK;` kèm timeout an toàn 1.500ms, bảo toàn 100% dữ liệu sandbox ngay cả với các câu lệnh UPDATE, DELETE hay INSERT.
- Xây dựng React Hook `useActiveQueryPlan` tại `web/src/modules/mentor/hooks/use-active-query-plan.ts` tự động trích xuất SQL active tại con trỏ/selection, debounce 300ms và kích hoạt rào chắn an toàn cho MySQL Sandbox (chỉ kích hoạt trên engine Postgres).

File chính:
- `web/src/modules/plan-runner/minifier/plan-minifier.ts` (và unit test `plan-minifier.test.ts`)
- `web/src/engines/postgres/safe-explain.ts` (và unit test `safe-explain.test.ts`)
- `web/src/modules/mentor/hooks/use-active-query-plan.ts` (và unit test `use-active-query-plan.test.ts`)

Kết quả kiểm tra:
- `npm run check:i18n`: PASS 100%.
- `npm run lint`: PASS (0 lỗi, 1 warning pre-existing trong e2e test).
- `npm run typecheck`: PASS (`tsc --noEmit` clean).
- `npx vitest run`: 79 test files passed, 913 tests passed 100% (trong đó 32 unit tests mới thuộc Task119 đạt 100% PASS).

Kết quả review:
- Reviewer độc lập thẩm định PASS 100% ngay từ vòng 1, 0 lỗi cần sửa, không có mục `needs_validation`.

Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết:
- Task120 (STR087) sẽ cập nhật Gin Backend (`POST /ai/chat` và `POST /ai/diagnose`) để nhận trường `evidence_plan` sinh ra từ Hook `useActiveQueryPlan` này và tinh chỉnh System Prompt của AI Mentor theo quy tắc phân nhánh ngữ cảnh.
