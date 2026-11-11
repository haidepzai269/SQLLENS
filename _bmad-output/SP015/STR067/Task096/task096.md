# Task096: Kho tri thức kỹ thuật Rule-Indexed Catalog (In-Memory O(1))

Thuộc: SP015 / STR067
Mục tiêu: Xây dựng module tri thức kỹ thuật chuẩn định danh theo RuleTag cho PostgreSQL 16 và MySQL 8.0, tra cứu O(1) in-memory, tiêm tối đa 400 tokens vào prompt.
Phạm vi:
- `web/src/modules/mentor/knowledge/types.ts`
- `web/src/modules/mentor/knowledge/catalog.ts`
- `web/src/modules/mentor/knowledge/lookup.ts`
- `web/src/modules/mentor/knowledge/lookup.test.ts`
- `web/src/modules/mentor/knowledge/index.ts`
Không làm: Không gọi mạng ngoài, không gọi vector database, không đánh thức Neon Postgres, không thay đổi prompt của Go ở task này.

Hợp đồng:
- `type RuleTag = string;`
- `type KnowledgeSnippet = { tag: RuleTag; titleVi: string; titleEn: string; engine: "postgres" | "mysql" | "both"; contextSummaryVi: string; contextSummaryEn: string; sampleSqlGood?: string; sampleSqlBad?: string };`
- `lookupKnowledge(tags: RuleTag[], locale: "vi" | "en"): string;` (chuỗi Markdown cô đọng, tối đa 400 tokens ~ 1.800 ký tự).

Tiêu chí xong:
- AC1: `catalog.ts` định nghĩa sẵn ít nhất 15 case kỹ thuật cốt lõi:
  1. `RULE_SORT_DISK_SPILL` (Postgres `work_mem`, Sort method Disk)
  2. `RULE_HASH_JOIN_SPILL` (Postgres Hash Join batches > 1)
  3. `RULE_ACCIDENTAL_CARTESIAN` (Cartesian product / Nested loop millions of rows)
  4. `RULE_IMPLICIT_CAST_SCAN` (Ép kiểu ngầm làm vô hiệu B-Tree index)
  5. `RULE_UNINDEXED_FK_DEADLOCK` (Khóa bảng cha khi cập nhật bảng con không có index)
  6. `RULE_MISSING_PRIMARY_KEY` (Bảng thiếu khóa chính)
  7. `RULE_LEADING_WILDCARD_LIKE` (`LIKE '%abc'`)
  8. `RULE_FUNCTION_ON_INDEX_COLUMN` (`WHERE LOWER(email) = ...`)
  9. `RULE_FLOAT_FOR_CURRENCY` (Dùng FLOAT/REAL lưu tiền tệ)
  10. `RULE_VARCHAR_OVERSIZED` (`VARCHAR(65535)` lãng phí bộ nhớ sắp xếp)
  11. `RULE_NON_LEFTMOST_COMPOSITE` (Không dùng tiền tố trái của composite index)
  12. `RULE_MYSQL_GAP_LOCK_NEXTKEY` (Cơ chế khóa Next-Key / Gap Lock InnoDB)
  13. `RULE_MYSQL_FILESORT` (Using filesort khi thiếu composite index sắp xếp)
  14. `RULE_POSTGRES_TOAST_OVERHEAD` (Dung lượng cột lớn đẩy vào TOAST gây chậm I/O)
  15. `RULE_COUNT_STAR_BIG_TABLE` (`COUNT(*)` trên bảng hàng triệu dòng thiếu metadata)
- AC2: `lookupKnowledge` khi truyền 1 tag trả về đúng đoạn tóm tắt Markdown chuẩn theo ngôn ngữ `locale` ("vi" hoặc "en").
- AC3: `lookupKnowledge` khi truyền nhiều tag (ví dụ 5 tags) ưu tiên lấy các tag đầu tiên và cắt gọn, đảm bảo tổng độ dài chuỗi Markdown không vượt quá 2.000 ký tự (đảm bảo ngân sách < 400 tokens).
- AC4: Tag không tồn tại hoặc mảng tag rỗng trả về chuỗi rỗng `""`, tuyệt đối không throw Exception.
- AC5: Đầy đủ Unit Test kiểm thử các trường hợp biên, `npx vitest run web/src/modules/mentor/knowledge/lookup.test.ts` đạt 100%.

Ca biên: Mảng tags rỗng; tags chứa chuỗi rác; nhiều tags trùng lặp; locale không hợp lệ (mặc định fallback về "vi").
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/mentor/knowledge/lookup.test.ts`.
Góc review thêm: Độ chính xác kiến thức cơ sở dữ liệu / Không phụ thuộc module ngoài.
Đọc thêm: `_bmad-output/SPEC_RULE_INDEX.md` mục 2 & 3.

