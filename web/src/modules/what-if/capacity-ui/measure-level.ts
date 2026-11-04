import type { BTreeModel } from "@/contracts/btree";
import type { Evidence, Outcome } from "@/contracts/conclusion";
import type { EngineAdapter } from "@/contracts/engine";
import type { CapacitySample } from "@/contracts/whatif";
import { parseSchema, planData, SCHEMA_QUERY } from "@/modules/data-lab/generate/plan-data";
import { measureCapacity } from "../capacity/capacity";

// Nạp dữ liệu vào bảng tạm cùng cấu trúc, không vào bảng của người dùng: đường sinh dữ liệu chỉ INSERT từ khóa 1,
// nên nạp vào bảng đã có dòng sẽ trùng khóa, còn muốn đủ N dòng thì phải xóa dòng cũ. Bảng tạm luôn bị DROP khi xong.
export const SCRATCH = "sqllens_capacity_scratch";
export const SCRATCH_INDEX = "sqllens_capacity_scratch_ix";
const INTERNAL = { internal: true } as const;

export class Cancelled extends Error {}
export type Stage = { stage: "prepare" | "load" | "index" | "read"; done?: number; total?: number };
export type Measured = { sample: CapacitySample; model?: BTreeModel };

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const no = (reason: string): Outcome<never> => ({ kind: "not_simulated", reasonKey: `capacityUi.${reason}` });

/** Câu thăm dò gọi bảng của người dùng; đổi tên bảng sang bảng tạm. */
// shortcut: thay theo tên, chuỗi chữ trong câu thăm dò trùng tên bảng cũng bị đổi; nâng lên dùng parser khi cần.
export function retarget(probe: string, table: string): string {
  const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = re(q(table));
  const lower = table === table.toLowerCase();
  return probe.replace(new RegExp(lower ? `${quoted}|(?<![\\w"$])${re(table)}(?![\\w"$])` : quoted, lower ? "gi" : "g"), q(SCRATCH));
}

/** Kiểm bảng và index có đủ điều kiện đo. Trả phần đuôi của định nghĩa index (từ USING) để dựng lại trên bảng tạm. */
export async function checkTarget(adapter: Pick<EngineAdapter, "execute">, index: string, table: string): Promise<Outcome<{ tail: string; table: ReturnType<typeof parseSchema>[number] }>> {
  const run = (sql: string) => adapter.execute(sql, INTERNAL);
  const tb = parseSchema((await run(SCHEMA_QUERY))[0]).find((x) => x.schema === "public" && x.name === table);
  if (!tb) return no("tableMissing");
  const r = (
    await run(
      `SELECT pg_get_indexdef(i.indexrelid), am.amname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid ` +
        `JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_am am ON am.oid = c.relam WHERE n.nspname = 'public' AND c.relname = ${lit(index)} AND t.relname = ${lit(table)}`,
    )
  )[0].rows[0] as [string, string] | undefined;
  if (!r) return no("indexMissing");
  if (r[1] !== "btree") return no("notBtree");
  const tail = r[0].slice(r[0].indexOf(" USING "));
  // Task055: index một phần làm leafFanout sai (count(*) tính cả bảng), nên không đo.
  if (/\sWHERE\s/i.test(tail)) return no("partial");
  return { kind: "conclusion", label: "real", data: { tail, table: tb }, evidence: [{ kind: "catalog", messageKey: "capacityUi.checked" }] };
}

/**
 * Sinh `rows` dòng vào bảng tạm có cùng cột, dựng lại index, rồi đo bằng measureCapacity. Bảng của người dùng chỉ được đọc.
 * Ném Cancelled khi `isCancelled()` thành true giữa các lô; ném lỗi của adapter hoặc của planData nếu không sinh được.
 */
export async function measureLevel(
  adapter: Pick<EngineAdapter, "execute" | "explain" | "readBTree">,
  o: { index: string; table: string; probe?: string; rows: number; isCancelled: () => boolean; onStage: (s: Stage) => void },
): Promise<Outcome<Measured>> {
  const run = (sql: string) => adapter.execute(sql, INTERNAL);
  o.onStage({ stage: "prepare" });
  const chk = await checkTarget(adapter, o.index, o.table);
  if (chk.kind !== "conclusion") return chk;
  if ((await run(`SELECT to_regclass(${lit(`public.${q(SCRATCH)}`)}) IS NOT NULL`))[0].rows[0][0] === true) return no("scratchBusy");

  const columns = chk.data.table.columns.map((c) => {
    const x = { ...c };
    delete x.references; // bảng tạm không có khóa ngoại, không cần bảng cha
    delete x.generated; // cột tự sinh thành cột thường, để không dùng chung sequence của người dùng
    return x;
  });
  const plan = planData([{ ...chk.data.table, name: SCRATCH, columns }], { [SCRATCH]: o.rows });

  let created = false;
  try {
    await run(`CREATE TABLE public.${q(SCRATCH)} (LIKE public.${q(o.table)})`);
    created = true;
    for (let i = 0; i < plan.batches.length; i++) {
      if (o.isCancelled()) throw new Cancelled();
      o.onStage({ stage: "load", done: i, total: plan.batches.length });
      await run(plan.batches[i]);
    }
    if (o.isCancelled()) throw new Cancelled();
    o.onStage({ stage: "index" });
    // Không UNIQUE: cột đa khóa duy nhất không được đánh dấu nên dữ liệu sinh có thể trùng; kích thước index gần như không đổi.
    await run(`CREATE INDEX ${q(SCRATCH_INDEX)} ON public.${q(SCRATCH)}${chk.data.tail}`);
    if (o.isCancelled()) throw new Cancelled();
    o.onStage({ stage: "read" });
    const m = await measureCapacity(adapter, { index: SCRATCH_INDEX, table: SCRATCH, probe: o.probe ? retarget(o.probe, o.table) : undefined });
    if (m.kind !== "conclusion") return m;
    const { model } = await adapter.readBTree(SCRATCH_INDEX);
    const ev: [Evidence, ...Evidence[]] = [{ ...m.evidence[0], values: { ...m.evidence[0].values, index: o.index } }];
    return {
      kind: "conclusion",
      label: "real",
      data: {
        sample: { ...m.data, index: o.index, table: o.table },
        ...(model.kind === "conclusion" ? { model: { ...model.data, index: o.index, table: o.table } } : {}),
      },
      evidence: ev,
    };
  } finally {
    if (created) await run(`DROP TABLE IF EXISTS public.${q(SCRATCH)}`).catch(() => {}); // worker có thể đã chết: rebuild() dựng phiên mới không có bảng này
  }
}
