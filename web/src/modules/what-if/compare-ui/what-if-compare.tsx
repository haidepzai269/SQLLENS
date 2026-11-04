"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SqlErrorView } from "@/components/result-grid/sql-error-view";
import { SqlEditor } from "@/components/sql-editor/sql-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { EvidenceLabel, Outcome } from "@/contracts/conclusion";
import { EngineError, type EngineAdapter } from "@/contracts/engine";
import type { WhatIfData, WhatIfSide } from "@/contracts/whatif";
import { PlanTree } from "@/modules/plan-runner/plan-tree";
import { compareFix } from "../compare/compare-fix";

type State =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; change: string; outcome: Outcome<WhatIfData> }
  | { phase: "failed"; change: string; code: string; message: string; position?: number; guardKey?: string; guardIndex?: number };

const KNOWN_FAILURES = new Set(["timeout", "cancelled", "worker_crashed", "load_failed"]);
// Engine báo position 1-based theo code point; ô soạn cần chỉ số 0-based theo UTF-16.
const toEditorPos = (sql: string, p: number) => Array.from(sql).slice(0, p - 1).join("").length;
// Chỉ SELECT mới tin được số dòng: với câu ghi, nút gốc plan thường báo 0 dòng (ghi chú Task054).
const isSelect = (sql: string) => /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*select\b/i.test(sql);

function Column({ title, side, label, showRows }: { title: string; side: WhatIfSide; label: EvidenceLabel; showRows: boolean }) {
  const t = useTranslations("whatIfUi");
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2" data-testid="whatif-column">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sm font-semibold">{title}</h3>
      </div>
      <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {showRows && (
          <div>
            <dt className="text-xs text-dim">{t("rows")}</dt>
            <dd className="m-0 text-lg font-semibold tabular-nums" data-testid="whatif-rows">{side.rows}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-dim">{t("pages")}</dt>
          <dd className="m-0 text-lg font-semibold tabular-nums" data-testid="whatif-pages">{side.pagesRead}</dd>
        </div>
      </dl>
      <PlanTree plan={side.plan} label={label} />
    </section>
  );
}

export function WhatIfCompare({ adapter, probe }: { adapter: Pick<EngineAdapter, "tryChange">; probe: string }) {
  const t = useTranslations("whatIfUi");
  const tr = useTranslations() as unknown as (key: string, values?: Record<string, string | number>) => string; // khóa tryChange.*, whatIfCompare.*, guard.* do engine trả về
  const [change, setChange] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const [empty, setEmpty] = useState(false);
  const seq = useRef(0);
  // Rời màn hình thì bỏ kết quả đang chờ.
  useEffect(() => () => void seq.current++, []);

  async function run() {
    const sql = change;
    if (!sql.trim()) return setEmpty(true);
    setEmpty(false);
    const id = ++seq.current; // câu trả về muộn của lần chạy cũ không được ghi đè lần mới
    setState({ phase: "running" });
    try {
      const outcome = await compareFix(adapter, { change: sql, probe });
      if (id === seq.current) setState({ phase: "done", change: sql, outcome });
    } catch (e) {
      if (id !== seq.current) return;
      const en = e instanceof EngineError ? e : undefined;
      setState({
        phase: "failed",
        change: sql,
        code: en?.code ?? "unknown",
        message: e instanceof Error ? e.message : String(e),
        position: en?.code === "sql" && !en.guard ? en.position : undefined,
        guardKey: en?.guard?.reasonKey,
        guardIndex: en?.guard?.statementIndex,
      });
    }
  }

  const running = state.phase === "running";
  const shown = state.phase === "done" || state.phase === "failed" ? state.change : undefined;
  const errPos = state.phase === "failed" && state.position !== undefined && state.change === change ? state.position : undefined;

  return (
    <section aria-label={t("region")} className="flex min-w-0 flex-col gap-3" data-testid="whatif" aria-busy={running}>
      <div
        className="flex min-w-0 flex-col gap-1"
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            void run();
          }
        }}
      >
        <span className="text-sm font-semibold">{t("editorLabel")}</span>
        <p className="m-0 text-xs text-dim">{t("editorHint")}</p>
        <div className="h-32 min-w-0 overflow-hidden border border-line" data-testid="whatif-editor">
          <SqlEditor
            value={change}
            onChange={(v) => {
              setChange(v);
              setEmpty(false);
            }}
            engine="postgres"
            error={errPos !== undefined ? { position: toEditorPos(change, errPos), message: state.phase === "failed" ? state.message : "" } : undefined}
            ariaLabel={t("editorLabel")}
          />
        </div>
        <p className="m-0 min-w-0 text-xs text-dim">
          {t("probeLabel")}: <code className="break-all font-mono" data-testid="whatif-probe">{probe}</code>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void run()} data-testid="whatif-run">{running ? t("running") : t("run")}</Button>
        <span className="text-xs text-dim">{t("runShortcut")}</span>
      </div>
      <div aria-live="polite" className="flex min-w-0 flex-col gap-3">
        {empty && (
          <Alert variant="destructive" data-testid="whatif-empty">
            <AlertDescription>{t("empty")}</AlertDescription>
          </Alert>
        )}
        {state.phase === "idle" && <p className="m-0 text-sm text-dim" data-testid="whatif-idle">{t("idle")}</p>}
        {running && <p className="m-0 text-sm text-dim" data-testid="whatif-running">{t("running")}</p>}
        {shown !== undefined && shown !== change && (
          <p role="note" className="m-0 text-xs text-ink2" data-testid="whatif-stale">{t("stale")}</p>
        )}
        {state.phase === "failed" &&
          (state.guardKey ? (
            <Alert variant="destructive" data-testid="whatif-error"><AlertDescription>{tr(state.guardKey, { index: state.guardIndex ?? 0 })}</AlertDescription></Alert>
          ) : state.code === "sql" ? (
            <div data-testid="whatif-error"><SqlErrorView message={state.message} position={state.position} sql={state.change} /></div>
          ) : (
            <Alert variant="destructive" data-testid="whatif-error">
              <AlertDescription>{t(`failed.${KNOWN_FAILURES.has(state.code) ? state.code : "unknown"}`)}</AlertDescription>
            </Alert>
          ))}
        {state.phase === "done" && state.outcome.kind === "not_simulated" && (
          <Alert data-testid="whatif-notsimulated">
            <AlertDescription>
              <strong>{t("notSimulated")}.</strong> {tr(state.outcome.reasonKey)}
            </AlertDescription>
          </Alert>
        )}
        {state.phase === "done" && state.outcome.kind === "conclusion" && (() => {
          const { data, label, evidence } = state.outcome;
          const rowsTrusted = isSelect(probe);
          const diff = Math.abs(data.before.pagesRead - data.after.pagesRead);
          return (
            <div className="flex min-w-0 flex-col gap-3" data-testid="whatif-result">
              <p className="m-0 text-sm font-semibold" data-testid="whatif-delta" data-change={data.pagesChange}>
                {t(`delta.${data.pagesChange}`, { before: data.before.pagesRead, after: data.after.pagesRead, diff })}
              </p>
              {rowsTrusted && data.rowsChanged && (
                <Alert variant="destructive" data-testid="whatif-rows-changed">
                  <AlertDescription>{t("rowsChanged", { before: data.before.rows, after: data.after.rows })}</AlertDescription>
                </Alert>
              )}
              {!rowsTrusted && <p role="note" className="m-0 text-xs text-ink2" data-testid="whatif-rows-skipped">{t("rowsNotCompared")}</p>}
              <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                <Column title={t("before")} side={data.before} label={label} showRows={rowsTrusted} />
                <Column title={t("after")} side={data.after} label={label} showRows={rowsTrusted} />
              </div>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-ink2">
                {evidence.filter((e) => rowsTrusted || e.kind !== "rows").map((e) => (
                  <li key={e.kind}>{tr(e.messageKey, e.values)}</li>
                ))}
              </ul>
            </div>
          );
        })()}
      </div>
    </section>
  );
}
