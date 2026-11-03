"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EngineError, type EngineAdapter } from "@/contracts/engine";
import { parseSchema, planData, SCHEMA_QUERY, type ColumnRule, type TableInfo } from "../generate/plan-data";

// Câu của ứng dụng, không vào history() nên dựng lại không chạy lại chúng.
const INTERNAL = { internal: true } as const;
export type StopCode = "timeout" | "worker_crashed";
const SIZES = [10_000, 100_000, 500_000] as const;
const selectCls =
  "h-8 min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";
type Edit = { distinct: string; nullPct: string; skew: "uniform" | "zipf" };
const NO_EDIT: Edit = { distinct: "", nullPct: "", skew: "uniform" };
type Phase =
  | { p: "loading" }
  | { p: "ready" }
  | { p: "running"; done: number; total: number }
  | { p: "error"; message: string };

// Cột có giá trị do khóa hoặc sequence quyết định thì không chỉnh được.
const tunable = (c: TableInfo["columns"][number]) => !c.isPrimaryKey && !c.isUnique && !c.references && !c.generated;
const intIn = (s: string, lo: number, hi: number) => /^\d+$/.test(s) && +s >= lo && +s <= hi;
const bad = (e: Edit) => (e.distinct !== "" && !intIn(e.distinct, 1, 10_000_000)) || (e.nullPct !== "" && !intIn(e.nullPct, 0, 100));

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getAdapter: () => Promise<EngineAdapter> | null;
  /** `generated`: dữ liệu đã được ghi vào bảng (true), hay đã hoàn tác (false). */
  onSummary: (text: string, generated: boolean) => void;
  onStopped: (code: StopCode) => void;
};

// Chỉ dựng nội dung khi mở, nên mỗi lần mở đọc lại schema từ trạng thái sạch.
export function GenerateDialog(props: Props) {
  return props.open ? <Inner {...props} /> : null;
}

function Inner({ open, onOpenChange, getAdapter, onSummary, onStopped }: Props) {
  const t = useTranslations("data-lab");
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>({ p: "loading" });
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [rows, setRows] = useState<Record<string, number>>({});
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const cancelled = useRef(false);
  const running = phase.p === "running";

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const db = await getAdapter();
        if (!db) throw new Error("no engine");
        const res = await db.execute(SCHEMA_QUERY, INTERNAL);
        const ts = parseSchema(res[0]);
        if (!live) return;
        setTables(ts);
        setRows(Object.fromEntries(ts.map((x) => [x.name, 100_000])));
        setEdits({});
        setPhase({ p: "ready" });
      } catch (e) {
        if (live) {
          setTables([]);
          setPhase({ p: "error", message: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => {
      live = false;
    };
    // getAdapter chỉ đọc ref, không đổi giữa các lần mở.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (key: string) => edits[key] ?? NO_EDIT;
  const patch = (key: string, p: Partial<Edit>) => setEdits((x) => ({ ...x, [key]: { ...edit(key), ...p } }));
  const invalid = tables.some((tb) => tb.columns.some((c) => bad(edit(`${tb.name}.${c.name}`))));
  const has500k = Object.values(rows).includes(500_000);

  async function start() {
    const rules: Record<string, ColumnRule> = {};
    for (const [key, e] of Object.entries(edits)) {
      const r: ColumnRule = {};
      if (e.distinct !== "") r.distinct = +e.distinct;
      if (e.nullPct !== "") r.nullRatio = +e.nullPct / 100;
      if (e.skew === "zipf") r.skew = "zipf";
      if (Object.keys(r).length) rules[key] = r;
    }
    let plan;
    try {
      plan = planData(tables, rows, rules); // lỗi (kiểu không hỗ trợ, v.v.) báo ở đây, trước khi chạm vào dữ liệu
    } catch (e) {
      return setPhase({ p: "error", message: e instanceof Error ? e.message : String(e) });
    }
    const db = await getAdapter();
    if (!db) return;
    cancelled.current = false;
    const total = plan.batches.length;
    setPhase({ p: "running", done: 0, total });
    const t0 = performance.now();
    try {
      await db.execute("BEGIN", INTERNAL);
      for (let i = 0; i < total; i++) {
        if (cancelled.current) {
          await db.execute("ROLLBACK", INTERNAL);
          onSummary(t("cancelledSummary"), false);
          return onOpenChange(false);
        }
        await db.execute(plan.batches[i], INTERNAL);
        setPhase({ p: "running", done: i + 1, total });
      }
      await db.execute("COMMIT", INTERNAL);
      const list = plan.order
        .filter((n) => rows[n] > 0)
        .map((n) => `${n}: ${rows[n].toLocaleString(locale)}`)
        .join(", ");
      onSummary(t("summary", { tables: list, seconds: ((performance.now() - t0) / 1000).toFixed(1) }), true);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof EngineError && (e.code === "timeout" || e.code === "worker_crashed")) {
        onStopped(e.code); // worker đã bị dừng; dựng lại cho phiên mới, không còn dữ liệu sinh dở
        return onOpenChange(false);
      }
      try {
        await db.execute("ROLLBACK", INTERNAL);
      } catch {
        /* worker có thể đã chết; rebuild() dựng phiên mới nên không còn transaction */
      }
      setPhase({ p: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const empty = phase.p === "ready" && tables.length === 0;
  const showForm = tables.length > 0 && phase.p !== "loading";
  return (
    <Dialog open={open} onOpenChange={(o) => (o || !running) && onOpenChange(o)}>
      <DialogContent showCloseButton={!running} className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {phase.p === "loading" && <p role="status">{t("loadingSchema")}</p>}
        {phase.p === "error" && (
          <Alert variant="destructive" data-testid="gen-error">
            <AlertDescription className="break-words">{t("error", { message: phase.message })}</AlertDescription>
          </Alert>
        )}
        {empty && <p role="status">{t("noTables")}</p>}

        {showForm && (
          <fieldset disabled={running} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            {tables.map((tb) => {
              const cols = tb.columns.filter(tunable);
              return (
                <div key={tb.name} className="flex min-w-0 flex-col gap-2 rounded-lg border border-line p-2">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-all font-mono font-medium">{tb.name}</span>
                    <label className="flex items-center gap-2">
                      <span>{t("rows")}</span>
                      <select
                        className={selectCls}
                        aria-label={t("rowsOf", { table: tb.name })}
                        value={rows[tb.name]}
                        onChange={(e) => setRows((x) => ({ ...x, [tb.name]: +e.target.value }))}
                      >
                        {SIZES.map((n) => (
                          <option key={n} value={n}>
                            {n.toLocaleString(locale)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {cols.length > 0 && (
                    <details className="min-w-0">
                      <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                        {t("columns", { count: cols.length })}
                      </summary>
                      <div className="mt-2 flex flex-col gap-2">
                        {cols.map((c) => {
                          const key = `${tb.name}.${c.name}`;
                          const e = edit(key);
                          return (
                            <div key={c.name} className="flex min-w-0 flex-wrap items-end gap-2">
                              <span className="w-full min-w-0 break-all font-mono text-xs">{c.name}</span>
                              <label className="flex min-w-24 flex-1 flex-col gap-1 text-xs">
                                {t("distinct")}
                                <Input
                                  inputMode="numeric"
                                  placeholder={t("auto")}
                                  aria-label={t("distinctOf", { column: key })}
                                  aria-invalid={e.distinct !== "" && !intIn(e.distinct, 1, 10_000_000)}
                                  value={e.distinct}
                                  onChange={(ev) => patch(key, { distinct: ev.target.value })}
                                />
                              </label>
                              {c.nullable && (
                                <label className="flex min-w-20 flex-1 flex-col gap-1 text-xs">
                                  {t("nullPct")}
                                  <Input
                                    inputMode="numeric"
                                    placeholder="0"
                                    aria-label={t("nullOf", { column: key })}
                                    aria-invalid={e.nullPct !== "" && !intIn(e.nullPct, 0, 100)}
                                    value={e.nullPct}
                                    onChange={(ev) => patch(key, { nullPct: ev.target.value })}
                                  />
                                </label>
                              )}
                              <label className="flex min-w-28 flex-1 flex-col gap-1 text-xs">
                                {t("skew")}
                                <select
                                  className={selectCls}
                                  aria-label={t("skewOf", { column: key })}
                                  value={e.skew}
                                  onChange={(ev) => patch(key, { skew: ev.target.value as Edit["skew"] })}
                                >
                                  <option value="uniform">{t("uniform")}</option>
                                  <option value="zipf">{t("zipf")}</option>
                                </select>
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">{t("maxNote")}</p>
            {has500k && (
              <Alert data-testid="warn-500k">
                <AlertDescription>{t("warn500k")}</AlertDescription>
              </Alert>
            )}
          </fieldset>
        )}

        {running && (
          <div role="status" className="flex flex-col gap-1">
            <progress aria-label={t("progress")} className="w-full" max={phase.total} value={phase.done} />
            <span>{t("progressText", { done: phase.done, total: phase.total })}</span>
          </div>
        )}

        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={() => (cancelled.current = true)}>
              {t("cancel")}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("close")}
              </Button>
              <Button onClick={start} disabled={phase.p === "loading" || tables.length === 0 || invalid}>
                {t("start")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
