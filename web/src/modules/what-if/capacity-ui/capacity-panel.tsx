"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConclusionBadge } from "@/components/ui/conclusion-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EvidenceLabel, Outcome } from "@/contracts/conclusion";
import { EngineError, type EngineAdapter } from "@/contracts/engine";
import type { CapacityPoint } from "@/contracts/whatif";
import { BTreeView, readStoredMode } from "@/modules/btree-reader/view/btree-view";
import { firstPath } from "@/modules/btree-reader/view/layout";
import { estimateCapacity, samplePoint } from "../capacity/capacity";
import { Cancelled, checkTarget, measureLevel, type Measured, type Stage } from "./measure-level";

gsap.registerPlugin(useGSAP);

const LEVELS = [10_000, 100_000, 500_000] as const;
// Đến 500.000 chỉ có các mốc đo thật; trên đó mỗi bước là một con số ước lượng.
const STEPS = [...LEVELS, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 50_000_000, 100_000_000, 500_000_000, 1_000_000_000];
const REDUCED = "(prefers-reduced-motion: reduce)";
const UNITS = ["B", "KB", "MB", "GB", "TB"];

type Status =
  | { kind: "idle" }
  | { kind: "running"; level: number; stage: Stage }
  | { kind: "error"; message: string }
  | { kind: "cancelled" }
  | { kind: "blocked"; reasonKey: string };
type Check = { key: string; result: Outcome<unknown> | { kind: "failed"; message: string } };

function Tag({ label, text }: { label: EvidenceLabel; text: string }) {
  return (
    <ConclusionBadge label={label} testId="capacity-label" className="h-6">
      {text}
    </ConclusionBadge>
  );
}

function Metric({ id, name, hint, children, raw }: { id: string; name: string; hint?: string; children: React.ReactNode; raw?: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-line p-3">
      <span className="text-xs text-muted-foreground">{name}</span>
      <span data-testid={id} data-raw={raw} className="break-words text-2xl font-medium tabular-nums">
        {children}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

// Mỗi tầng một ô; tầng internal mới xuất hiện thì ô đó hiện dần. Không vẽ node, nên dùng được cho cả số đo lẫn ước lượng.
function Tiers({ height, estimated }: { height: number; estimated: boolean }) {
  const t = useTranslations("btree");
  const tc = useTranslations("capacityUi");
  const ref = useRef<HTMLOListElement>(null);
  const prev = useRef(height);
  useGSAP(
    () => {
      const before = prev.current;
      prev.current = height;
      if (height <= before || window.matchMedia(REDUCED).matches) return;
      // Sau root, các ô internal từ vị trí (before - 1) đến (height - 2) là ô mới thêm.
      const cells = ref.current?.querySelectorAll("[data-tier]") ?? [];
      const added = Array.from(cells).slice(Math.max(1, before - 1), height - 1);
      gsap.from(added, { opacity: 0, y: -12, duration: 0.45, stagger: 0.12, ease: "power2.out" });
    },
    { scope: ref, dependencies: [height] },
  );
  const names = Array.from({ length: height }, (_, i) =>
    height === 1 ? t("laneSingle") : i === 0 ? t("laneRoot") : i === height - 1 ? t("laneLeaf") : t("laneInternal"),
  );
  return (
    <ol ref={ref} aria-label={tc("treeRegion")} data-testid="capacity-tiers" data-height={height} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {names.map((n, i) => (
        <li
          key={i}
          data-tier={i}
          className={`rounded-md border px-3 py-1 text-sm ${estimated ? "border-dashed border-label-estimated italic" : "border-solid border-control"}`}
        >
          {n}
        </li>
      ))}
    </ol>
  );
}

export function CapacityPanel({ adapter, index, table, probe }: { adapter: EngineAdapter; index: string; table: string; probe?: string }) {
  const t = useTranslations("capacityUi");
  const tb = useTranslations("btree");
  const tr = useTranslations() as unknown as (key: string) => string; // reasonKey dạng capacity.* và capacityUi.*
  const locale = useLocale();
  const key = `${index}\u0000${table}`;
  const [slot, setSlot] = useState(0);
  const [store, setStore] = useState<{ key: string; levels: Record<number, Measured> }>({ key, levels: {} });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [check, setCheck] = useState<Check>();
  const [cancelling, setCancelling] = useState(false);
  const [mode, setMode] = useState<"fixed" | "free">("fixed");
  const cancel = useRef(false);
  const alive = useRef(true);
  const levels = store.key === key ? store.levels : {};
  const running = status.kind === "running";

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancel.current = true; // rời màn hình giữa lúc nạp thì dừng và dọn bảng tạm
    };
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc localStorage sau hydrate
  useEffect(() => setMode(readStoredMode()), []);
  useEffect(() => {
    let live = true;
    checkTarget(adapter, index, table).then(
      (result) => live && setCheck({ key, result }),
      (e) => live && setCheck({ key, result: { kind: "failed", message: e instanceof Error ? e.message : String(e) } }),
    );
    return () => {
      live = false;
    };
  }, [adapter, index, table, key]);

  const checking = check?.key !== key;
  const blockedKey = !checking && check.result.kind === "not_simulated" ? check.result.reasonKey : undefined;
  const checkFailed = !checking && check.result.kind === "failed" ? check.result.message : undefined;
  const canMeasure = !checking && !blockedKey && !checkFailed && !running;

  async function measure(n: number) {
    cancel.current = false;
    setCancelling(false);
    setStatus({ kind: "running", level: n, stage: { stage: "prepare" } });
    try {
      const r = await measureLevel(adapter, {
        index,
        table,
        probe,
        rows: n,
        isCancelled: () => cancel.current,
        onStage: (stage) => alive.current && setStatus({ kind: "running", level: n, stage }),
      });
      if (!alive.current) return;
      if (r.kind === "conclusion") {
        setStore((s) => ({ key, levels: { ...(s.key === key ? s.levels : {}), [n]: r.data } }));
        setSlot(STEPS.indexOf(n));
        setStatus({ kind: "idle" });
      } else setStatus({ kind: "blocked", reasonKey: r.reasonKey });
    } catch (e) {
      if (e instanceof EngineError && (e.code === "timeout" || e.code === "worker_crashed")) await adapter.rebuild().catch(() => {});
      if (!alive.current) return;
      setStatus(e instanceof Cancelled ? { kind: "cancelled" } : { kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const rows = STEPS[slot];
  const measuredZone = rows <= LEVELS[LEVELS.length - 1];
  const done = levels[rows];
  const sampleLevel = [...LEVELS].reverse().find((n) => levels[n]);
  let point: Outcome<CapacityPoint> | undefined;
  if (measuredZone) point = done ? { kind: "conclusion", label: "real", data: samplePoint(done.sample), evidence: [{ kind: "pageinspect", messageKey: "capacity.measured" }] } : undefined;
  else if (sampleLevel) point = estimateCapacity(levels[sampleLevel].sample, rows);
  const label: EvidenceLabel = measuredZone ? "real" : "estimated";

  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const approx = (v: string) => (label === "estimated" ? t("approx", { value: v }) : v);
  const bytes = (b: number) => {
    let v = b;
    let i = 0;
    while (v >= 1024 && i < UNITS.length - 1) {
      v /= 1024;
      i++;
    }
    return t("size", { value: new Intl.NumberFormat(locale, { maximumFractionDigits: i ? 1 : 0 }).format(v), unit: UNITS[i] });
  };
  const stageText = (s: Stage) => t(`stage.${s.stage}`, { done: s.done ?? 0, total: s.total ?? 0 });

  return (
    <Card data-testid="capacity-panel" className="min-w-0">
      <CardHeader>
        <CardTitle className="break-words">{t("title", { index })}</CardTitle>
        <CardDescription>{t("description", { table })}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {checking && <p role="status">{t("checking")}</p>}
        {(blockedKey || checkFailed) && (
          <Alert data-testid="capacity-blocked">
            <AlertDescription>{blockedKey ? tr(blockedKey) : t("error", { message: checkFailed ?? "" })}</AlertDescription>
          </Alert>
        )}

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="capacity-slider" className="text-sm font-medium">
              {t("scale")}
            </label>
            <span className="flex items-center gap-2">
              <span data-testid="capacity-rows" data-raw={rows} className="text-lg font-medium tabular-nums">
                {t("scaleValue", { rows })}
              </span>
              {(point || !measuredZone) && <Tag label={label} text={tb(`label.${label}`)} />}
            </span>
          </div>
          <input
            id="capacity-slider"
            data-testid="capacity-slider"
            type="range"
            min={0}
            max={STEPS.length - 1}
            step={1}
            value={slot}
            onChange={(e) => setSlot(+e.target.value)}
            aria-valuetext={t("sliderText", { rows, label: tb(`label.${label}`) })}
            className="h-8 w-full cursor-pointer accent-[var(--lamp)]"
          />
        </div>

        {point?.kind === "conclusion" ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Metric id="capacity-height" name={t("height")} raw={point.data.height}>
                {approx(num(point.data.height))}
              </Metric>
              <Metric id="capacity-size" name={t("indexSize")} raw={point.data.indexBytes}>
                {approx(bytes(point.data.indexBytes))}
              </Metric>
              <Metric
                id="capacity-pages"
                name={t("pagesRead")}
                hint={point.data.pagesRead !== undefined ? t("pagesReadHint") : t("noProbe")}
                raw={point.data.pagesRead}
              >
                {point.data.pagesRead !== undefined ? approx(num(point.data.pagesRead)) : t("unmeasured")}
              </Metric>
            </div>
            <p className="m-0 text-sm text-muted-foreground" data-testid="capacity-source">
              {label === "real" ? t("measuredFrom", { rows }) : t("estimateFrom", { rows: levels[sampleLevel!].sample.rows })}
            </p>
            <Tiers height={point.data.height} estimated={label === "estimated"} />
            {label === "real" ? (
              done?.model ? (
                <div className="flex h-[26rem] min-h-0 flex-col overflow-hidden rounded-lg border border-line">
                  <BTreeView model={done.model} label="real" mode={mode} onModeChange={setMode} align={firstPath(done.model)} />
                </div>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">{t("treeNone")}</p>
              )
            ) : (
              <p className="m-0 rounded-lg border border-dashed border-label-estimated p-3 text-sm italic" data-testid="capacity-estimated-tree">
                {t("treeEstimated")}
              </p>
            )}
          </>
        ) : point?.kind === "not_simulated" ? (
          <Alert data-testid="capacity-reason">
            <AlertDescription>{tr(point.reasonKey)}</AlertDescription>
          </Alert>
        ) : measuredZone ? (
          <p className="m-0 text-sm" data-testid="capacity-unmeasured">
            {t("unmeasuredNow", { rows })}
          </p>
        ) : (
          <Alert data-testid="capacity-reason">
            <AlertDescription>{t("needSample")}</AlertDescription>
          </Alert>
        )}

        <section aria-labelledby="capacity-levels" className="flex min-w-0 flex-col gap-2">
          <h3 id="capacity-levels" className="m-0 text-sm font-medium">
            {t("levels")}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {LEVELS.map((n) => (
              <li key={n} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded text-sm font-medium tabular-nums underline-offset-4 hover:underline"
                    aria-pressed={rows === n}
                    onClick={() => setSlot(STEPS.indexOf(n))}
                  >
                    {t("level", { rows: n })}
                  </button>
                  <span data-testid={`level-status-${n}`} className="text-xs text-muted-foreground">
                    {status.kind === "running" && status.level === n ? t("measuring") : levels[n] ? t("measured") : t("unmeasured")}
                  </span>
                </span>
                <Button size="sm" variant="outline" data-testid={`level-measure-${n}`} disabled={!canMeasure} onClick={() => measure(n)}>
                  {levels[n] ? t("remeasure") : t("measure", { rows: n })}
                </Button>
              </li>
            ))}
          </ul>
          <p className="m-0 text-xs text-muted-foreground">{t("scratchNote")}</p>
          {rows === 500_000 && !done && (
            <Alert data-testid="capacity-warn500k">
              <AlertDescription>{t("warn500k")}</AlertDescription>
            </Alert>
          )}
        </section>

        {status.kind === "running" && (
          <div role="status" className="flex min-w-0 flex-col gap-2" data-testid="capacity-progress">
            <progress
              aria-label={t("progress")}
              className="w-full"
              max={status.stage.total ?? 1}
              value={status.stage.stage === "load" ? status.stage.done : undefined}
            />
            <span>{stageText(status.stage)}</span>
            <Button
              variant="outline"
              className="self-start"
              data-testid="level-cancel"
              disabled={cancelling}
              onClick={() => {
                cancel.current = true;
                setCancelling(true);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        )}
        {status.kind === "cancelled" && (
          <Alert data-testid="capacity-cancelled">
            <AlertDescription>{t("cancelled")}</AlertDescription>
          </Alert>
        )}
        {status.kind === "error" && (
          <Alert variant="destructive" data-testid="capacity-error">
            <AlertDescription className="break-words">{t("error", { message: status.message })}</AlertDescription>
          </Alert>
        )}
        {status.kind === "blocked" && (
          <Alert data-testid="capacity-blocked-run">
            <AlertDescription>{tr(status.reasonKey)}</AlertDescription>
          </Alert>
        )}
        <p className="m-0 text-xs text-muted-foreground">{t("scope")}</p>
      </CardContent>
    </Card>
  );
}
