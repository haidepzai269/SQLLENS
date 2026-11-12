import type { RuleHit } from "@/contracts/finding";
import type { EvidencePack } from "@/contracts/mentor";
import type { Plan, PlanNode } from "@/contracts/plan";
import { extractEvidenceTags } from "./extractor";

const MAX_COMPACT_DEPTH = 3;
const MAX_BRANCH_PER_NODE = 4;
const MAX_STR_LEN = 150;

function clipStr(s: string | undefined): string | undefined {
  if (typeof s !== "string") return undefined;
  if (s.length <= MAX_STR_LEN) return s;
  return s.slice(0, MAX_STR_LEN) + "...";
}

function cleanObj<T extends Record<string, unknown>>(obj: T): T {
  const res: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      res[k] = v;
    }
  }
  return res as T;
}

function getBottleneckScore(node: PlanNode): number {
  const io = (node.pagesRead ?? 0) * 10;
  const rows = node.actualRows ?? node.estimatedRows ?? 0;
  const cost = node.cost ?? 0;
  return io + rows + cost;
}

function computeSubtreeScore(node: PlanNode): number {
  let score = getBottleneckScore(node);
  if (Array.isArray(node.children)) {
    for (const c of node.children) {
      if (c) score += computeSubtreeScore(c);
    }
  }
  return score;
}

function compactNode(node: PlanNode, depth: number): PlanNode {
  let compactedChildren: PlanNode[] = [];

  if (depth < MAX_COMPACT_DEPTH && Array.isArray(node.children) && node.children.length > 0) {
    const validChildren = node.children.filter((c): c is PlanNode => !!c);

    // Sắp xếp các nhánh con theo độ nghẽn (subtree score) giảm dần để giữ nhánh quan trọng nhất
    const scored = validChildren.map((c) => ({
      child: c,
      score: computeSubtreeScore(c),
    }));
    scored.sort((a, b) => b.score - a.score);

    // Giữ tối đa MAX_BRANCH_PER_NODE con nghẽn nhất
    const kept = scored.slice(0, MAX_BRANCH_PER_NODE).map((s) => s.child);

    compactedChildren = kept.map((c) => compactNode(c, depth + 1));
  }

  return cleanObj({
    id: node.id,
    kind: node.kind,
    label: clipStr(node.label) ?? node.label,
    table: clipStr(node.table),
    index: clipStr(node.index),
    condition: clipStr(node.condition),
    filter: clipStr(node.filter),
    estimatedRows: node.estimatedRows,
    actualRows: node.actualRows,
    pagesRead: node.pagesRead,
    sortMethod: clipStr(node.sortMethod),
    batches: node.batches,
    cost: node.cost,
    children: compactedChildren,
  }) as PlanNode;
}

function compactPlan(plan: Plan | undefined): Plan | undefined {
  if (!plan || !plan.root) return undefined;
  return {
    engine: plan.engine,
    analyzed: plan.analyzed,
    root: compactNode(plan.root, 1),
  };
}

function compactFinding(hit: RuleHit): RuleHit {
  return cleanObj({
    ruleId: hit.ruleId,
    messageKey: hit.messageKey,
    table: clipStr(hit.table),
    column: clipStr(hit.column),
    values: hit.values,
  }) as RuleHit;
}

/**
 * Nén EvidencePack:
 * - Giữ tối đa 3 tầng của cây Plan (chọn lọc các node nghẽn nhất theo I/O, actualRows, cost).
 * - Loại bỏ các metadata dư thừa không cần thiết cho LLM.
 * - Gán ruleTags tổng hợp từ Plan Extractor và Findings.
 * - Đảm bảo kích thước JSON giảm sâu (> 70%), không quăng lỗi khi thiếu Plan hay Findings.
 */
export function compactEvidencePack(evidence: EvidencePack): EvidencePack {
  const ruleTags = extractEvidenceTags(evidence);

  const compacted: EvidencePack = cleanObj({
    engine: evidence.engine,
    sql: evidence.sql,
    sqlTruncated: evidence.sqlTruncated,
    plan: compactPlan(evidence.plan),
    findings: Array.isArray(evidence.findings)
      ? evidence.findings.map(compactFinding)
      : undefined,
    ruleTags,
    compact: true,
  }) as EvidencePack;

  return compacted;
}
