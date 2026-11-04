import type { Conclusion, Evidence, Outcome } from "@/contracts/conclusion";
import type { FindingData, RuleHit, Severity } from "@/contracts/finding";
import type { Plan, PlanNode } from "@/contracts/plan";

const SCAN_KINDS = new Set(["seq_scan", "index_scan", "index_only_scan", "bitmap_scan"]);
const base = (t: string) => t.toLowerCase().split(".").pop()!;
const notSim = (reasonKey: string): Outcome<FindingData> => ({ kind: "not_simulated", reasonKey });

// Tìm theo tên bảng thật (plan không mang bí danh), nên một bảng xuất hiện hai lần cho hai nút.
function scansOf(n: PlanNode, table: string, out: PlanNode[] = []): PlanNode[] {
  if (n.table && base(n.table) === table && SCAN_KINDS.has(n.kind)) out.push(n);
  n.children.forEach((c) => scansOf(c, table, out));
  return out;
}

function fromPlan(hit: RuleHit, plan: Plan): Outcome<FindingData> {
  const nodes = scansOf(plan.root, base(hit.table!));
  if (!nodes.length) return notSim("findings.notSimulated.tableNotInPlan");
  const seq = nodes[0].kind === "seq_scan";
  // Hai bí danh cùng bảng mà một nút quét toàn bảng, một nút dùng index: không biết hit thuộc nút nào thì không đoán.
  if (nodes.some((n) => (n.kind === "seq_scan") !== seq)) return notSim("findings.notSimulated.ambiguousTable");
  const node = nodes[0];
  const real = plan.analyzed;
  const values = { table: hit.table!, scan: node.label };
  const evidence: [Evidence, ...Evidence[]] = [
    { kind: "plan-node", messageKey: `findings.evidence.${real ? "scan" : "estimatedScan"}${seq ? "Seq" : "Index"}`, values },
  ];
  if (real && node.actualRows !== undefined && node.pagesRead !== undefined) {
    evidence.push({ kind: "plan-counts", messageKey: "findings.evidence.counts", values: { rows: node.actualRows, pages: node.pagesRead } });
  } else if (!real && node.estimatedRows !== undefined) {
    evidence.push({ kind: "plan-counts", messageKey: "findings.evidence.estimatedRows", values: { rows: node.estimatedRows } });
  }
  const severity: Severity = !real ? "unverified" : seq ? "broken" : "not_broken";
  const out: Conclusion<FindingData> = { kind: "conclusion", label: real ? "real" : "estimated", data: { hit, severity, planNodeId: node.id }, evidence };
  return out;
}

function one(hit: RuleHit, plans: { statementIndex: number; plan: Outcome<Plan> }[]): Outcome<FindingData> {
  // Luật schema chỉ đọc cấu trúc trong SQL, chưa chạy kịch bản nào: vàng, nhãn Ước lượng.
  if (hit.messageKey.startsWith("findings.schema.")) {
    return { kind: "conclusion", label: "estimated", data: { hit, severity: "unverified" }, evidence: [{ kind: "structure", messageKey: "findings.evidence.structureOnly" }] };
  }
  if (!hit.messageKey.startsWith("findings.query.")) return notSim("findings.notSimulated.unknownRule");
  if (!hit.table) return notSim("findings.notSimulated.noTable");
  const entry = hit.statementIndex === undefined ? undefined : plans.find((p) => p.statementIndex === hit.statementIndex);
  if (!entry) return notSim("findings.notSimulated.noPlan");
  if (entry.plan.kind === "not_simulated") return notSim(entry.plan.reasonKey);
  return fromPlan(hit, entry.plan.data);
}

/**
 * Gắn plan vào kết quả luật, theo đúng thứ tự `hits`. Mảng rỗng chỉ có nghĩa luật chưa thấy gì, không phải "không có rủi ro".
 * shortcut: so khớp theo tên bảng, bỏ qua schema và bí danh; thêm khi plan mang bí danh.
 */
export function attachEvidence(hits: RuleHit[], input: { plans: { statementIndex: number; plan: Outcome<Plan> }[] }): Outcome<FindingData>[] {
  return hits.map((h) => one(h, input.plans));
}
