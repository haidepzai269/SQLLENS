import type { Conclusion, Outcome } from "@/contracts/conclusion";
import type { EngineAdapter } from "@/contracts/engine";
import type { PlanNode } from "@/contracts/plan";
import type { CapacityPoint, CapacitySample } from "@/contracts/whatif";

const PAGE = 8192;
/** Đến mức này phải đo thật (CLAUDE.md, Capacity Advisor); chỉ trên mức này mới ngoại suy. */
export const MEASURE_LIMIT = 500_000;
export const ESTIMATE_LIMIT = 1_000_000_000;
const no = (reason: string): Outcome<never> => ({ kind: "not_simulated", reasonKey: `capacity.${reason}` });
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

type Adapter = Pick<EngineAdapter, "readBTree" | "explain" | "execute">;

// undefined khi không nút nào có số trang, để không biến "không đo được" thành 0.
function pagesOf(n: PlanNode): number | undefined {
  const parts = [n.pagesRead, ...n.children.map(pagesOf)].filter((x): x is number => x !== undefined);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : undefined;
}

/**
 * Đo từ cây thật: số tầng, số trang (tính cả metapage, bằng pg_relation_size / 8192), số leaf và độ rộng node.
 * Số leaf lấy từ `nodes` cộng `hidden`, vì cây lớn chỉ đọc một phần các trang.
 */
export async function measureCapacity(
  adapter: Adapter,
  input: { index: string; table: string; probe?: string },
): Promise<Outcome<CapacitySample>> {
  const [count] = await adapter.execute(`SELECT count(*) FROM public.${quote(input.table)}`, { internal: true });
  const rows = Number(count.rows[0]?.[0]);
  if (!Number.isFinite(rows)) return no("countFailed");
  if (rows === 0) return no("empty");

  // maxNodes 1: chỉ cần số trang từng tầng, không cần nội dung node.
  const { model } = await adapter.readBTree(input.index, { maxNodes: 1 });
  if (model.kind !== "conclusion") return model;
  const b = model.data;

  const perLevel = new Map<number, number>();
  for (const n of b.nodes) perLevel.set(n.level, (perLevel.get(n.level) ?? 0) + 1);
  for (const h of b.hidden) perLevel.set(h.level, (perLevel.get(h.level) ?? 0) + h.count);
  const leafPages = perLevel.get(0) ?? 0;
  if (leafPages === 0) return no("empty");
  const internalPages = [...perLevel].reduce((s, [l, c]) => s + (l > 0 ? c : 0), 0);

  let pagesRead: number | undefined;
  if (input.probe) {
    const plan = await adapter.explain(input.probe);
    if (plan.kind === "conclusion") pagesRead = pagesOf(plan.data.root);
  }

  const sample: CapacitySample = {
    index: input.index,
    table: input.table,
    rows,
    height: b.height,
    indexPages: b.totalPages,
    leafPages,
    leafFanout: rows / leafPages,
    // Mỗi trang không phải root có đúng một cha, nên số con của mọi trang internal cộng lại là (số trang trừ root).
    ...(internalPages ? { internalFanout: (leafPages + internalPages - 1) / internalPages } : {}),
    ...(pagesRead !== undefined ? { pagesRead } : {}),
  };
  return {
    kind: "conclusion",
    label: "real",
    data: sample,
    evidence: [{ kind: "pageinspect", messageKey: "capacity.measured", values: { index: input.index, rows, height: sample.height, pages: sample.indexPages } }],
  };
}

export const samplePoint = (s: CapacitySample): CapacityPoint => ({
  rows: s.rows,
  height: s.height,
  indexBytes: s.indexPages * PAGE,
  ...(s.pagesRead !== undefined ? { pagesRead: s.pagesRead } : {}),
});

/**
 * Ngoại suy bằng độ rộng node đã đo: số leaf, rồi chia cho internalFanout từng tầng đến khi còn một trang.
 * Giới hạn: internalFanout đo từ mẫu chỉ có root làm internal là cận dưới (root thường chưa đầy), nên có thể dư vài trang internal.
 */
export function estimateCapacity(sample: CapacitySample, rows: number): Outcome<CapacityPoint> {
  if (!Number.isFinite(rows) || rows <= MEASURE_LIMIT) return no("mustMeasure");
  if (rows > ESTIMATE_LIMIT) return no("tooLarge");
  if (!Number.isFinite(sample.leafFanout) || sample.leafFanout <= 0) return no("noFanout");
  const f = sample.internalFanout;
  // f <= 1 thì vòng chia không bao giờ dừng.
  if (f === undefined || !Number.isFinite(f) || f <= 1) return no("noInternalFanout");

  let level = Math.ceil(rows / sample.leafFanout);
  let pages = level;
  let height = 1;
  while (level > 1) {
    level = Math.ceil(level / f);
    pages += level;
    height++;
  }
  const point: CapacityPoint = {
    rows,
    height,
    indexBytes: (pages + 1) * PAGE, // +1 metapage
    ...(sample.pagesRead !== undefined ? { pagesRead: Math.max(0, sample.pagesRead + height - sample.height) } : {}),
  };
  const c: Conclusion<CapacityPoint> = {
    kind: "conclusion",
    label: "estimated",
    data: point,
    evidence: [{ kind: "extrapolation", messageKey: "capacity.estimated", values: { fromRows: sample.rows, rows, index: sample.index, height } }],
  };
  return c;
}
