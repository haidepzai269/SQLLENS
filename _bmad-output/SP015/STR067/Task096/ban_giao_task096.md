# Bàn giao Task096: Kho tri thức kỹ thuật Rule-Indexed Catalog (In-Memory O(1))

Đã làm:
- Xây dựng module tri thức kỹ thuật chuẩn định danh theo RuleTag cho PostgreSQL 16 và MySQL 8.0, hoàn toàn in-memory, thời gian tra cứu O(1) < 1ms, không phụ thuộc mạng hay database ngoài.
- Định nghĩa catalog 15 case tối ưu cốt lõi kèm giải thích cơ chế nội bộ và mã SQL mẫu (tốt/xấu) song ngữ Tiếng Việt & Tiếng Anh.
- Xây dựng hàm `lookupKnowledge` đóng gói chuỗi Markdown cô đọng, tự động cắt gọn và khống chế trần ngân sách tối đa 2.000 ký tự (~400 tokens), xử lý an toàn không ném ngoại lệ khi gặp tag rác hoặc mảng rỗng.
- Bổ sung bộ 19 unit tests kiểm thử toàn diện các tiêu chí AC1 - AC5 và các ca biên (deduplicate, fallback locale, mảng rác).

File chính:
- `web/src/modules/mentor/knowledge/types.ts`: Kiểu dữ liệu `RuleTag`, `KnowledgeEngine`, `KnowledgeSnippet`.
- `web/src/modules/mentor/knowledge/catalog.ts`: Bộ từ điển 15 case cốt lõi (`KNOWLEDGE_CATALOG`) và `KNOWLEDGE_BY_TAG` (Map tra cứu O(1)).
- `web/src/modules/mentor/knowledge/lookup.ts`: Hàm `lookupKnowledge` tra cứu và định dạng Markdown song ngữ theo trần 2.000 ký tự.
- `web/src/modules/mentor/knowledge/lookup.test.ts`: 19 unit tests bao quát toàn bộ AC1 - AC5.
- `web/src/modules/mentor/knowledge/index.ts`: Re-export module API sạch sẽ.

Kết quả kiểm tra:
- `npx vitest run src/modules/mentor/knowledge/lookup.test.ts`: 19/19 tests passed (100%).
- `npm run check`: lint 0 errors, typecheck passed, check:i18n passed, full vitest passed (56 test files, 630 passed).

Kết quả review:
- Reviewer độc lập đánh giá PASS 100% trong vòng đầu tiên (0 lỗi confirmed, 0 mục needs_validation, đạt toàn bộ AC1 - AC5).

Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết:
- Task097 (Bộ bóc tách tín hiệu Plan & Bộ nén Evidence) có thể import trực tiếp `lookupKnowledge` và các `RuleTag` từ `@/modules/mentor/knowledge` để tiêm tri thức chuẩn vào prompt khi phát hiện điểm nghẽn thực thi.
