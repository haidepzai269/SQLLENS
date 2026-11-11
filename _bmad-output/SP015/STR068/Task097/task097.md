# Task097: Bộ bóc tách tín hiệu Plan & Bộ nén Evidence (Compactor)

Thuộc: SP015 / STR068
Mục tiêu: Phân tích cây thực thi Plan để trích xuất điểm nghẽn I/O & CPU, gán RuleTag kỹ thuật, và nén giảm > 70% kích thước EvidencePack JSON trước khi gọi AI.
Phạm vi:
- `web/src/modules/mentor/evidence/extractor.ts`
- `web/src/modules/mentor/evidence/compactor.ts`
- `web/src/modules/mentor/evidence/compactor.test.ts`
- `web/src/modules/mentor/evidence/index.ts`
- `web/src/contracts/mentor.ts` (mở rộng kiểu `EvidencePack` có thêm `ruleTags` và `compact` flag)
Không làm: Không sửa giao diện hiển thị chat ở task này, không gọi LLM trực tiếp.

Hợp đồng:
- `extractPlanTags(plan: Plan | undefined, engine: EngineId): string[];`
- `compactEvidencePack(evidence: EvidencePack): EvidencePack;`
- Payload gửi lên Gin API giữ nguyên cấu trúc JSON hợp lệ, nhưng dung lượng string giảm từ ~12KB xuống < 3KB.

Tiêu chí xong:
- AC1: `extractPlanTags` phát hiện các nút thắt trong Postgres/MySQL Plan:
  - Node `Sort` có `sortMethod` chứa `"Disk"` -> sinh tag `RULE_SORT_DISK_SPILL`.
  - Node `Hash Join` có `batches > 1` -> sinh tag `RULE_HASH_JOIN_SPILL`.
  - Node `Seq Scan` có `actualRows > 1000` hoặc chi phí chiếm > 60% tổng chi phí -> sinh tag `RULE_MISSING_PRIMARY_KEY` hoặc `RULE_MISSING_INDEX`.
  - Node `Nested Loop` với số dòng thực tế chênh lệch > 100x số dòng ước tính -> sinh tag `RULE_ACCIDENTAL_CARTESIAN`.
- AC2: `compactEvidencePack` cắt tỉa cây Plan:
  - Giữ lại tối đa 3 tầng node nghẽn nhất (theo thời gian thực thi hoặc số trang I/O).
  - Loại bỏ các trường phân tích chi tiết không cần cho LLM (như `output`, `filterString` rườm rà, `schema` của các bảng không tham gia query).
  - Đính kèm mảng `ruleTags` đã gom từ cả Findings và Plan Extractor.
- AC3: Dung lượng JSON sau nén: một query kèm plan 100 dòng JSON (~15KB) sau khi qua `compactEvidencePack` giảm xuống dưới 3.500 bytes (đo bằng `JSON.stringify(compacted).length`).
- AC4: Khi không có Plan (ví dụ chỉ có query đơn giản), hàm vẫn trích xuất tags từ `evidence.findings` bình thường, không ném lỗi.
- AC5: Đầy đủ Unit Test kiểm thử các trường hợp nén và bóc tách, `npx vitest run web/src/modules/mentor/evidence/compactor.test.ts` pass 100%.

Ca biên: Plan rỗng; Plan chỉ có 1 node Result; Plan sâu 10 tầng lồng nhau; Findings rỗng.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/mentor/evidence/compactor.test.ts`.
Góc review thêm: Bảo toàn thông tin quan trọng / Không làm mất tính hợp lệ của JSON.
Đọc thêm: `_bmad-output/SPEC_RULE_INDEX.md` mục 2 & 3.

