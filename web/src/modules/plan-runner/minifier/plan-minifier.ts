/**
 * Bộ nén Kế hoạch Thực thi (Plan Minifier).
 * Nén AST Plan từ PostgreSQL EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
 * thành chuỗi tóm tắt tinh gọn dưới 45 tokens cho câu đơn và dưới 80 tokens cho câu JOIN phức tạp.
 */

type PlanObj = Record<string, unknown>;

function isObj(val: unknown): val is PlanObj {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Ước lượng số lượng token xấp xỉ cho chuỗi (~3.7 ký tự mỗi token).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.7);
}

/**
 * Rút gọn điều kiện lọc hoặc index cond nếu quá dài, tránh làm tràn ngân sách token.
 */
function clipCondition(cond: string, maxLen = 45): string {
  if (cond.length <= maxLen) return cond;
  return cond.slice(0, maxLen - 3) + "...";
}

/**
 * Trích xuất node Plan gốc từ đối tượng hoặc chuỗi JSON Postgres.
 */
function extractRootPlanNode(rawPlan: unknown): PlanObj | null {
  if (!rawPlan) return null;

  let parsed: unknown = rawPlan;
  if (typeof rawPlan === "string") {
    try {
      parsed = JSON.parse(rawPlan);
    } catch {
      return null;
    }
  }

  // Trường hợp dạng mảng: [ { "Plan": { ... } } ] hoặc [ { "Node Type": ... } ]
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return null;
    const first = parsed[0];
    if (isObj(first)) {
      if (isObj(first.Plan)) return first.Plan;
      if ("Node Type" in first) return first;
    }
    return null;
  }

  // Trường hợp object: { "Plan": { ... } }
  if (isObj(parsed)) {
    if (isObj(parsed.Plan)) return parsed.Plan;
    if ("Node Type" in parsed) return parsed;
  }

  return null;
}

interface FormatOptions {
  maxDepth?: number;
  maxTokens?: number;
}

/**
 * Định dạng một node kế hoạch đơn lẻ thành chuỗi mô tả ngắn.
 */
function formatNodeLine(node: PlanObj, isRoot: boolean): string {
  const nodeType = String(node["Node Type"] || "Unknown");
  const relation = node["Relation Name"] ? String(node["Relation Name"]) : undefined;
  const indexName = node["Index Name"] ? String(node["Index Name"]) : undefined;

  const actualRows = node["Actual Rows"] !== undefined ? Number(node["Actual Rows"]) : undefined;
  const planRows = node["Plan Rows"] !== undefined ? Number(node["Plan Rows"]) : undefined;
  const hit = Number(node["Shared Hit Blocks"] ?? 0);
  const read = Number(node["Shared Read Blocks"] ?? 0);

  const filter = node["Filter"] ? String(node["Filter"]) : undefined;
  const indexCond = node["Index Cond"] ? String(node["Index Cond"]) : undefined;
  const hashCond = node["Hash Cond"] ? String(node["Hash Cond"]) : undefined;
  const loops = node["Actual Loops"] !== undefined ? Number(node["Actual Loops"]) : undefined;

  let target = nodeType;
  if (relation) {
    target += ` on ${relation}`;
    if (indexName) {
      target += ` using ${indexName}`;
    }
  } else if (indexName) {
    target += ` using ${indexName}`;
  }

  if (isRoot) {
    let rowsStr = "";
    if (actualRows !== undefined) {
      rowsStr = `Actual Rows: ${actualRows}`;
      if (planRows !== undefined) {
        rowsStr += ` (Est: ${planRows})`;
      }
    } else if (planRows !== undefined) {
      rowsStr = `Est Rows: ${planRows}`;
    }

    const buffersStr = `Buffers: ${hit} hit, ${read} read`;

    const parts = [target];
    if (rowsStr) parts.push(rowsStr);
    parts.push(buffersStr);

    if (filter) parts.push(`Filter: ${clipCondition(filter)}`);
    if (indexCond) parts.push(`Index Cond: ${clipCondition(indexCond)}`);
    if (hashCond && (!Array.isArray(node.Plans) || node.Plans.length === 0)) {
      parts.push(`Hash Cond: ${clipCondition(hashCond)}`);
    }
    if (loops !== undefined && loops > 1) {
      parts.push(`Loops: ${loops}`);
    }

    return parts.join(" | ");
  }

  // Với node con
  let info = target;
  const metrics: string[] = [];
  if (actualRows !== undefined) {
    metrics.push(`Rows: ${actualRows}`);
  }
  if (hit > 0 || read > 0) {
    const bufParts: string[] = [];
    if (hit > 0) bufParts.push(`${hit} hit`);
    if (read > 0) bufParts.push(`${read} read`);
    metrics.push(`Buffers: ${bufParts.join(", ")}`);
  }
  if (filter) {
    metrics.push(`Filter: ${clipCondition(filter, 25)}`);
  }
  if (indexCond) {
    metrics.push(`Cond: ${clipCondition(indexCond, 25)}`);
  }

  if (metrics.length > 0) {
    info += ` (${metrics.join(", ")})`;
  }
  return info;
}

/**
 * Duyệt các node con để xây dựng chuỗi tóm tắt cho JOIN hoặc cây subplan.
 */
function formatChildren(node: PlanObj, currentDepth: number, maxDepth: number): string[] {
  if (currentDepth > maxDepth) return [];
  const children = Array.isArray(node.Plans) ? node.Plans.filter(isObj) : [];
  if (children.length === 0) return [];

  const lines: string[] = [];

  // Nếu node cha có Hash Cond, thêm dòng biểu thị điều kiện hash
  if (node["Hash Cond"]) {
    lines.push(`-> Hash Cond: ${clipCondition(String(node["Hash Cond"]))}`);
  }

  for (const child of children) {
    // Nếu node con là Hash bao bọc 1 node con khác (ví dụ: Hash -> Seq Scan)
    if (child["Node Type"] === "Hash" && Array.isArray(child.Plans) && child.Plans.filter(isObj).length > 0) {
      const inner = child.Plans.filter(isObj)[0];
      lines.push(`-> Hash -> ${formatNodeLine(inner, false)}`);
      // Đệ quy tiếp nếu node con bên trong có con
      if (currentDepth + 1 <= maxDepth && Array.isArray(inner.Plans) && inner.Plans.length > 0) {
        lines.push(...formatChildren(inner, currentDepth + 1, maxDepth));
      }
    } else {
      lines.push(`-> ${formatNodeLine(child, false)}`);
      if (currentDepth + 1 <= maxDepth && Array.isArray(child.Plans) && child.Plans.length > 0) {
        lines.push(...formatChildren(child, currentDepth + 1, maxDepth));
      }
    }
  }

  return lines;
}

/**
 * Nén JSON kế hoạch thực thi thành chuỗi bằng chứng nén (Plan Evidence)
 * Định dạng:
 * [PLAN_EVIDENCE: <Node Type> on <Relation> | Actual Rows: <X> (Est: <Y>) | Buffers: <H> hit, <R> read | Filter: <Cond>]
 */
export function minifyPlanJson(rawPlan: unknown, options?: FormatOptions): string {
  const root = extractRootPlanNode(rawPlan);
  if (!root) return "";

  const maxDepth = options?.maxDepth ?? 2;
  const isJoin = Array.isArray(root.Plans) && root.Plans.length > 0;
  const maxTokens = options?.maxTokens ?? (isJoin ? 80 : 45);

  const rootLine = formatNodeLine(root, true);
  const childLines = formatChildren(root, 1, maxDepth);

  let result = `[PLAN_EVIDENCE: ${rootLine}`;
  if (childLines.length > 0) {
    result += `\n${childLines.join("\n")}`;
  }
  result += `]`;

  // Kiểm soát token: nếu vượt quá maxTokens, rút gọn bớt
  if (estimateTokens(result) > maxTokens) {
    // Cố gắng loại bớt các dòng con cuối cùng trước
    while (childLines.length > 0 && estimateTokens(result) > maxTokens) {
      childLines.pop();
      result = `[PLAN_EVIDENCE: ${rootLine}`;
      if (childLines.length > 0) {
        result += `\n${childLines.join("\n")}`;
      }
      result += `]`;
    }

    // Nếu vẫn vượt quá (đối với câu đơn), cắt bớt chuỗi
    if (estimateTokens(result) > maxTokens) {
      const maxChars = Math.floor(maxTokens * 3.7) - 4; // chừa chỗ cho "...]"
      if (result.length > maxChars) {
        result = result.slice(0, maxChars) + "...]";
      }
    }
  }

  return result;
}
