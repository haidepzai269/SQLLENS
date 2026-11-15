import { useEffect, useState } from "react";
import { getStatementAtOffset } from "@/components/sql-editor/statement-at-cursor";
import type { EngineId } from "@/contracts/engine";
import { canRunExplain } from "@/engines/mysql/guard";
import { canExplainSql, runSafeExplainAnalyze } from "@/engines/postgres/safe-explain";
import type { Run } from "@/engines/postgres/try-rollback";

export interface UseActiveQueryPlanOptions {
  editorContent: string;
  cursorOffset?: number;
  selection?: string;
  engine?: EngineId;
  isEnabled?: boolean;
  enabled?: boolean;
  run?: Run;
  timeoutMs?: number;
  debounceMs?: number;
}

export interface UseActiveQueryPlanResult {
  planEvidence: string | null;
  rawJson?: unknown;
  isMeasuring: boolean;
  error?: string;
}

interface MeasuredData {
  sql: string | null;
  planEvidence: string | null;
  rawJson?: unknown;
  error?: string;
}

/**
 * React Hook tự động trích xuất câu lệnh SQL active (tại selection hoặc con trỏ),
 * debounce 300ms và chạy Safe EXPLAIN trong PGlite để trích xuất Plan Evidence nén dưới 40 tokens.
 */
export function useActiveQueryPlan(options: UseActiveQueryPlanOptions): UseActiveQueryPlanResult {
  const {
    editorContent,
    cursorOffset = 0,
    selection,
    engine = "postgres",
    isEnabled,
    enabled,
    run,
    timeoutMs = 1500,
    debounceMs = 300,
  } = options;

  const isFeatureEnabled = isEnabled ?? enabled ?? true;

  const [measuredData, setMeasuredData] = useState<MeasuredData>({
    sql: null,
    planEvidence: null,
  });
  const [isMeasuring, setIsMeasuring] = useState<boolean>(false);

  // 1. Trích xuất active SQL: ưu tiên selection, fallback statement tại cursor
  let activeSql: string | null = null;
  if (selection && selection.trim().length > 0) {
    activeSql = selection.trim();
  } else if (editorContent && editorContent.trim().length > 0) {
    activeSql = getStatementAtOffset(editorContent, cursorOffset);
  }

  // 2. Kiểm tra điều kiện thực thi (có rào chắn Engine Guard chặn MySQL chạy ngầm)
  const isEligible =
    isFeatureEnabled &&
    canRunExplain(engine, false) &&
    engine === "postgres" &&
    !!run &&
    !!activeSql &&
    canExplainSql(activeSql);

  useEffect(() => {
    if (!isEligible || !activeSql || !run) {
      return;
    }

    let isCancelled = false;

    const timer = setTimeout(async () => {
      setIsMeasuring(true);

      try {
        const result = await runSafeExplainAnalyze(run, activeSql, timeoutMs);
        if (!isCancelled) {
          setMeasuredData({
            sql: activeSql,
            planEvidence: result.planEvidence,
            rawJson: result.rawJson,
            error: result.error,
          });
          setIsMeasuring(false);
        }
      } catch (err) {
        if (!isCancelled) {
          setMeasuredData({
            sql: activeSql,
            planEvidence: null,
            rawJson: undefined,
            error: (err as Error)?.message || "explain_failed",
          });
          setIsMeasuring(false);
        }
      }
    }, debounceMs);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [activeSql, isEligible, run, timeoutMs, debounceMs]);

  const isMatch = isEligible && !!activeSql && measuredData.sql === activeSql;

  return {
    planEvidence: isMatch ? measuredData.planEvidence : null,
    rawJson: isMatch ? measuredData.rawJson : undefined,
    isMeasuring: isEligible && isMeasuring,
    error: isMatch ? measuredData.error : undefined,
  };
}
