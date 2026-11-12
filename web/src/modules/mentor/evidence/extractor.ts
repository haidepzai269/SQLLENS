import type { EngineId } from "@/contracts/engine";
import type { EvidencePack } from "@/contracts/mentor";
import type { Plan, PlanNode } from "@/contracts/plan";

const FINDING_RULE_TO_TAG: Record<string, string> = {
  "missing-pk": "RULE_MISSING_PRIMARY_KEY",
  "fk-no-index": "RULE_UNINDEXED_FK_DEADLOCK",
  "float-money": "RULE_FLOAT_FOR_CURRENCY",
  "varchar-too-large": "RULE_VARCHAR_OVERSIZED",
  "leading-wildcard": "RULE_LEADING_WILDCARD_LIKE",
  "function-on-indexed-column": "RULE_FUNCTION_ON_INDEX_COLUMN",
  "composite-prefix": "RULE_NON_LEFTMOST_COMPOSITE",
  "implicit-cast": "RULE_IMPLICIT_CAST_SCAN",
};

function isSortNode(node: PlanNode): boolean {
  return node.kind === "sort" || /sort/i.test(node.label);
}

function isHashJoinNode(node: PlanNode): boolean {
  return node.kind === "hash_join" || node.kind === "hash" || /hash/i.test(node.label);
}

function isSeqScanNode(node: PlanNode): boolean {
  // Loại trừ tuyệt đối các loại scan có chỉ mục hoặc scan phi-bảng
  if (
    node.kind === "bitmap_scan" ||
    node.kind === "index_scan" ||
    node.kind === "index_only_scan"
  ) {
    return false;
  }
  const label = (node.label ?? "").trim();
  if (/bitmap|index|function|values|cte|subquery|worktable/i.test(label)) {
    return false;
  }

  if (node.kind === "seq_scan") return true;
  return (
    /^seq[\s_-]?scan$/i.test(label) ||
    /^table[\s_-]?scan$/i.test(label) ||
    label === "ALL"
  );
}

function isNestedLoopNode(node: PlanNode): boolean {
  return node.kind === "nested_loop" || /nested[\s_-]?loop/i.test(node.label);
}

function isMysqlFilesortNode(node: PlanNode): boolean {
  return (
    node.kind === "sort" ||
    /filesort/i.test(node.label) ||
    /ordering_operation/i.test(node.label)
  );
}

/**
 * Trích xuất các RuleTag kỹ thuật từ cây Execution Plan dựa trên heuristics.
 */
export function extractPlanTags(plan: Plan | undefined, engine: EngineId): string[] {
  if (!plan || !plan.root) return [];

  const tags: string[] = [];
  const rootCost = plan.root.cost;

  function traverse(node: PlanNode) {
    // 1. Sort tràn đĩa
    if (isSortNode(node)) {
      if (node.sortMethod && /disk/i.test(node.sortMethod)) {
        tags.push("RULE_SORT_DISK_SPILL");
      }
    }

    // 2. MySQL Filesort
    if (engine === "mysql" && isMysqlFilesortNode(node)) {
      tags.push("RULE_MYSQL_FILESORT");
    }

    // 3. Hash Join tràn nhiều batch
    if (isHashJoinNode(node)) {
      if (typeof node.batches === "number" && node.batches > 1) {
        tags.push("RULE_HASH_JOIN_SPILL");
      }
    }

    // 4. Seq Scan bảng lớn hoặc tốn chi phí > 60% tổng chi phí
    if (isSeqScanNode(node)) {
      const highRows = typeof node.actualRows === "number" && node.actualRows > 1000;
      const highCost =
        typeof rootCost === "number" &&
        rootCost > 0 &&
        typeof node.cost === "number" &&
        node.cost / rootCost > 0.6;

      if (highRows || highCost) {
        tags.push("RULE_MISSING_PRIMARY_KEY");
      }
    }

    // 5. Nested Loop chênh lệch dòng > 100x
    if (isNestedLoopNode(node)) {
      const actual = node.actualRows;
      const est = node.estimatedRows;
      if (typeof actual === "number" && typeof est === "number") {
        if (actual > 0 && est > 0) {
          if (actual / est > 100 || est / actual > 100) {
            tags.push("RULE_ACCIDENTAL_CARTESIAN");
          }
        } else if ((est === 0 && actual > 100) || (actual === 0 && est > 100)) {
          tags.push("RULE_ACCIDENTAL_CARTESIAN");
        }
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child) traverse(child);
      }
    }
  }

  traverse(plan.root);

  return Array.from(new Set(tags));
}

/**
 * Trích xuất các RuleTag từ cả Plan heuristics lẫn danh sách Findings tĩnh.
 */
export function extractEvidenceTags(evidence: EvidencePack): string[] {
  const planTags = extractPlanTags(evidence.plan, evidence.engine);
  const findingTags: string[] = [];

  if (Array.isArray(evidence.findings)) {
    for (const f of evidence.findings) {
      if (!f || typeof f.ruleId !== "string") continue;
      const mapped = FINDING_RULE_TO_TAG[f.ruleId];
      if (mapped) {
        findingTags.push(mapped);
      } else if (f.ruleId.startsWith("RULE_")) {
        findingTags.push(f.ruleId);
      }
    }
  }

  return Array.from(new Set([...planTags, ...findingTags]));
}
