import type { EngineId } from "@/contracts/engine";
import type { RuleHit } from "@/contracts/finding";
import type { EvidencePack } from "@/contracts/mentor";
import type { Plan, PlanNode } from "@/contracts/plan";
import type { CapacityPoint, WhatIfData, WhatIfSide } from "@/contracts/whatif";

export const MAX_PACK_BYTES = 48 * 1024;
const MAX_COPY_DEPTH = 50; // shortcut: cắt cây quá sâu khi sao chép để khỏi tràn stack, đủ cho mọi plan thật

export type EvidenceInput = {
  engine: EngineId;
  sql: string;
  plan?: Plan;
  findings?: RuleHit[];
  whatIf?: WhatIfData;
  capacity?: CapacityPoint[];
};

const enc = new TextEncoder();
export const packBytes = (p: unknown) => enc.encode(JSON.stringify(p)).length;

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const compact = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

// Chỉ chép các trường có tên trong kiểu: trường thừa (ví dụ `rows`) không lọt vào gói.
function copyNode(n: unknown, depth = 0): PlanNode | undefined {
  if (!isObj(n) || depth > MAX_COPY_DEPTH) return undefined;
  const kids = Array.isArray(n.children) ? n.children : [];
  return compact({
    id: str(n.id) ?? "",
    kind: (str(n.kind) ?? "other") as PlanNode["kind"],
    label: str(n.label) ?? "",
    table: str(n.table),
    index: str(n.index),
    condition: str(n.condition),
    filter: str(n.filter),
    estimatedRows: num(n.estimatedRows),
    actualRows: num(n.actualRows),
    loops: num(n.loops),
    pagesRead: num(n.pagesRead),
    children: kids.map((k) => copyNode(k, depth + 1)).filter((k): k is PlanNode => !!k),
  });
}

function copyPlan(p: unknown): Plan | undefined {
  if (!isObj(p)) return undefined;
  const root = copyNode(p.root);
  if (!root) return undefined;
  return { engine: p.engine as EngineId, analyzed: p.analyzed === true, root };
}

function copyFinding(f: unknown): RuleHit | undefined {
  if (!isObj(f) || typeof f.ruleId !== "string" || typeof f.messageKey !== "string") return undefined;
  const values = isObj(f.values)
    ? Object.fromEntries(Object.entries(f.values).filter(([, v]) => typeof v === "string" || num(v) !== undefined))
    : undefined;
  return compact({
    ruleId: f.ruleId,
    messageKey: f.messageKey,
    values: values as RuleHit["values"],
    table: str(f.table),
    column: str(f.column),
    statementIndex: num(f.statementIndex),
    start: num(f.start),
    end: num(f.end),
  });
}

function copySide(s: unknown): WhatIfSide | undefined {
  if (!isObj(s)) return undefined;
  const plan = copyPlan(s.plan);
  const rows = num(s.rows);
  const pagesRead = num(s.pagesRead);
  return plan && rows !== undefined && pagesRead !== undefined ? { rows, pagesRead, plan } : undefined;
}

function copyWhatIf(w: unknown): WhatIfData | undefined {
  if (!isObj(w)) return undefined;
  const before = copySide(w.before);
  const after = copySide(w.after);
  if (!before || !after || (w.pagesChange !== "fewer" && w.pagesChange !== "same" && w.pagesChange !== "more")) return undefined;
  return { before, after, pagesChange: w.pagesChange, rowsChanged: w.rowsChanged === true };
}

function copyCapacity(c: unknown): CapacityPoint | undefined {
  if (!isObj(c)) return undefined;
  const rows = num(c.rows), height = num(c.height), indexBytes = num(c.indexBytes);
  return rows === undefined || height === undefined || indexBytes === undefined
    ? undefined
    : compact({ rows, height, indexBytes, pagesRead: num(c.pagesRead) });
}

const pruneNode = (n: PlanNode, depth: number): PlanNode => ({ ...n, children: depth <= 1 ? [] : n.children.map((c) => pruneNode(c, depth - 1)) });
const prunePlan = (p: Plan, depth: number): Plan => ({ ...p, root: pruneNode(p.root, depth) });
const depthOf = (n: PlanNode): number => 1 + Math.max(0, ...n.children.map(depthOf));

// Cắt SQL còn tối đa `n` đơn vị UTF-16, không để lại nửa cặp đôi.
function cutSql(sql: string, n: number): string {
  let s = sql.slice(0, n);
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
  return s;
}

const clip = (s: string | undefined) => (s === undefined ? s : cutSql(s, 200));
const clipNode = (n: PlanNode): PlanNode => compact({ ...n, label: clip(n.label)!, condition: clip(n.condition), filter: clip(n.filter), table: clip(n.table), index: clip(n.index), children: n.children.map(clipNode) });
const clipPlan = (p: Plan): Plan => ({ ...p, root: clipNode(p.root) });

export function buildEvidencePack(input: EvidenceInput): EvidencePack {
  const i = input as Record<string, unknown>;
  const pack: EvidencePack = compact({
    engine: input.engine,
    sql: str(i.sql) ?? "",
    plan: copyPlan(i.plan),
    findings: Array.isArray(i.findings) ? i.findings.map(copyFinding).filter((f): f is RuleHit => !!f) : undefined,
    whatIf: copyWhatIf(i.whatIf),
    capacity: Array.isArray(i.capacity) ? i.capacity.map(copyCapacity).filter((c): c is CapacityPoint => !!c) : undefined,
  }) as EvidencePack;
  const fits = () => packBytes(pack) <= MAX_PACK_BYTES;
  if (fits()) return pack;

  // Thứ tự cắt: capacity, cây plan sâu, SQL, rồi (cuối cùng) findings và whatIf.
  delete pack.capacity;
  if (!fits()) {
    const depths = [pack.plan?.root, pack.whatIf?.before.plan.root, pack.whatIf?.after.plan.root].filter((n): n is PlanNode => !!n).map(depthOf);
    for (let d = Math.max(1, ...depths) - 1; d >= 1 && !fits(); d--) {
      if (pack.plan) pack.plan = prunePlan(pack.plan, d);
      if (pack.whatIf) {
        const { before, after } = pack.whatIf;
        pack.whatIf = { ...pack.whatIf, before: { ...before, plan: prunePlan(before.plan, d) }, after: { ...after, plan: prunePlan(after.plan, d) } };
      }
    }
  }
  // Chuỗi dài trong plan (label, condition lấy từ SQL) cũng phải cắt nếu bỏ hết SQL vẫn không đủ chỗ.
  const sqlFull = pack.sql;
  pack.sql = "";
  const fitsEmpty = fits();
  pack.sql = sqlFull;
  if (!fitsEmpty) {
    if (pack.plan) pack.plan = clipPlan(pack.plan);
    if (pack.whatIf) pack.whatIf = { ...pack.whatIf, before: { ...pack.whatIf.before, plan: clipPlan(pack.whatIf.before.plan) }, after: { ...pack.whatIf.after, plan: clipPlan(pack.whatIf.after.plan) } };
  }
  if (!fits()) {
    const original = pack.sql;
    pack.sqlTruncated = true;
    let lo = 0, hi = original.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      pack.sql = cutSql(original, mid);
      if (fits()) lo = mid; else hi = mid - 1;
    }
    pack.sql = cutSql(original, lo);
  }
  // Phần còn lại vẫn quá cỡ dù SQL rỗng: bỏ bớt findings, rồi whatIf, để gói luôn dưới giới hạn.
  if (pack.findings && !fits()) {
    const all = pack.findings;
    let lo = 0, hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      pack.findings = all.slice(0, mid);
      if (fits()) lo = mid; else hi = mid - 1;
    }
    pack.findings = all.slice(0, lo);
  }
  if (!fits()) delete pack.whatIf;
  if (!fits()) delete pack.plan; // lưới cuối: gói luôn <= MAX_PACK_BYTES
  return pack;
}
