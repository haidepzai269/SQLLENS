import { describe, expect, it } from "vitest";
import { estimateTokens, minifyPlanJson } from "./plan-minifier";

describe("plan-minifier", () => {
  describe("estimateTokens", () => {
    it("trả về 0 cho chuỗi rỗng", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("ước tính tỷ lệ ~3.7 ký tự / token", () => {
      const text = "SELECT * FROM users WHERE id = 1";
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBe(Math.ceil(text.length / 3.7));
    });
  });

  describe("minifyPlanJson - Single Query Scans", () => {
    it("AC3 & AC4: nén Seq Scan với Filter và Buffers", () => {
      const raw = [
        {
          Plan: {
            "Node Type": "Seq Scan",
            "Relation Name": "users",
            "Actual Rows": 5,
            "Plan Rows": 5,
            "Shared Hit Blocks": 3,
            "Shared Read Blocks": 0,
            Filter: "(age > 20)",
            "Actual Loops": 1,
          },
        },
      ];

      const minified = minifyPlanJson(raw);
      expect(minified).toBe(
        "[PLAN_EVIDENCE: Seq Scan on users | Actual Rows: 5 (Est: 5) | Buffers: 3 hit, 0 read | Filter: (age > 20)]"
      );

      // AC5: Dưới 45 tokens cho câu đơn
      expect(estimateTokens(minified)).toBeLessThanOrEqual(45);
    });

    it("nén Index Scan với Index Name và Index Cond", () => {
      const raw = {
        Plan: {
          "Node Type": "Index Scan",
          "Relation Name": "orders",
          "Index Name": "idx_orders_customer",
          "Actual Rows": 12,
          "Plan Rows": 10,
          "Shared Hit Blocks": 4,
          "Shared Read Blocks": 1,
          "Index Cond": "(customer_id = 42)",
          "Actual Loops": 1,
        },
      };

      const minified = minifyPlanJson(raw);
      expect(minified).toContain("Index Scan on orders using idx_orders_customer");
      expect(minified).toContain("Actual Rows: 12 (Est: 10)");
      expect(minified).toContain("Buffers: 4 hit, 1 read");
      expect(minified).toContain("Index Cond: (customer_id = 42)");
      expect(estimateTokens(minified)).toBeLessThanOrEqual(45);
    });

    it("nén Bitmap Heap Scan kết hợp Bitmap Index Scan", () => {
      const raw = {
        "Node Type": "Bitmap Heap Scan",
        "Relation Name": "products",
        "Actual Rows": 50,
        "Plan Rows": 45,
        "Shared Hit Blocks": 8,
        "Shared Read Blocks": 2,
        "Recheck Cond": "(category_id = 3)",
        "Actual Loops": 1,
      };

      const minified = minifyPlanJson(raw);
      expect(minified).toContain("Bitmap Heap Scan on products");
      expect(minified).toContain("Actual Rows: 50 (Est: 45)");
      expect(minified).toContain("Buffers: 8 hit, 2 read");
      expect(estimateTokens(minified)).toBeLessThanOrEqual(45);
    });

    it("nhận đầu vào là chuỗi JSON thô từ Postgres", () => {
      const jsonStr = JSON.stringify([
        {
          Plan: {
            "Node Type": "Seq Scan",
            "Relation Name": "logs",
            "Actual Rows": 0,
            "Plan Rows": 1,
            "Shared Hit Blocks": 1,
            "Shared Read Blocks": 0,
          },
        },
      ]);

      const minified = minifyPlanJson(jsonStr);
      expect(minified).toBe(
        "[PLAN_EVIDENCE: Seq Scan on logs | Actual Rows: 0 (Est: 1) | Buffers: 1 hit, 0 read]"
      );
    });
  });

  describe("minifyPlanJson - Joins & Multi-level Trees", () => {
    it("AC5: nén Hash Join với node con dưới 80 tokens", () => {
      const raw = [
        {
          Plan: {
            "Node Type": "Hash Join",
            "Actual Rows": 150,
            "Plan Rows": 150,
            "Shared Hit Blocks": 12,
            "Shared Read Blocks": 4,
            "Hash Cond": "(o.user_id = u.id)",
            Plans: [
              {
                "Node Type": "Seq Scan",
                "Relation Name": "orders",
                "Actual Rows": 150,
                "Shared Hit Blocks": 8,
                "Shared Read Blocks": 0,
              },
              {
                "Node Type": "Hash",
                Plans: [
                  {
                    "Node Type": "Index Scan",
                    "Relation Name": "users",
                    "Index Name": "users_pkey",
                    "Actual Rows": 10,
                    "Shared Hit Blocks": 4,
                    "Shared Read Blocks": 4,
                  },
                ],
              },
            ],
          },
        },
      ];

      const minified = minifyPlanJson(raw);
      expect(minified).toContain("[PLAN_EVIDENCE: Hash Join | Actual Rows: 150 (Est: 150) | Buffers: 12 hit, 4 read");
      expect(minified).toContain("-> Hash Cond: (o.user_id = u.id)");
      expect(minified).toContain("-> Seq Scan on orders (Rows: 150, Buffers: 8 hit)");
      expect(minified).toContain("-> Hash -> Index Scan on users using users_pkey (Rows: 10, Buffers: 4 hit, 4 read)");
      expect(estimateTokens(minified)).toBeLessThanOrEqual(80);
    });

    it("nén Nested Loop Join với Loops > 1", () => {
      const raw = {
        Plan: {
          "Node Type": "Nested Loop",
          "Actual Rows": 200,
          "Plan Rows": 200,
          "Shared Hit Blocks": 40,
          "Shared Read Blocks": 0,
          Plans: [
            {
              "Node Type": "Seq Scan",
              "Relation Name": "a",
              "Actual Rows": 200,
              "Shared Hit Blocks": 10,
            },
            {
              "Node Type": "Index Scan",
              "Relation Name": "u",
              "Index Name": "u_id",
              "Actual Rows": 200,
              "Actual Loops": 200,
              "Shared Hit Blocks": 30,
            },
          ],
        },
      };

      const minified = minifyPlanJson(raw);
      expect(minified).toContain("Nested Loop");
      expect(minified).toContain("-> Seq Scan on a (Rows: 200, Buffers: 10 hit)");
      expect(minified).toContain("-> Index Scan on u using u_id (Rows: 200, Buffers: 30 hit)");
      expect(estimateTokens(minified)).toBeLessThanOrEqual(80);
    });
  });

  describe("minifyPlanJson - Edge Cases & Robustness", () => {
    it("chống crash với null, undefined, chuỗi rỗng", () => {
      expect(minifyPlanJson(null)).toBe("");
      expect(minifyPlanJson(undefined)).toBe("");
      expect(minifyPlanJson("")).toBe("");
      expect(minifyPlanJson("   ")).toBe("");
      expect(minifyPlanJson("invalid json text")).toBe("");
      expect(minifyPlanJson({})).toBe("");
      expect(minifyPlanJson([])).toBe("");
    });

    it("rút gọn Filter quá dài để không vượt trần token", () => {
      const longFilter = "(a = 1 AND b = 2 AND c = 3 AND d = 4 AND e = 5 AND f = 6 AND g = 7 AND h = 8 AND i = 9)";
      const raw = {
        Plan: {
          "Node Type": "Seq Scan",
          "Relation Name": "large_table",
          "Actual Rows": 10,
          Filter: longFilter,
        },
      };

      const minified = minifyPlanJson(raw);
      expect(minified).toContain("...");
      expect(estimateTokens(minified)).toBeLessThanOrEqual(45);
    });

    it("xử lý bảng rỗng có Actual Rows = 0", () => {
      const raw = {
        Plan: {
          "Node Type": "Seq Scan",
          "Relation Name": "empty_table",
          "Actual Rows": 0,
          "Plan Rows": 0,
          "Shared Hit Blocks": 0,
          "Shared Read Blocks": 0,
        },
      };

      const minified = minifyPlanJson(raw);
      expect(minified).toContain("Actual Rows: 0 (Est: 0)");
      expect(minified).toContain("Buffers: 0 hit, 0 read");
    });
  });
});
