# Bàn giao Task097

Đã làm:
- Mở rộng kiểu `EvidencePack` với `ruleTags` và `compact` flag phục vụ AI Mentor 2.0.
- Bổ sung trường `sortMethod`, `batches`, `cost` cho `PlanNode` và bóc tách từ EXPLAIN của PostgreSQL/MySQL.
- Xây dựng `extractor.ts` trích xuất chính xác 5 RuleTag kỹ thuật từ Plan (`RULE_SORT_DISK_SPILL`, `RULE_MYSQL_FILESORT`, `RULE_HASH_JOIN_SPILL`, `RULE_MISSING_PRIMARY_KEY`, `RULE_ACCIDENTAL_CARTESIAN`) và ánh xạ 8 RuleTag từ Findings tĩnh.
- Xây dựng `compactor.ts` nén cây Plan tối đa 3 tầng theo điểm nghẽn I/O và chi phí, cắt giảm hơn 75% dung lượng JSON (< 3.500 bytes cho plan 100 node) mà không mất thông tin quan trọng.

File chính:
- `web/src/contracts/mentor.ts`
- `web/src/contracts/plan.ts`
- `web/src/modules/plan-runner/normalize/postgres.ts`
- `web/src/modules/mentor/evidence/extractor.ts`
- `web/src/modules/mentor/evidence/compactor.ts`
- `web/src/modules/mentor/evidence/compactor.test.ts`
- `web/src/modules/mentor/evidence/index.ts`

Kết quả kiểm tra:
- `npx vitest run src/modules/mentor/evidence/compactor.test.ts`: 13/13 tests pass 100%.
- `npm run check`: 60/60 test files pass (658 passed, 16 skipped), 0 errors, lint và typecheck sạch 100%.

Kết quả review:
- 1 lỗi phát hiện ở vòng 1 (regex `isSeqScanNode` quá rộng gây false positive với Bitmap/Function/CTE Scan) đã được sửa triệt để và bổ sung test kiểm chứng; vòng 2 đạt PASS 100%.

Chưa làm được: Không có.
Phát sinh: Không có.

Việc tiếp theo cần biết:
- Task099 và Task100 khi dựng context prompt cho LLM cần gọi `compactEvidencePack(evidence)` trước khi gửi lên Gin API để tận dụng `ruleTags` và tối ưu lượng token.
