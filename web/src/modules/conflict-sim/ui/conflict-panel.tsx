"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConclusionBadge } from "@/components/ui/conclusion-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EngineAdapter } from "@/contracts/engine";
import { createMysqlAdapter, type MysqlAdapter } from "@/engines/mysql/adapter";
import { MysqlConflictRunner, type MysqlRunnerState } from "@/engines/mysql/conflict-runner";
import {
  MYSQL_SCENARIO_IDS,
  MYSQL_SCENARIOS,
  type MysqlScenarioId,
} from "@/engines/mysql/scenarios";
import type { ScenarioId, SessionId, Tables, Tick } from "../engine/types";
import {
  BROKEN_OPS,
  cfgFor,
  current,
  defaultCheckFor,
  GUARDS,
  ISOLATIONS,
  lastOf,
  SCENARIO_IDS,
  SESSIONS,
  sessionState,
  simulateCfg,
  waitEdges,
  type BrokenOp,
  type Cfg,
} from "./model";

// Cytoscape chỉ tải khi màn hình này mở.
const WaitGraph = dynamic(() => import("./wait-graph"), {
  ssr: false,
  loading: () => <Skeleton className="h-36 w-full" aria-hidden />,
});

type Tr = (key: string, values?: Record<string, string | number>) => string;
const STEP_MS = 1000;

const STATE_CLASS: Record<string, string> = {
  aborted: "border-dashed border-severity-broken text-severity-broken",
  waiting: "border-severity-uncertain text-severity-uncertain",
  running: "border-label-real text-text",
  committed: "border-line text-dim",
  rolledBack: "border-line text-dim",
  idle: "border-line text-dim",
};

function DataTables({ data, id, title }: { data: Tables; id: string; title: string }) {
  const t = useTranslations("conflictSim");
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid={`tbl-${id}`}>
      <h4 className="m-0 text-xs font-semibold">{title}</h4>
      {Object.entries(data).map(([name, rows]) => {
        const cols = Object.keys(rows[0] ?? {});
        return (
          <div key={name} className="min-w-0 overflow-x-auto" data-testid={`tbl-${id}-${name}`}>
            <span className="font-mono text-xs text-dim">{name}</span>
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  {cols.map((c) => (
                    <TableHead key={c} scope="col">
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((r, i) => (
                    <TableRow key={i}>
                      {cols.map((c) => (
                        <TableCell key={c}>{String(r[c])}</TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={Math.max(cols.length, 1)} className="text-dim">
                      {t("tables.empty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}

function Player({
  ticks,
  outcomeKey,
  observed,
}: {
  ticks: Tick[];
  outcomeKey: string;
  observed: string | number;
}) {
  const t = useTranslations("conflictSim");
  const tr = useTranslations() as unknown as Tr;
  const n = ticks.length;
  const [p, setP] = useState(0);
  const [play, setPlaying] = useState(false);
  const playing = play && p < n;
  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => setP((x) => x + 1), STEP_MS);
    return () => clearInterval(h);
  }, [playing]);

  const manual = (to: number) => {
    setPlaying(false);
    setP(Math.min(n, Math.max(0, to)));
  };
  const now = current(ticks, p);
  const { edges, cycle } = waitEdges(ticks, p);
  const summary = edges.length
    ? [
        ...edges.map((e) =>
          tr("conflictSim.graph.edge", {
            waiter: e.session,
            holder: e.holder,
            resource: e.resource,
          })
        ),
        ...(cycle ? [t("graph.cycle")] : []),
      ]
    : [t("graph.none")];
  const base = ticks[0]?.committed ?? {};
  const explain = (k: Tick) =>
    tr(
      k.messageKey,
      k.values?.isolation
        ? { ...k.values, isolation: tr(`conflictSim.isolation.${k.values.isolation}`) }
        : k.values
    );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        role="group"
        aria-label={t("controls.label")}
        className="grid min-w-0 grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center"
      >
        <Button onClick={() => (p >= n && setP(0), setPlaying(true))} data-testid="cf-run">
          {t("controls.run")}
        </Button>
        <Button
          variant="outline"
          onClick={() => setPlaying(false)}
          disabled={!playing}
          data-testid="cf-pause"
        >
          {t("controls.pause")}
        </Button>
        <Button
          variant="outline"
          onClick={() => manual(p - 1)}
          disabled={p <= 0}
          data-testid="cf-prev"
        >
          {t("controls.prev")}
        </Button>
        <Button
          variant="outline"
          onClick={() => manual(p + 1)}
          disabled={p >= n}
          data-testid="cf-next"
        >
          {t("controls.next")}
        </Button>
        <Button
          variant="outline"
          onClick={() => manual(0)}
          disabled={p === 0 && !playing}
          data-testid="cf-reset"
        >
          {t("controls.reset")}
        </Button>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="cf-seek" className="text-xs text-dim" data-testid="cf-position">
          {t("controls.position", { current: p, total: n })}
        </label>
        <input
          id="cf-seek"
          type="range"
          min={0}
          max={n}
          value={p}
          className="w-full"
          aria-valuetext={t("controls.position", { current: p, total: n })}
          onChange={(e) => manual(Number(e.target.value))}
          data-testid="cf-seek"
        />
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-2">
        {SESSIONS.map((s) => {
          const st = sessionState(ticks, p, s);
          return (
            <div key={s} className="flex min-w-0 flex-col gap-1 border border-line p-2">
              <span className="text-sm font-semibold">{t("session.label", { id: s })}</span>
              <span
                className={`w-fit border px-1.5 text-xs leading-5 ${STATE_CLASS[st] ?? "border-line"}`}
                data-testid={`state-${s}`}
                data-state={st}
              >
                {t(`session.state.${st}`)}
              </span>
            </div>
          );
        })}
      </div>

      <ol
        className="m-0 flex min-w-0 list-none flex-col gap-2 p-0"
        aria-label={t("controls.label")}
        data-testid="cf-ticks"
      >
        {ticks.slice(0, p).map((k) => (
          <li
            key={k.index}
            aria-current={k.index === p - 1 ? "step" : undefined}
            className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"
            data-testid={`tick-${k.index}`}
          >
            {SESSIONS.map((s) =>
              s !== k.session ? (
                <div key={s} className="hidden sm:block" />
              ) : (
                <div
                  key={s}
                  className={`flex min-w-0 flex-col gap-1 border p-2 text-sm ${
                    k.index === p - 1 ? "border-label-simulated" : "border-line"
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-2 text-xs text-dim">
                    <b className="text-text">{t("session.step", { n: k.index + 1 })}</b>
                    <span>{t("session.label", { id: s })}</span>
                    <span
                      className={`border px-1.5 leading-5 ${
                        k.status === "error"
                          ? STATE_CLASS.aborted
                          : k.status === "waiting"
                          ? STATE_CLASS.waiting
                          : "border-line"
                      }`}
                      data-testid={`tick-status-${k.index}`}
                    >
                      {t(`session.status.${k.status}`)}
                    </span>
                  </span>
                  <code className="break-words font-mono text-xs" data-testid={`tick-sql-${k.index}`}>
                    {k.sql}
                  </code>
                  {k.result && (
                    <span className="font-mono text-xs">
                      {"-> "}
                      {k.result.map((r) => r.join(", ")).join("; ")}
                    </span>
                  )}
                  <span data-testid={`tick-msg-${k.index}`}>{explain(k)}</span>
                </div>
              )
            )}
          </li>
        ))}
        {!now && <li className="text-sm text-dim">{t("tables.start")}</li>}
      </ol>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        <DataTables id="committed" title={t("tables.committed")} data={now?.committed ?? base} />
        {SESSIONS.map((s: SessionId) => {
          const k = lastOf(ticks, p, s);
          return (
            <DataTables
              key={s}
              id={s}
              title={`${t("tables.seen", { id: s })} (${
                k ? t("session.step", { n: k.index + 1 }) : t("tables.start")
              })`}
              data={k?.snapshot ?? base}
            />
          );
        })}
      </div>

      <section aria-label={t("graph.title")} className="flex min-w-0 flex-col gap-1">
        <h3 className="m-0 text-sm font-semibold">{t("graph.title")}</h3>
        <WaitGraph edges={edges} cycle={cycle} label={t("graph.aria")} />
        <ul className="m-0 pl-4 text-sm" data-testid="graph-summary">
          {summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section
        aria-label={t("result.title")}
        className="flex min-w-0 flex-col gap-1"
        data-testid="cf-result"
      >
        <h3 className="m-0 text-sm font-semibold">{t("result.title")}</h3>
        {p >= n ? (
          <>
            <p
              className={`m-0 border p-2 text-sm ${
                outcomeKey.endsWith("not_broken")
                  ? "border-severity-passed"
                  : outcomeKey.endsWith("no_criteria") || outcomeKey.endsWith("serialization_failure")
                  ? "border-line"
                  : "border-severity-broken"
              }`}
              data-testid="cf-outcome"
              data-outcome={outcomeKey.split(".").pop()}
            >
              {tr(outcomeKey)}
            </p>
            {observed !== "" && (
              <p className="m-0 text-xs text-dim">{t("result.observed", { observed })}</p>
            )}
          </>
        ) : (
          <p className="m-0 text-sm text-dim">{t("result.pending")}</p>
        )}
      </section>
    </div>
  );
}

/**
 * MysqlPlayer: Điều phối và trực quan hóa 2 Connection Thật trên MySQL qua SSE & Cytoscape
 */
function MysqlPlayer({
  scenarioId,
  variantId,
  adapter,
}: {
  scenarioId: MysqlScenarioId;
  variantId?: string;
  adapter?: EngineAdapter;
}) {
  const t = useTranslations("conflictSim");
  const tr = useTranslations() as unknown as Tr;
  const scenario = MYSQL_SCENARIOS[scenarioId];

  const ownAdapterRef = useRef<MysqlAdapter | null>(null);
  const runnerRef = useRef<MysqlConflictRunner | null>(null);

  const [state, setState] = useState<MysqlRunnerState>(() => {
    const dummyRunner = new MysqlConflictRunner(
      scenario,
      {
        execute: async () => [],
        sessionId: async () => "",
      },
      variantId
    );
    return dummyRunner.getState();
  });

  useEffect(() => {
    let disposed = false;
    let localAdapter: MysqlAdapter;

    if (adapter && "sessionId" in adapter) {
      localAdapter = adapter as MysqlAdapter;
    } else {
      localAdapter = createMysqlAdapter();
      ownAdapterRef.current = localAdapter;
    }

    const runner = new MysqlConflictRunner(
      scenario,
      {
        execute: (sql, opts) => localAdapter.execute(sql, opts),
        sessionId: () => localAdapter.sessionId(),
        onStateChange: (newState) => {
          if (!disposed) setState(newState);
        },
      },
      variantId
    );

    runnerRef.current = runner;
    void runner.start();

    return () => {
      disposed = true;
      runner.dispose();
      runnerRef.current = null;
      if (ownAdapterRef.current) {
        void ownAdapterRef.current.dispose();
        ownAdapterRef.current = null;
      }
    };
  }, [scenario, scenarioId, variantId, adapter]);

  const p = state.stepIndex;
  const n = state.totalSteps;
  const runner = runnerRef.current;

  const waitInfoEdges = state.edges.map((e) => ({
    session: e.waiter,
    holder: e.holder,
    resource: e.resource,
  }));

  const summary = waitInfoEdges.length
    ? [
        ...waitInfoEdges.map((e) =>
          tr("conflictSim.graph.edge", {
            waiter: e.session,
            holder: e.holder,
            resource: e.resource,
          })
        ),
        ...(state.cycle ? [t("graph.cycle")] : []),
      ]
    : [t("graph.none")];

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="mysql-player">
      <div
        role="group"
        aria-label={t("controls.label")}
        className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"
      >
        <Button
          onClick={() => runner?.play()}
          disabled={state.isRunning}
          data-testid="cf-run"
        >
          {t("controls.run")}
        </Button>
        <Button
          variant="outline"
          onClick={() => runner?.pause()}
          disabled={!state.isRunning}
          data-testid="cf-pause"
        >
          {t("controls.pause")}
        </Button>
        <Button
          variant="outline"
          onClick={() => void runner?.next()}
          disabled={p >= n || state.isRunning}
          data-testid="cf-next"
        >
          {t("controls.next")}
        </Button>
        <Button
          variant="outline"
          onClick={() => void runner?.reset()}
          data-testid="cf-reset"
        >
          {t("controls.reset")}
        </Button>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-dim" data-testid="cf-position">
          {t("controls.position", { current: p, total: n })}
        </span>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-2">
        {(["A", "B"] as const).map((s) => {
          const st = state.sessionStates[s];
          return (
            <div
              key={s}
              className={`flex min-w-0 flex-col gap-1 border p-2 ${
                st === "aborted" ? "border-dashed border-severity-broken" : "border-line"
              }`}
            >
              <span className="text-sm font-semibold">{t("session.label", { id: s })}</span>
              <span
                className={`w-fit border px-1.5 text-xs leading-5 ${STATE_CLASS[st] ?? "border-line"}`}
                data-testid={`state-${s}`}
                data-state={st}
              >
                {t(`session.state.${st}`)}
              </span>
            </div>
          );
        })}
      </div>

      <ol
        className="m-0 flex min-w-0 list-none flex-col gap-2 p-0"
        aria-label={t("controls.label")}
        data-testid="cf-ticks"
      >
        {state.logs.map((log) => {
          const s = log.connection === "a" ? "A" : "B";
          return (
            <li
              key={log.stepIndex}
              aria-current={log.stepIndex === p - 1 ? "step" : undefined}
              className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"
              data-testid={`tick-${log.stepIndex}`}
            >
              {(["A", "B"] as const).map((col) =>
                col !== s ? (
                  <div key={col} className="hidden sm:block" />
                ) : (
                  <div
                    key={col}
                    className={`flex min-w-0 flex-col gap-1 border p-2 text-sm ${
                      log.status === "deadlock"
                        ? "border-dashed border-severity-broken bg-destructive/5"
                        : log.stepIndex === p - 1
                        ? "border-label-real"
                        : "border-line"
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-2 text-xs text-dim">
                      <b className="text-text">{t("session.step", { n: log.stepIndex + 1 })}</b>
                      <span>{t("session.label", { id: s })}</span>
                      <span
                        className={`border px-1.5 leading-5 ${
                          log.status === "deadlock" || log.status === "error"
                            ? STATE_CLASS.aborted
                            : log.status === "waiting"
                            ? STATE_CLASS.waiting
                            : "border-line"
                        }`}
                        data-testid={`tick-status-${log.stepIndex}`}
                      >
                        {t(`session.status.${log.status === "deadlock" ? "error" : log.status}`)}
                      </span>
                    </span>
                    <code
                      className="break-words font-mono text-xs"
                      data-testid={`tick-sql-${log.stepIndex}`}
                    >
                      {log.sql}
                    </code>
                    {log.errorMsg && (
                      <span className="text-xs text-severity-broken font-mono">
                        {log.errorMsg}
                      </span>
                    )}
                    <span data-testid={`tick-msg-${log.stepIndex}`}>{tr(log.descKey)}</span>
                  </div>
                )
              )}
            </li>
          );
        })}
        {state.logs.length === 0 && <li className="text-sm text-dim">{t("tables.start")}</li>}
      </ol>

      <section aria-label={t("graph.title")} className="flex min-w-0 flex-col gap-1">
        <h3 className="m-0 text-sm font-semibold">{t("graph.title")}</h3>
        <WaitGraph edges={waitInfoEdges} cycle={state.cycle} label={t("graph.aria")} />
        <ul className="m-0 pl-4 text-sm" data-testid="graph-summary">
          {summary.map((s, idx) => (
            <li key={idx}>{s}</li>
          ))}
        </ul>
      </section>

      <section
        aria-label={t("result.title")}
        className="flex min-w-0 flex-col gap-1"
        data-testid="cf-result"
      >
        <h3 className="m-0 text-sm font-semibold">{t("result.title")}</h3>
        {p >= n || state.cycle ? (
          <div
            className={`flex flex-col gap-2 border p-3 text-sm ${
              state.cycle
                ? "border-dashed border-severity-broken bg-destructive/5"
                : "border-line"
            }`}
            data-testid="cf-outcome"
            data-outcome={state.cycle ? "deadlock" : "completed"}
          >
            {state.cycle ? (
              <p className="m-0 font-medium text-severity-broken">
                {tr("conflictSim.outcome.deadlock")}
              </p>
            ) : (
              <p className="m-0">{tr(scenario.learnKey)}</p>
            )}
            <p className="m-0 text-xs text-dim italic">
              {t("realLabelNote")}
            </p>
          </div>
        ) : (
          <p className="m-0 text-sm text-dim">{t("result.pending")}</p>
        )}
      </section>
    </div>
  );
}

export interface ConflictPanelProps {
  adapter?: EngineAdapter;
  initialEngine?: "postgres" | "mysql";
}

export function ConflictPanel({ adapter, initialEngine }: ConflictPanelProps) {
  const t = useTranslations("conflictSim");
  const tr = useTranslations() as unknown as Tr;

  const [engine, setEngine] = useState<"postgres" | "mysql">(
    initialEngine ?? (adapter?.engine === "mysql" ? "mysql" : "postgres")
  );

  // State cho Postgres
  const [cfg, setCfg] = useState<Cfg>(() => cfgFor("lost_update"));
  const result = useMemo(() => simulateCfg(cfg), [cfg]);
  const sel = "h-9 min-w-0 border border-line bg-surface px-2 text-sm";
  const check = cfg.customCheck ?? defaultCheckFor(cfg.id);

  // State cho MySQL
  const [mysqlScenarioId, setMysqlScenarioId] = useState<MysqlScenarioId>("gap_lock_paralysis");
  const [mysqlVariantId, setMysqlVariantId] = useState<string>("default");

  const curMysqlScenario = MYSQL_SCENARIOS[mysqlScenarioId];

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="conflict-panel">
      <p className="m-0 text-sm">{t("intro")}</p>

      {/* Engine Selector */}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="cf-engine-select" className="text-sm font-medium">
            {t("engineSelect.label")}
          </label>
          <select
            id="cf-engine-select"
            data-testid="cf-engine-select"
            className={sel}
            value={engine}
            onChange={(e) => setEngine(e.target.value as "postgres" | "mysql")}
          >
            <option value="postgres">{t("engineSelect.postgres")}</option>
            <option value="mysql">{t("engineSelect.mysql")}</option>
          </select>
        </div>

        {engine === "postgres" ? (
          <>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="cf-scenario" className="text-sm font-medium">
                {t("scenario.label")}
              </label>
              <select
                id="cf-scenario"
                data-testid="cf-scenario"
                className={sel}
                value={cfg.id}
                onChange={(e) => setCfg(cfgFor(e.target.value as ScenarioId))}
              >
                {SCENARIO_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`scenario.${id}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="cf-isolation" className="text-sm font-medium">
                {t("isolation.label")}
              </label>
              <select
                id="cf-isolation"
                className={sel}
                value={cfg.isolation}
                onChange={(e) => setCfg({ ...cfg, isolation: e.target.value as Cfg["isolation"] })}
              >
                {ISOLATIONS.map((i) => (
                  <option key={i} value={i}>
                    {t(`isolation.${i}`)}
                  </option>
                ))}
              </select>
            </div>
            {cfg.id === "double_booking" && (
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor="cf-guard" className="text-sm font-medium">
                  {t("guard.label")}
                </label>
                <select
                  id="cf-guard"
                  className={sel}
                  value={cfg.guard}
                  onChange={(e) => setCfg({ ...cfg, guard: e.target.value as Cfg["guard"] })}
                >
                  {GUARDS.map((g) => (
                    <option key={g} value={g}>
                      {t(`guard.${g}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="cf-mysql-scenario" className="text-sm font-medium">
                {t("scenario.label")}
              </label>
              <select
                id="cf-mysql-scenario"
                data-testid="cf-mysql-scenario"
                className={sel}
                value={mysqlScenarioId}
                onChange={(e) => {
                  setMysqlScenarioId(e.target.value as MysqlScenarioId);
                  setMysqlVariantId("default");
                }}
              >
                {MYSQL_SCENARIO_IDS.map((id) => (
                  <option key={id} value={id}>
                    {tr(MYSQL_SCENARIOS[id].nameKey)}
                  </option>
                ))}
              </select>
            </div>

            {curMysqlScenario.variants && curMysqlScenario.variants.length > 0 && (
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor="cf-mysql-variant" className="text-sm font-medium">
                  {t("variantLabel")}
                </label>
                <select
                  id="cf-mysql-variant"
                  data-testid="cf-mysql-variant"
                  className={sel}
                  value={mysqlVariantId}
                  onChange={(e) => setMysqlVariantId(e.target.value)}
                >
                  <option value="default">{t("variantDefault")}</option>
                  {curMysqlScenario.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {tr(v.nameKey)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
      </div>

      {engine === "postgres" ? (
        <>
          <p className="m-0 text-xs text-dim">{t(`scenario.about.${cfg.id}`)}</p>

          <div
            className="flex min-w-0 flex-col gap-2 border border-line p-3"
            data-testid="cf-criteria-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  id="cf-check-enable"
                  data-testid="cf-check-enable"
                  checked={check.enabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setCfg((prev) => ({
                      ...prev,
                      customCheck: {
                        ...(prev.customCheck ?? defaultCheckFor(prev.id)),
                        enabled,
                      },
                    }));
                  }}
                  className="h-4 w-4"
                />
                <span>{t("criteria.label")}</span>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="cf-check-reset"
                onClick={() => {
                  setCfg((prev) => ({
                    ...prev,
                    customCheck: defaultCheckFor(prev.id),
                  }));
                }}
              >
                {t("criteria.reset")}
              </Button>
            </div>

            {check.enabled ? (
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label htmlFor="cf-check-sql" className="text-xs font-medium text-dim">
                    {t("criteria.sqlLabel")}
                  </label>
                  <input
                    id="cf-check-sql"
                    data-testid="cf-check-sql"
                    type="text"
                    className="h-9 min-w-0 border border-line bg-surface px-2 font-mono text-xs"
                    value={check.sql}
                    onChange={(e) => {
                      const sql = e.target.value;
                      setCfg((prev) => ({
                        ...prev,
                        customCheck: {
                          ...(prev.customCheck ?? defaultCheckFor(prev.id)),
                          sql,
                          differsWithinTx: false,
                        },
                      }));
                    }}
                  />
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <label htmlFor="cf-check-op" className="text-xs font-medium text-dim">
                      {t("criteria.conditionLabel")}
                    </label>
                    <select
                      id="cf-check-op"
                      data-testid="cf-check-op"
                      className={sel}
                      value={check.op}
                      onChange={(e) => {
                        const op = e.target.value as BrokenOp;
                        setCfg((prev) => ({
                          ...prev,
                          customCheck: {
                            ...(prev.customCheck ?? defaultCheckFor(prev.id)),
                            op,
                            differsWithinTx: false,
                          },
                        }));
                      }}
                    >
                      {BROKEN_OPS.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <label htmlFor="cf-check-target" className="text-xs font-medium text-dim">
                      {t("criteria.targetLabel")}
                    </label>
                    <input
                      id="cf-check-target"
                      data-testid="cf-check-target"
                      type="number"
                      className="h-9 w-24 min-w-0 border border-line bg-surface px-2 text-sm"
                      value={check.target}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const val = raw === "" ? 0 : Number(raw);
                        setCfg((prev) => ({
                          ...prev,
                          customCheck: {
                            ...(prev.customCheck ?? defaultCheckFor(prev.id)),
                            target: Number.isNaN(val) ? 0 : val,
                            differsWithinTx: false,
                          },
                        }));
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <p className="m-0 text-xs text-dim" data-testid="cf-criteria-disabled-note">
                {t("criteria.disabledNote")}
              </p>
            )}
          </div>

          {result.kind === "not_simulated" ? (
            <div
              role="status"
              className="border border-severity-uncertain p-2 text-sm"
              data-testid="cf-not-simulated"
            >
              <b>{t("notSimulated.title")}</b>: {tr(result.reasonKey)}
            </div>
          ) : (
            <>
              <p className="m-0 flex min-w-0 flex-wrap items-center gap-2 text-xs">
                <ConclusionBadge label="simulated" testId="cf-label" />
                <span className="min-w-0 text-dim">{t("labelNote")}</span>
              </p>
              <Player
                key={`${cfg.id}:${cfg.isolation}:${cfg.guard}:${check.enabled}:${check.sql}:${check.op}:${check.target}`}
                ticks={result.data.ticks}
                outcomeKey={result.evidence[0].messageKey}
                observed={String(result.evidence[0].values?.observed ?? "")}
              />
            </>
          )}
        </>
      ) : (
        <>
          <p className="m-0 text-xs text-dim" data-testid="cf-mysql-about">
            {tr(curMysqlScenario.aboutKey)}
          </p>
          <div className="rounded border border-line bg-surface/50 p-2 text-xs text-dim" data-testid="cf-mysql-learn">
            <b>{t("scenario.label")}</b>: {tr(curMysqlScenario.learnKey)}
          </div>

          <p className="m-0 flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <ConclusionBadge label="real" testId="cf-label" />
            <span className="min-w-0 text-dim">{t("realLabelNote")}</span>
          </p>

          <MysqlPlayer
            key={`${mysqlScenarioId}:${mysqlVariantId}`}
            scenarioId={mysqlScenarioId}
            variantId={mysqlVariantId === "default" ? undefined : mysqlVariantId}
            adapter={adapter}
          />
        </>
      )}
    </div>
  );
}
