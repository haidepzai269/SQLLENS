import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_BY_TAG,
  KNOWLEDGE_CATALOG,
  lookupKnowledge,
  MAX_KNOWLEDGE_CHARS,
} from "./index";
import type { KnowledgeSnippet, RuleTag } from "./types";

describe("Rule-Indexed Technical Knowledge Catalog (Task096)", () => {
  describe("AC1: Danh mục Catalog 15 case kỹ thuật cốt lõi", () => {
    const EXPECTED_TAGS: RuleTag[] = [
      "RULE_SORT_DISK_SPILL",
      "RULE_HASH_JOIN_SPILL",
      "RULE_ACCIDENTAL_CARTESIAN",
      "RULE_IMPLICIT_CAST_SCAN",
      "RULE_UNINDEXED_FK_DEADLOCK",
      "RULE_MISSING_PRIMARY_KEY",
      "RULE_LEADING_WILDCARD_LIKE",
      "RULE_FUNCTION_ON_INDEX_COLUMN",
      "RULE_FLOAT_FOR_CURRENCY",
      "RULE_VARCHAR_OVERSIZED",
      "RULE_NON_LEFTMOST_COMPOSITE",
      "RULE_MYSQL_GAP_LOCK_NEXTKEY",
      "RULE_MYSQL_FILESORT",
      "RULE_POSTGRES_TOAST_OVERHEAD",
      "RULE_COUNT_STAR_BIG_TABLE",
    ];

    it("định nghĩa ít nhất 15 case kỹ thuật cốt lõi", () => {
      expect(KNOWLEDGE_CATALOG.length).toBeGreaterThanOrEqual(15);
    });

    it("chứa đầy đủ 15 RuleTag theo tiêu chí nghiệm thu AC1", () => {
      for (const tag of EXPECTED_TAGS) {
        const item = KNOWLEDGE_BY_TAG.get(tag);
        expect(item, `Thiếu tag ${tag} trong KNOWLEDGE_BY_TAG`).toBeDefined();
        expect(item?.tag).toBe(tag);
      }
    });

    it("mỗi snippet có cấu trúc đầy đủ, nội dung kỹ thuật rõ ràng", () => {
      for (const item of KNOWLEDGE_CATALOG) {
        expect(item.tag).toBeTruthy();
        expect(item.titleVi).toBeTruthy();
        expect(item.titleEn).toBeTruthy();
        expect(["postgres", "mysql", "both"]).toContain(item.engine);
        expect(item.contextSummaryVi.length).toBeGreaterThan(50);
        expect(item.contextSummaryEn.length).toBeGreaterThan(50);
        // Kiểm tra mẫu SQL nếu có
        if (item.sampleSqlBad) {
          expect(typeof item.sampleSqlBad).toBe("string");
        }
        if (item.sampleSqlGood) {
          expect(typeof item.sampleSqlGood).toBe("string");
        }
      }
    });

    it("tra cứu O(1) in-memory bằng Map với tất cả tag trong catalog", () => {
      expect(KNOWLEDGE_BY_TAG.size).toBe(KNOWLEDGE_CATALOG.length);
      for (const item of KNOWLEDGE_CATALOG) {
        expect(KNOWLEDGE_BY_TAG.get(item.tag)).toBe(item);
      }
    });
  });

  describe("AC2: lookupKnowledge trả về Markdown chuẩn theo locale", () => {
    it("trả về Markdown tiếng Việt (vi) chuẩn cho 1 tag", () => {
      const output = lookupKnowledge(["RULE_SORT_DISK_SPILL"], "vi");
      expect(output).toContain("### [PostgreSQL] Tràn bộ nhớ sắp xếp ra đĩa");
      expect(output).toContain("(RULE_SORT_DISK_SPILL)");
      expect(output).toContain("work_mem");
      expect(output).toContain("- **SQL chưa tối ưu (Anti-pattern):**");
      expect(output).toContain("- **SQL khuyến nghị tối ưu:**");
      expect(output).toContain("```sql");
    });

    it("trả về Markdown tiếng Anh (en) chuẩn cho 1 tag", () => {
      const output = lookupKnowledge(["RULE_SORT_DISK_SPILL"], "en");
      expect(output).toContain("### [PostgreSQL] Sort Spill to Disk");
      expect(output).toContain("(RULE_SORT_DISK_SPILL)");
      expect(output).toContain("work_mem");
      expect(output).toContain("- **Anti-pattern SQL:**");
      expect(output).toContain("- **Recommended SQL:**");
    });

    it("hiển thị đúng nhãn engine [MySQL] và [PostgreSQL / MySQL]", () => {
      const mysqlOutput = lookupKnowledge(["RULE_MYSQL_GAP_LOCK_NEXTKEY"], "vi");
      expect(mysqlOutput).toContain("### [MySQL]");

      const bothOutput = lookupKnowledge(["RULE_ACCIDENTAL_CARTESIAN"], "vi");
      expect(bothOutput).toContain("### [PostgreSQL / MySQL]");
    });
  });

  describe("AC3: Cắt gọn ngân sách tối đa 2.000 ký tự khi truyền nhiều tags", () => {
    it("khi truyền 5 tags: ưu tiên tag đầu và độ dài không vượt quá 2.000 ký tự", () => {
      const tags: RuleTag[] = [
        "RULE_SORT_DISK_SPILL",
        "RULE_HASH_JOIN_SPILL",
        "RULE_ACCIDENTAL_CARTESIAN",
        "RULE_IMPLICIT_CAST_SCAN",
        "RULE_UNINDEXED_FK_DEADLOCK",
      ];
      const output = lookupKnowledge(tags, "vi");
      expect(output.length).toBeLessThanOrEqual(MAX_KNOWLEDGE_CHARS);
      expect(output.length).toBeLessThanOrEqual(2000);
      // Tag đầu tiên chắc chắn có mặt đầy đủ
      expect(output).toContain("RULE_SORT_DISK_SPILL");
      expect(output).toContain("work_mem");
    });

    it("khi truyền tất cả 15 tags: chuỗi Markdown vẫn tuân thủ nghiêm ngặt ngân sách <= 2.000 ký tự", () => {
      const allTags = KNOWLEDGE_CATALOG.map((item) => item.tag);
      const outputVi = lookupKnowledge(allTags, "vi");
      expect(outputVi.length).toBeLessThanOrEqual(MAX_KNOWLEDGE_CHARS);
      expect(outputVi.length).toBeLessThanOrEqual(2000);
      expect(outputVi).toContain("RULE_SORT_DISK_SPILL");

      const outputEn = lookupKnowledge(allTags, "en");
      expect(outputEn.length).toBeLessThanOrEqual(MAX_KNOWLEDGE_CHARS);
      expect(outputEn.length).toBeLessThanOrEqual(2000);
      expect(outputEn).toContain("RULE_SORT_DISK_SPILL");
    });
  });

  describe("AC4: Tag không tồn tại hoặc mảng tag rỗng trả về chuỗi rỗng và không throw Exception", () => {
    it("trả về chuỗi rỗng khi mảng tags rỗng", () => {
      expect(lookupKnowledge([])).toBe("");
      expect(lookupKnowledge([], "en")).toBe("");
    });

    it("trả về chuỗi rỗng khi tag không tồn tại trong catalog", () => {
      expect(lookupKnowledge(["UNKNOWN_TAG_12345"])).toBe("");
      expect(lookupKnowledge(["INVALID_RULE_TAG", "ANOTHER_UNKNOWN"])).toBe("");
    });

    it("tuyệt đối không throw Exception với các tag dị dạng", () => {
      expect(() => lookupKnowledge(["   ", ""])).not.toThrow();
      expect(lookupKnowledge(["   ", ""])).toBe("");
    });
  });

  describe("AC5: Các trường hợp biên (Edge Cases)", () => {
    it("deduplicate tags: nhiều tag trùng lặp chỉ render 1 lần", () => {
      const output = lookupKnowledge(
        ["RULE_SORT_DISK_SPILL", "RULE_SORT_DISK_SPILL", "RULE_SORT_DISK_SPILL"],
        "vi"
      );
      const occurrences = (output.match(/RULE_SORT_DISK_SPILL/g) || []).length;
      expect(occurrences).toBe(1);
    });

    it("bỏ qua tag rác nhưng vẫn lấy tag hợp lệ đứng sau", () => {
      const output = lookupKnowledge(
        ["JUNK_TAG_1", "RULE_MISSING_PRIMARY_KEY", "JUNK_TAG_2"],
        "vi"
      );
      expect(output).toContain("RULE_MISSING_PRIMARY_KEY");
      expect(output).not.toContain("JUNK_TAG_1");
    });

    it("fallback về tiếng Việt khi locale không hợp lệ", () => {
      // @ts-expect-error kiểm thử locale lạ lúc runtime
      const outputInvalid = lookupKnowledge(["RULE_SORT_DISK_SPILL"], "fr");
      expect(outputInvalid).toContain("Tràn bộ nhớ sắp xếp ra đĩa");

      const outputUndefined = lookupKnowledge(["RULE_SORT_DISK_SPILL"], undefined);
      expect(outputUndefined).toContain("Tràn bộ nhớ sắp xếp ra đĩa");
    });

    it("xử lý an toàn khi tham số tags không phải mảng (runtime safety)", () => {
      // @ts-expect-error runtime check
      expect(lookupKnowledge(null, "vi")).toBe("");
      // @ts-expect-error runtime check
      expect(lookupKnowledge(undefined, "vi")).toBe("");
      // @ts-expect-error runtime check
      expect(lookupKnowledge("RULE_SORT_DISK_SPILL", "vi")).toBe("");
      // @ts-expect-error runtime check
      expect(lookupKnowledge(12345, "vi")).toBe("");
    });

    it("xử lý mảng tags chứa các phần tử null/undefined/khoảng trắng xen kẽ", () => {
      const mixedTags = [
        null,
        "",
        "   ",
        "RULE_FLOAT_FOR_CURRENCY",
        undefined,
        "   RULE_VARCHAR_OVERSIZED   ",
      ] as unknown as RuleTag[];

      const output = lookupKnowledge(mixedTags, "vi");
      expect(output).toContain("RULE_FLOAT_FOR_CURRENCY");
      expect(output).toContain("RULE_VARCHAR_OVERSIZED");
      expect(output.length).toBeLessThanOrEqual(2000);
    });

    it("xử lý an toàn khi snippet không có sampleSqlBad hoặc sampleSqlGood", () => {
      const tagMock = "RULE_MOCK_NO_SQL";
      const mutableMap = KNOWLEDGE_BY_TAG as Map<string, KnowledgeSnippet>;
      mutableMap.set(tagMock, {
        tag: tagMock,
        titleVi: "Mẫu không có SQL",
        titleEn: "Mock No SQL",
        engine: "postgres",
        contextSummaryVi: "Tóm tắt ngữ cảnh mẫu không có khối SQL",
        contextSummaryEn: "Mock context summary without SQL blocks",
      });

      try {
        const outVi = lookupKnowledge([tagMock], "vi");
        expect(outVi).toContain("Mẫu không có SQL");
        expect(outVi).not.toContain("```sql");

        const outEn = lookupKnowledge([tagMock], "en");
        expect(outEn).toContain("Mock No SQL");
        expect(outEn).not.toContain("```sql");
      } finally {
        mutableMap.delete(tagMock);
      }
    });

    it("cắt gọn đúng 2.000 ký tự khi snippet đầu tiên vượt quá 2.000 ký tự", () => {
      const tagHuge = "RULE_MOCK_HUGE";
      const mutableMap = KNOWLEDGE_BY_TAG as Map<string, KnowledgeSnippet>;
      mutableMap.set(tagHuge, {
        tag: tagHuge,
        titleVi: "Snippet siêu dài",
        titleEn: "Huge Snippet",
        engine: "postgres",
        contextSummaryVi: "A".repeat(3000),
        contextSummaryEn: "B".repeat(3000),
      });

      try {
        const out = lookupKnowledge([tagHuge], "vi");
        expect(out.length).toBe(MAX_KNOWLEDGE_CHARS);
        expect(out.length).toBe(2000);
      } finally {
        mutableMap.delete(tagHuge);
      }
    });
  });
});
