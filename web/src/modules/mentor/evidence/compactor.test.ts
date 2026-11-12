import { describe, expect, it } from "vitest";
import type { EvidencePack } from "@/contracts/mentor";
import type { Plan, PlanNode } from "@/contracts/plan";
import { normalizePostgres } from "@/modules/plan-runner/normalize/postgres";
import { compactEvidencePack, extractEvidenceTags, extractPlanTags } from "./index";

describe("Plan & Evidence Tag Extractor (AC1, AC4)", () => {
  it("phát hiện Sort tràn đĩa -> RULE_SORT_DISK_SPILL", () => {
    const plan: Plan = {
      engine: "postgres",
      analyzed: true,
      root: {
        id: "0",
        kind: "sort",
        label: "Sort",
        sortMethod: "external merge Disk: 4096kB",
        children: [],
      },
    };
    const tags = extractPlanTags(plan, "postgres");
    expect(tags).toContain("RULE_SORT_DISK_SPILL");
  });

  it("phát hiện MySQL filesort -> RULE_MYSQL_FILESORT", () => {
    const plan: Plan = {
      engine: "mysql",
      analyzed: false,
      root: {
        id: "0",
        kind: "sort",
        label: "ordering_operation",
        children: [],
      },
    };
    const tags = extractPlanTags(plan, "mysql");
    expect(tags).toContain("RULE_MYSQL_FILESORT");
  });

  it("phát hiện Hash Join tràn bộ nhớ (batches > 1) -> RULE_HASH_JOIN_SPILL", () => {
    const plan: Plan = {
      engine: "postgres",
      analyzed: true,
      root: {
        id: "0",
        kind: "hash_join",
        label: "Hash Join",
        batches: 4,
        children: [],
      },
    };
    const tags = extractPlanTags(plan, "postgres");
    expect(tags).toContain("RULE_HASH_JOIN_SPILL");
  });

  it("phát hiện Seq Scan > 1000 rows hoặc chiếm > 60% root cost -> RULE_MISSING_PRIMARY_KEY", () => {
    // Trường hợp 1: actualRows > 1000
    const planRows: Plan = {
      engine: "postgres",
      analyzed: true,
      root: {
        id: "0",
        kind: "seq_scan",
        label: "Seq Scan",
        actualRows: 2500,
        children: [],
      },
    };
    expect(extractPlanTags(planRows, "postgres")).toContain("RULE_MISSING_PRIMARY_KEY");

    // Trường hợp 2: cost chiếm > 60% root cost
    const planCost: Plan = {
      engine: "postgres",
      analyzed: false,
      root: {
        id: "0",
        kind: "limit",
        label: "Limit",
        cost: 100,
        children: [
          {
            id: "0.0",
            kind: "seq_scan",
            label: "Seq Scan",
            cost: 85, // 85% > 60%
            children: [],
          },
        ],
      },
    };
    expect(extractPlanTags(planCost, "postgres")).toContain("RULE_MISSING_PRIMARY_KEY");
  });

  it("phát hiện Nested Loop chênh lệch dòng > 100x -> RULE_ACCIDENTAL_CARTESIAN", () => {
    const plan: Plan = {
      engine: "postgres",
      analyzed: true,
      root: {
        id: "0",
        kind: "nested_loop",
        label: "Nested Loop",
        estimatedRows: 5,
        actualRows: 2500, // 2500 / 5 = 500x > 100x
        children: [],
      },
    };
    expect(extractPlanTags(plan, "postgres")).toContain("RULE_ACCIDENTAL_CARTESIAN");
  });

  it("bóc tách tags từ Findings tĩnh và khử trùng lặp", () => {
    const evidence: EvidencePack = {
      engine: "postgres",
      sql: "SELECT * FROM users WHERE phone = 123456",
      findings: [
        { ruleId: "missing-pk", messageKey: "findings.missingPk" },
        { ruleId: "fk-no-index", messageKey: "findings.fkNoIndex" },
        { ruleId: "implicit-cast", messageKey: "findings.implicitCast" },
        { ruleId: "missing-pk", messageKey: "findings.missingPk" }, // duplicate
      ],
    };
    const tags = extractEvidenceTags(evidence);
    expect(tags).toContain("RULE_MISSING_PRIMARY_KEY");
    expect(tags).toContain("RULE_UNINDEXED_FK_DEADLOCK");
    expect(tags).toContain("RULE_IMPLICIT_CAST_SCAN");
    expect(tags.filter((t) => t === "RULE_MISSING_PRIMARY_KEY")).toHaveLength(1);
  });

  it("AC4: khi không có Plan và không có Findings, chạy an toàn trả về mảng rỗng", () => {
    const emptyEvidence: EvidencePack = {
      engine: "postgres",
      sql: "SELECT 1;",
    };
    expect(extractEvidenceTags(emptyEvidence)).toEqual([]);
    expect(extractPlanTags(undefined, "postgres")).toEqual([]);
  });
});

describe("Evidence Compactor (AC2, AC3, AC5)", () => {
  it("AC2 & AC5: cây sâu 10 tầng được cắt tỉa giữ tối đa 3 tầng", () => {
    // Dựng chuỗi 10 tầng lồng nhau
    let current: PlanNode = {
      id: "9",
      kind: "seq_scan",
      label: "Seq Scan",
      table: "deep_table",
      actualRows: 50,
      children: [],
    };
    for (let i = 8; i >= 0; i--) {
      current = {
        id: String(i),
        kind: i === 0 ? "limit" : "nested_loop",
        label: `Node ${i}`,
        cost: 100 - i,
        actualRows: 100,
        children: [current],
      };
    }

    const deepPlan: Plan = {
      engine: "postgres",
      analyzed: true,
      root: current,
    };

    const evidence: EvidencePack = {
      engine: "postgres",
      sql: "SELECT * FROM deep_table LIMIT 10",
      plan: deepPlan,
    };

    const compacted = compactEvidencePack(evidence);
    expect(compacted.compact).toBe(true);
    expect(compacted.plan).toBeDefined();

    // Kiểm tra độ sâu tối đa của cây kết quả không vượt quá 3
    function getDepth(node: PlanNode): number {
      if (!node.children || node.children.length === 0) return 1;
      return 1 + Math.max(...node.children.map(getDepth));
    }

    const depth = getDepth(compacted.plan!.root);
    expect(depth).toBeLessThanOrEqual(3);
  });

  it("AC2: ưu tiên giữ lại các nhánh có độ nghẽn (I/O, rows, cost) cao nhất", () => {
    const bottleneckLeaf: PlanNode = {
      id: "heavy_leaf",
      kind: "seq_scan",
      label: "Seq Scan heavy",
      pagesRead: 500,
      actualRows: 20000,
      cost: 5000,
      children: [],
    };

    const lightLeaf: PlanNode = {
      id: "light_leaf",
      kind: "index_scan",
      label: "Index Scan light",
      pagesRead: 1,
      actualRows: 1,
      cost: 2,
      children: [],
    };

    const plan: Plan = {
      engine: "postgres",
      analyzed: true,
      root: {
        id: "root",
        kind: "hash_join",
        label: "Hash Join",
        children: [
          {
            id: "heavy_branch",
            kind: "hash",
            label: "Hash Heavy",
            children: [bottleneckLeaf],
          },
          {
            id: "light_branch",
            kind: "sort",
            label: "Sort Light",
            children: [lightLeaf],
          },
        ],
      },
    };

    const compacted = compactEvidencePack({ engine: "postgres", sql: "JOIN test", plan });
    expect(compacted.plan).toBeDefined();
    const rootChildren = compacted.plan!.root.children;
    expect(rootChildren[0].id).toBe("heavy_branch");
  });

  it("AC3: nén cây plan 100 node (~15KB) giảm xuống dưới 3.500 bytes", () => {
    // Tạo 1 plan 100 node với nhiều metadata phong phú
    const createSubtree = (prefix: string, count: number): PlanNode[] => {
      const nodes: PlanNode[] = [];
      for (let i = 0; i < count; i++) {
        nodes.push({
          id: `${prefix}.${i}`,
          kind: i % 2 === 0 ? "seq_scan" : "index_scan",
          label: `Scan on table_${prefix}_${i} with very long redundant execution description`,
          table: `table_partition_${prefix}_${i}`,
          index: `idx_partition_${prefix}_${i}_created_at`,
          condition: `(col_a = ${i} AND col_b > 1000 AND col_c IS NOT NULL)`,
          filter: `(status = 'active' AND is_deleted = false AND region = 'ap-southeast-1')`,
          estimatedRows: 500 + i,
          actualRows: i === 5 ? 5000 : 20,
          pagesRead: i === 5 ? 120 : 2,
          cost: 100 + i * 10,
          children: [],
        });
      }
      return nodes;
    };

    // Tạo root có 5 nhánh cấp 1, mỗi nhánh cấp 1 có 4 nhánh cấp 2, mỗi nhánh cấp 2 có 4 lá = 1 + 5 + 20 + 80 = 106 nodes
    const root: PlanNode = {
      id: "root",
      kind: "hash_join",
      label: "Hash Join Master Node",
      cost: 15000,
      children: [1, 2, 3, 4, 5].map((lvl1) => ({
        id: `lvl1_${lvl1}`,
        kind: "nested_loop",
        label: `Nested Loop branch ${lvl1}`,
        cost: 3000,
        children: [1, 2, 3, 4].map((lvl2) => ({
          id: `lvl1_${lvl1}_lvl2_${lvl2}`,
          kind: "hash_join",
          label: `Sub Join ${lvl1}.${lvl2}`,
          cost: 700,
          children: createSubtree(`leaf_${lvl1}_${lvl2}`, 4),
        })),
      })),
    };

    const bigPlan: Plan = {
      engine: "postgres",
      analyzed: true,
      root,
    };

    const rawEvidence: EvidencePack = {
      engine: "postgres",
      sql: "SELECT * FROM large_distributed_cluster_query_with_100_tables;",
      plan: bigPlan,
      findings: [
        { ruleId: "missing-pk", messageKey: "findings.missingPk", table: "orders" },
        { ruleId: "varchar-too-large", messageKey: "findings.varcharOversized", column: "bio" },
      ],
    };

    const rawBytes = JSON.stringify(rawEvidence).length;
    expect(rawBytes).toBeGreaterThan(10000); // Khoảng 10KB - 20KB

    const compacted = compactEvidencePack(rawEvidence);
    const compactedBytes = JSON.stringify(compacted).length;

    // AC3: < 3500 bytes
    expect(compactedBytes).toBeLessThan(3500);
    // Tỷ lệ nén giảm > 70%
    const reductionRatio = (rawBytes - compactedBytes) / rawBytes;
    expect(reductionRatio).toBeGreaterThan(0.7);
    expect(compacted.compact).toBe(true);
    expect(compacted.ruleTags).toContain("RULE_MISSING_PRIMARY_KEY");
    expect(compacted.ruleTags).toContain("RULE_VARCHAR_OVERSIZED");
  });

  it("AC5 ca biên: Plan 1 node Result và Plan undefined", () => {
    // 1 node
    const singleNodePlan: Plan = {
      engine: "postgres",
      analyzed: true,
      root: {
        id: "0",
        kind: "other",
        label: "Result",
        children: [],
      },
    };

    const compactedSingle = compactEvidencePack({
      engine: "postgres",
      sql: "SELECT 1;",
      plan: singleNodePlan,
    });
    expect(compactedSingle.plan?.root.label).toBe("Result");
    expect(compactedSingle.plan?.root.children).toEqual([]);

    // Undefined plan
    const compactedUndefined = compactEvidencePack({
      engine: "postgres",
      sql: "SELECT 1;",
      plan: undefined,
    });
    expect(compactedUndefined.plan).toBeUndefined();
    expect(compactedUndefined.compact).toBe(true);
  });

  it("Tích hợp normalizePostgres: bóc tách đúng sortMethod, batches, cost", () => {
    const rawPgExplain = {
      Plan: {
        "Node Type": "Sort",
        "Sort Method": "external merge Disk: 16384kB",
        "Total Cost": 845.2,
        "Actual Rows": 1000,
        "Actual Loops": 1,
        Plans: [
          {
            "Node Type": "Hash Join",
            "Hash Batches": 8,
            "Total Cost": 520.1,
            "Actual Rows": 1000,
            "Actual Loops": 1,
            Plans: [],
          },
        ],
      },
    };

    const plan = normalizePostgres(rawPgExplain);
    expect(plan.root.sortMethod).toBe("external merge Disk: 16384kB");
    expect(plan.root.cost).toBe(845.2);
    expect(plan.root.children[0].batches).toBe(8);
    expect(plan.root.children[0].cost).toBe(520.1);

    // Khi truyền vào extractor
    const tags = extractPlanTags(plan, "postgres");
    expect(tags).toContain("RULE_SORT_DISK_SPILL");
    expect(tags).toContain("RULE_HASH_JOIN_SPILL");
  });
});
