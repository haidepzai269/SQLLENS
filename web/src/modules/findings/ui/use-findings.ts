import { useEffect, useState } from "react";
import type { Outcome } from "@/contracts/conclusion";
import type { EngineId } from "@/contracts/engine";
import type { FindingData, RuleHit } from "@/contracts/finding";
import type { Plan } from "@/contracts/plan";
import type { ParsedStatement } from "@/modules/sql-intake/parser/types";
import { attachEvidence } from "../evidence";
import { checkQueries } from "../query-rules";
import { checkSchema } from "../schema-rules";

/** Phần của một lần chạy mà cột Rủi ro cần. `statements` vắng nghĩa là parser không đọc được SQL đã chạy. */
export type FindingsRun = {
  id: number;
  engine: EngineId;
  /** SQL đã chạy thật (sau khi bỏ khối COPY và LOCK); vị trí của luật tính trên chuỗi này. */
  sql: string;
  /** SQL trong ô soạn lúc bấm Chạy. */
  srcSql: string;
  statements?: ParsedStatement[];
  /** Dùng chung với tab Plan: mỗi câu SELECT chỉ explain một lần cho mỗi lần chạy. */
  explain: (sql: string) => Promise<Outcome<Plan>>;
};
export type Item = { hit: RuleHit; outcome: Outcome<FindingData> };
export type FindingsResult = { kind: "ok"; items: Item[] } | { kind: "no_parse" } | { kind: "error"; message: string };

async function compute(run: FindingsRun): Promise<FindingsResult> {
  const stmts = run.statements;
  if (!stmts) return { kind: "no_parse" };
  const hits = [...checkSchema(stmts, run.engine), ...checkQueries(stmts, run.engine, run.sql)];
  // Chỉ SELECT được explain (explain chạy thật câu đó); luật trên câu ghi dữ liệu nhận "chưa mô phỏng được".
  const wanted = [...new Set(hits.filter((h) => h.messageKey.startsWith("findings.query.") && h.table).map((h) => h.statementIndex))];
  const plans: { statementIndex: number; plan: Outcome<Plan> }[] = [];
  for (const i of wanted) {
    const st = stmts.find((s) => s.index === i);
    if (i === undefined || !st || st.kind !== "select") continue;
    try {
      plans.push({ statementIndex: i, plan: await run.explain(run.sql.slice(st.start, st.end)) });
    } catch {
      plans.push({ statementIndex: i, plan: { kind: "not_simulated", reasonKey: "findingsUi.explainError" } });
    }
  }
  const out = attachEvidence(hits, { plans });
  return { kind: "ok", items: hits.map((hit, k) => ({ hit, outcome: out[k] })) };
}

/** null: đang kiểm. Kết quả gắn với `run.id`, nên lần chạy mới không hiện kết quả cũ và câu trả về muộn của lần cũ bị bỏ. */
export function useFindings(run: FindingsRun | null): FindingsResult | null {
  const [s, set] = useState<{ id: number; r: FindingsResult } | null>(null);
  const id = run?.id;
  useEffect(() => {
    if (!run) return;
    let live = true;
    compute(run).then(
      (r) => live && set({ id: run.id, r }),
      (e) => live && set({ id: run.id, r: { kind: "error", message: e instanceof Error ? e.message : String(e) } }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run.id mô tả đủ đầu vào; dữ liệu sinh thêm cũng đổi id
  }, [id]);
  return run && s && s.id === run.id ? s.r : null;
}

/** Hit gửi cho Mentor: bản đã ghép table, column vào values nếu có. */
export const hitsOf = (items: Item[]): RuleHit[] => items.map((i) => (i.outcome.kind === "conclusion" ? i.outcome.data.hit : i.hit));
