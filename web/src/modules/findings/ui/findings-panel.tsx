"use client";

import { CircleDot, OctagonX, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Severity } from "@/contracts/finding";
import type { FindingsResult, FindingsRun, Item } from "./use-findings";

/** Điều cột Rủi ro nhờ phần còn lại của màn hình làm. `where`: vùng hiện ra trên điện thoại. */
export type Focus = { runId: number; start?: number; end?: number; table?: string; tab?: "schema" | "plan"; planNodeId?: string; where: "sql" | "stage" };

// Màu ở border và nền nhẹ; chữ và icon luôn đi kèm, màu không phải tín hiệu duy nhất.
const TONE: Record<Severity, string> = {
  broken: "border-severity-broken bg-severity-broken-bg",
  unverified: "border-severity-uncertain bg-severity-uncertain-bg",
  not_broken: "border-severity-passed bg-severity-passed-bg",
};
const ICON = { broken: OctagonX, unverified: TriangleAlert, not_broken: CircleDot } as const;
export const RULES = ["missing-pk", "fk-no-index", "float-money", "varchar-too-large", "function-on-indexed-column", "leading-wildcard", "composite-prefix", "implicit-cast"] as const;

export function FindingsPanel({
  run, result, stale, planStatement, onFocus,
}: {
  run: FindingsRun;
  result: FindingsResult | null;
  /** SQL trong ô soạn đã khác SQL của lần chạy này. */
  stale: boolean;
  /** Chỉ số câu SELECT đang hiện ở tab Plan. */
  planStatement?: number;
  onFocus: (f: Focus) => void;
}) {
  const t = useTranslations("findingsUi");
  const tr = useTranslations() as unknown as (key: string, values?: Record<string, string | number>) => string;
  const [sel, setSel] = useState<number | null>(null); // panel được key theo run.id nên lựa chọn không sang lần chạy khác
  const mapped = !stale && run.sql === run.srcSql;
  const focus = (i: number, it: Item, only?: "sql" | "plan") => {
    setSel(i);
    const h = it.hit;
    const planNodeId = it.outcome.kind === "conclusion" ? it.outcome.data.planNodeId : undefined;
    if (only === "plan") return onFocus({ runId: run.id, tab: "plan", planNodeId, where: "stage" });
    const pos = h.start !== undefined && h.end !== undefined && mapped;
    // Điện thoại chỉ thấy một vùng: có bảng thì mở sơ đồ, nút "Xem trong SQL" đưa về ô soạn.
    const toSchema = only !== "sql" && !!h.table;
    onFocus({ runId: run.id, start: pos ? h.start : undefined, end: pos ? h.end : undefined, table: toSchema ? h.table : undefined, tab: toSchema ? "schema" : undefined, where: toSchema ? "stage" : "sql" });
  };

  if (result === null)
    return (
      <div role="status" aria-label={t("checking")} className="flex flex-col gap-2" data-testid="findings-loading">
        <span className="text-sm text-muted-foreground">{t("checking")}</span>
        <Skeleton className="h-16 w-full" aria-hidden />
      </div>
    );
  if (result.kind === "error")
    return (
      <Alert variant="destructive" data-testid="findings-error">
        <AlertDescription>{t("error", { message: result.message })}</AlertDescription>
      </Alert>
    );
  if (result.kind === "no_parse")
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground" data-testid="findings-noparse">
        {t("noParse")}
      </p>
    );

  const { items } = result;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="findings">
      {stale && (
        <Alert data-testid="findings-stale">
          <AlertDescription>{t("stale")}</AlertDescription>
        </Alert>
      )}
      {!stale && !mapped && <p className="m-0 text-xs text-dim">{t("unmapped")}</p>}
      {items.length === 0 ? (
        <div className="flex flex-col gap-1 text-sm" data-testid="findings-empty">
          <p className="m-0">{t("empty")}</p>
          <p className="m-0 text-xs text-dim">{t("scope", { rules: RULES.map((r) => t(`rule.${r}`)).join("; ") })}</p>
        </div>
      ) : (
        <>
          <p className="m-0 text-xs text-dim">{t("count", { count: items.length })}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((it, i) => {
              const c = it.outcome.kind === "conclusion" ? it.outcome : null;
              const sev: Severity = c ? c.data.severity : "unverified";
              const Icon = ICON[sev];
              const h = c ? c.data.hit : it.hit;
              const planBtn = !!c?.data.planNodeId && it.hit.statementIndex === planStatement;
              return (
                <li key={i} className={`flex min-w-0 flex-col gap-1 border p-2 ${TONE[sev]} ${sel === i ? "ring-2 ring-lamp" : ""}`} data-testid="finding" data-severity={c ? sev : "not_simulated"}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-col gap-1 bg-transparent p-0 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-lamp"
                    aria-pressed={sel === i}
                    onClick={() => focus(i, it)}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="text-xs font-semibold" data-testid="finding-severity">{t(c ? `severity.${sev}` : "severity.not_simulated")}</span>
                      {c && <Badge variant="outline" data-testid="finding-label">{tr(`lab.label.${c.label}`)}</Badge>}
                    </span>
                    <span className="break-words">{tr(h.messageKey, h.values)}</span>
                  </button>
                  {c ? (
                    c.evidence.map((e, k) => (
                      <p key={k} className="m-0 break-words text-xs text-muted-foreground" data-testid="finding-evidence">
                        {tr(e.messageKey, e.values)}
                      </p>
                    ))
                  ) : (
                    <p className="m-0 break-words text-xs" data-testid="finding-not-simulated">
                      {t("notSimulated", { reason: tr((it.outcome as { reasonKey: string }).reasonKey) })}
                    </p>
                  )}
                  {(h.start !== undefined || planBtn) && (
                    <div className="flex flex-wrap gap-2">
                      {h.start !== undefined && (
                        <Button size="sm" variant="outline" disabled={!mapped} onClick={() => focus(i, it, "sql")}>
                          {t("showSql")}
                        </Button>
                      )}
                      {planBtn && (
                        <Button size="sm" variant="outline" onClick={() => focus(i, it, "plan")}>
                          {t("openPlan")}
                        </Button>
                      )}
                    </div>
                  )}
                  {c?.data.planNodeId && !planBtn && <p className="m-0 text-xs text-dim">{t("planElsewhere")}</p>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
