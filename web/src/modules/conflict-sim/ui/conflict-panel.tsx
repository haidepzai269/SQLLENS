"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ScenarioId, SessionId, Tables, Tick } from "../engine/types";
import { cfgFor, current, GUARDS, ISOLATIONS, lastOf, SCENARIO_IDS, SESSIONS, sessionState, simulateCfg, waitEdges, type Cfg } from "./model";

// Cytoscape chỉ tải khi màn hình này mở.
const WaitGraph = dynamic(() => import("./wait-graph"), { ssr: false, loading: () => <Skeleton className="h-36 w-full" aria-hidden /> });

type Tr = (key: string, values?: Record<string, string | number>) => string;
const STEP_MS = 1000;

const STATE_CLASS: Record<string, string> = {
  aborted: "border-severity-broken text-severity-broken",
  waiting: "border-severity-uncertain text-severity-uncertain",
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
                  {cols.map((c) => <TableHead key={c} scope="col">{c}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? rows.map((r, i) => (
                  <TableRow key={i}>{cols.map((c) => <TableCell key={c}>{String(r[c])}</TableCell>)}</TableRow>
                )) : <TableRow><TableCell colSpan={Math.max(cols.length, 1)} className="text-dim">{t("tables.empty")}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}

function Player({ ticks, outcomeKey, observed }: { ticks: Tick[]; outcomeKey: string; observed: string | number }) {
  const t = useTranslations("conflictSim");
  const tr = useTranslations() as unknown as Tr;
  const n = ticks.length;
  const [p, setP] = useState(0);
  const [play, setPlaying] = useState(false);
  const playing = play && p < n; // ở nhịp cuối thì tự dừng
  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => setP((x) => x + 1), STEP_MS);
    return () => clearInterval(h);
  }, [playing]);

  const manual = (to: number) => (setPlaying(false), setP(Math.min(n, Math.max(0, to))));
  const now = current(ticks, p);
  const { edges, cycle } = waitEdges(ticks, p);
  const summary = edges.length
    ? [...edges.map((e) => tr("conflictSim.graph.edge", { waiter: e.session, holder: e.holder, resource: e.resource })), ...(cycle ? [t("graph.cycle")] : [])]
    : [t("graph.none")];
  const base = ticks[0]?.committed ?? {};
  const explain = (k: Tick) =>
    tr(k.messageKey, k.values?.isolation ? { ...k.values, isolation: tr(`conflictSim.isolation.${k.values.isolation}`) } : k.values);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="group" aria-label={t("controls.label")} className="flex min-w-0 flex-wrap items-center gap-2">
        <Button onClick={() => (p >= n && setP(0), setPlaying(true))} data-testid="cf-run">{t("controls.run")}</Button>
        <Button variant="outline" onClick={() => setPlaying(false)} disabled={!playing} data-testid="cf-pause">{t("controls.pause")}</Button>
        <Button variant="outline" onClick={() => manual(p - 1)} disabled={p <= 0} data-testid="cf-prev">{t("controls.prev")}</Button>
        <Button variant="outline" onClick={() => manual(p + 1)} disabled={p >= n} data-testid="cf-next">{t("controls.next")}</Button>
        <Button variant="outline" onClick={() => manual(0)} disabled={p === 0 && !playing} data-testid="cf-reset">{t("controls.reset")}</Button>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="cf-seek" className="text-xs text-dim" data-testid="cf-position">{t("controls.position", { current: p, total: n })}</label>
        <input
          id="cf-seek" type="range" min={0} max={n} value={p} className="w-full"
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
              <span className={`w-fit border px-1.5 text-xs leading-5 ${STATE_CLASS[st] ?? "border-line"}`} data-testid={`state-${s}`} data-state={st}>{t(`session.state.${st}`)}</span>
            </div>
          );
        })}
      </div>

      <ol className="m-0 flex min-w-0 list-none flex-col gap-2 p-0" aria-label={t("controls.label")} data-testid="cf-ticks">
        {ticks.slice(0, p).map((k) => (
          <li key={k.index} aria-current={k.index === p - 1 ? "step" : undefined} className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2" data-testid={`tick-${k.index}`}>
            {SESSIONS.map((s) =>
              s !== k.session ? <div key={s} className="hidden sm:block" /> : (
                <div key={s} className={`flex min-w-0 flex-col gap-1 border p-2 text-sm ${k.index === p - 1 ? "border-label-simulated" : "border-line"}`}>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-dim">
                    <b className="text-text">{t("session.step", { n: k.index + 1 })}</b>
                    <span>{t("session.label", { id: s })}</span>
                    <span className={`border px-1.5 leading-5 ${k.status === "error" ? STATE_CLASS.aborted : k.status === "waiting" ? STATE_CLASS.waiting : "border-line"}`} data-testid={`tick-status-${k.index}`}>{t(`session.status.${k.status}`)}</span>
                  </span>
                  <code className="break-words font-mono text-xs" data-testid={`tick-sql-${k.index}`}>{k.sql}</code>
                  {k.result && <span className="font-mono text-xs">{"-> "}{k.result.map((r) => r.join(", ")).join("; ")}</span>}
                  <span data-testid={`tick-msg-${k.index}`}>{explain(k)}</span>
                </div>
              ),
            )}
          </li>
        ))}
        {!now && <li className="text-sm text-dim">{t("tables.start")}</li>}
      </ol>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        <DataTables id="committed" title={t("tables.committed")} data={now?.committed ?? base} />
        {SESSIONS.map((s: SessionId) => {
          const k = lastOf(ticks, p, s);
          return <DataTables key={s} id={s} title={`${t("tables.seen", { id: s })} (${k ? t("session.step", { n: k.index + 1 }) : t("tables.start")})`} data={k?.snapshot ?? base} />;
        })}
      </div>

      <section aria-label={t("graph.title")} className="flex min-w-0 flex-col gap-1">
        <h3 className="m-0 text-sm font-semibold">{t("graph.title")}</h3>
        <WaitGraph edges={edges} cycle={cycle} label={t("graph.aria")} />
        <ul className="m-0 pl-4 text-sm" data-testid="graph-summary">{summary.map((s) => <li key={s}>{s}</li>)}</ul>
      </section>

      <section aria-label={t("result.title")} className="flex min-w-0 flex-col gap-1" data-testid="cf-result">
        <h3 className="m-0 text-sm font-semibold">{t("result.title")}</h3>
        {p >= n ? (
          <>
            <p className={`m-0 border p-2 text-sm ${outcomeKey.endsWith("not_broken") ? "border-severity-passed" : outcomeKey.endsWith("serialization_failure") ? "border-line" : "border-severity-broken"}`} data-testid="cf-outcome" data-outcome={outcomeKey.split(".").pop()}>
              {tr(outcomeKey)}
            </p>
            {observed !== "" && <p className="m-0 text-xs text-dim">{t("result.observed", { observed })}</p>}
          </>
        ) : <p className="m-0 text-sm text-dim">{t("result.pending")}</p>}
      </section>
    </div>
  );
}

export function ConflictPanel() {
  const t = useTranslations("conflictSim");
  const tr = useTranslations() as unknown as Tr;
  const [cfg, setCfg] = useState<Cfg>(() => cfgFor("lost_update"));
  const result = useMemo(() => simulateCfg(cfg), [cfg]);
  const sel = "h-9 min-w-0 border border-line bg-surface px-2 text-sm";
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="conflict-panel">
      <p className="m-0 text-sm">{t("intro")}</p>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="cf-scenario" className="text-sm font-medium">{t("scenario.label")}</label>
          <select id="cf-scenario" className={sel} value={cfg.id} onChange={(e) => setCfg(cfgFor(e.target.value as ScenarioId))}>
            {SCENARIO_IDS.map((id) => <option key={id} value={id}>{t(`scenario.${id}`)}</option>)}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="cf-isolation" className="text-sm font-medium">{t("isolation.label")}</label>
          <select id="cf-isolation" className={sel} value={cfg.isolation} onChange={(e) => setCfg({ ...cfg, isolation: e.target.value as Cfg["isolation"] })}>
            {ISOLATIONS.map((i) => <option key={i} value={i}>{t(`isolation.${i}`)}</option>)}
          </select>
        </div>
        {cfg.id === "double_booking" && (
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="cf-guard" className="text-sm font-medium">{t("guard.label")}</label>
            <select id="cf-guard" className={sel} value={cfg.guard} onChange={(e) => setCfg({ ...cfg, guard: e.target.value as Cfg["guard"] })}>
              {GUARDS.map((g) => <option key={g} value={g}>{t(`guard.${g}`)}</option>)}
            </select>
          </div>
        )}
      </div>
      <p className="m-0 text-xs text-dim">{t(`scenario.about.${cfg.id}`)}</p>
      {result.kind === "not_simulated" ? (
        <div role="status" className="border border-severity-uncertain p-2 text-sm" data-testid="cf-not-simulated">
          <b>{t("notSimulated.title")}</b>: {tr(result.reasonKey)}
        </div>
      ) : (
        <>
          <p className="m-0 flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex h-5 items-center rounded-[2px] border border-label-simulated px-[7px] text-white" data-testid="cf-label" data-label="simulated">{t("label")}</span>
            <span className="min-w-0 text-dim">{t("labelNote")}</span>
          </p>
          {/* key: đổi kịch bản hay mức cô lập thì dựng Player mới, nhịp về 0 và dừng, không giữ trạng thái cũ. */}
          <Player key={`${cfg.id}:${cfg.isolation}:${cfg.guard}`} ticks={result.data.ticks} outcomeKey={result.evidence[0].messageKey} observed={String(result.evidence[0].values?.observed ?? "")} />
        </>
      )}
    </div>
  );
}
