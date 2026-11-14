# Task119: Client-Side Safe EXPLAIN & 40-Token AST Plan Minifier

Thuộc: SP018 / STR086
Mục tiêu: Xây dựng cơ chế chạy `EXPLAIN (ANALYZE, BUFFERS)` cục bộ an toàn trong PGlite bọc `BEGIN...ROLLBACK` (timeout 1.5s), bộ nén AST Plan lọc node cốt lõi xuống dưới 40 tokens và React Hook trích xuất plan của câu lệnh tại con trỏ.

Phạm vi:
- `web/src/engines/postgres/safe-explain.ts`
- `web/src/engines/postgres/safe-explain.test.ts`
- `web/src/modules/plan-runner/minifier/plan-minifier.ts`
- `web/src/modules/plan-runner/minifier/plan-minifier.test.ts`
- `web/src/modules/mentor/hooks/use-active-query-plan.ts`

Không làm:
- Không sửa giao diện người dùng (Linh kiện UI thuộc Task121).
- Không sửa backend Gin (Gin API thuộc Task120).
- Không chạy EXPLAIN cho câu lệnh lỗi cú pháp hoặc rỗng.

Hợp đồng:
- `runSafeExplainAnalyze(db: PGlite, sql: string, timeoutMs?: number): Promise<Record<string, unknown> | null>`: Thực thi câu lệnh trong giao dịch tự hủy, trả về raw Plan object hoặc null nếu lỗi/timeout.
- `minifyPlanJson(rawPlan: unknown): string`: Nén JSON kế hoạch thực thi thành chuỗi tóm tắt 1-2 dòng (ước lượng <= 45 tokens cho câu đơn, <= 80 tokens cho câu JOIN).
- `useActiveQueryPlan(options: { editorContent: string; cursorOffset: number; enabled?: boolean }): { planEvidence: string | null; isMeasuring: boolean }`: Hook tự động debounce 300ms trích xuất câu lệnh tại con trỏ và trả về chuỗi bằng chứng nén.

Tiêu chí xong:
- AC1: `runSafeExplainAnalyze` bọc chính xác trong khối `BEGIN; EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <sql>; ROLLBACK;`. Dữ liệu các bảng trong sandbox giữ nguyên 100% kể cả với câu lệnh `DELETE` hay `UPDATE`.
- AC2: Có cơ chế timeout an toàn 1.500ms; nếu câu lệnh chạy quá thời gian (ví dụ Cartesian product), tự động ngắt và trả về `null` không làm đóng băng Web Worker.
- AC3: `minifyPlanJson` bóc tách chính xác các trường: Node Type, Relation Name, Index Name, Actual Rows, Estimated Rows, Shared Hit Buffers, Shared Read Buffers, Filter / Index Cond.
- AC4: Chuỗi định dạng đầu ra chuẩn mực:
  `[PLAN_EVIDENCE: <Node Type> on <Relation> | Actual Rows: <X> (Est: <Y>) | Buffers: <H> hit, <R> read | Filter: <Cond>]`.
- AC5: Đảm bảo số lượng token ước tính không vượt quá 45 tokens cho câu đơn và không quá 80 tokens cho câu đa tầng join.
- AC6: Hook `useActiveQueryPlan` chỉ kích hoạt khi câu lệnh tại con trỏ thuộc danh mục `EXPLAINABLE` (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`), bỏ qua khi editor rỗng.
- AC7: Unit test bao phủ các kịch bản: Seq Scan, Index Scan, Bitmap Heap Scan, Hash Join, Rollback an toàn dữ liệu, Timeout đạt 100% PASS.

Ca biên: Câu lệnh chứa dấu chấm phẩy lồng nhau; subquery lồng 3 cấp; bảng rỗng không có dòng; câu lệnh DDL (`CREATE TABLE`) bị từ chối an toàn.
Kiểm tra: `npm run check` và `npx vitest run web/src/engines/postgres/safe-explain.test.ts web/src/modules/plan-runner/minifier/plan-minifier.test.ts`.
Đọc thêm: `_bmad-output/SPEC_AI_PLAN_EVIDENCE.md` mục 4.1 và 4.2.
