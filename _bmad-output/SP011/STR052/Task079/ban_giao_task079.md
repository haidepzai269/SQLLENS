# Bàn giao Task079

Đã làm: Tiêu chí hỏng tùy biến cho kịch bản tranh chấp (Conflict Sim theo STR052). Cho phép người dùng xem câu lệnh SELECT và điều kiện hỏng mặc định của 5 kịch bản mẫu, tùy biến câu SELECT và toán tử so sánh (=, <>, >, <, >=, <=) và ngưỡng số, bật/tắt tiêu chí để chỉ quan sát deadlock và chờ khóa, có nút khôi phục mặc định và hiển thị kết quả trực quan.
File chính:
- `web/src/modules/conflict-sim/engine/types.ts`
- `web/src/modules/conflict-sim/engine/simulate.ts`
- `web/src/modules/conflict-sim/engine/simulate.test.ts`
- `web/src/modules/conflict-sim/golden/golden.test.ts`
- `web/src/modules/conflict-sim/ui/model.ts`
- `web/src/modules/conflict-sim/ui/model.test.ts`
- `web/src/modules/conflict-sim/ui/conflict-panel.tsx`
- `web/messages/{vi,en}/conflictSim.json`
- `web/e2e/conflict-criteria.spec.ts`

Kết quả kiểm tra:
- `npm run check:i18n`, `npm run lint`, `npm run typecheck`: PASS 100% (0 lỗi).
- `npm run test` (vitest): 43 test files passed, 512 tests passed, 0 failures.
- `npm run build`: PASS 100% (51 static pages compiled).
- Playwright E2E: `e2e/conflict-criteria.spec.ts` (20/20 tests passed trên 1440px desktop & 390px mobile), `e2e/conflict.spec.ts` (30/30 tests passed).

Kết quả review:
- Reviewer `task-reviewer` độc lập thẩm định commit `e2ac82a`: PASS 8/8 AC, 0 lỗi confirmed, 0 lỗi needs_validation.
- Tuân thủ nghiêm ngặt các nguyên tắc cốt lõi: nhãn `Mô phỏng` (`simulated`), không bao giờ kết luận "thiết kế ổn" khi không có tiêu chí (`no_criteria`), không ghi log SQL người dùng, chỉ chấp nhận cú pháp `SELECT` hợp lệ và chặn đứng mọi câu lệnh DML/DDL.

Chưa làm được:
- Tranh chấp MySQL hai connection thật (thuộc STR050 sau khi mở cổng sandbox).

Phát sinh: Không có.

Việc tiếp theo cần biết:
- Cấu hình `customCheck` nằm trong `Cfg` của `ConflictPanel`, tự động chuyển tiêu chí mặc định khi đổi kịch bản trong dropdown. Khi tắt tiêu chí (`enabled = false`), engine trả về `outcome: "no_criteria"` nếu không có deadlock hoặc lỗi tuần tự hóa (serialization failure).
