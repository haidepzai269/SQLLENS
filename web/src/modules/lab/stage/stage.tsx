"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BTreeModel, BTreePath } from "@/contracts/btree";
import type { Conclusion, Outcome } from "@/contracts/conclusion";
import type { EngineAdapter } from "@/contracts/engine";
import type { Plan } from "@/contracts/plan";
import { parseSchema } from "@/modules/data-lab/generate/plan-data";
import { JoinAnimation } from "@/modules/plan-runner/join-anim/join-animation";
import { PlanTree } from "@/modules/plan-runner/plan-tree";
import { SchemaDiagram } from "@/modules/plan-runner/schema-diagram/schema-diagram";
import { WhatIfCompare } from "@/modules/what-if/compare-ui/what-if-compare";
import { joinNodes, STAGE_INDEX_QUERY, STAGE_SCHEMA_QUERY, type IndexInfo } from "./stage-data";

// BTreeDrop kéo GSAP: chỉ tải khi mở tab B-Tree.
const BTreeDrop = dynamic(() => import("@/modules/btree-reader/anim/btree-drop").then((m) => m.BTreeDrop), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" aria-hidden />,
});

/** Một lần chạy xong. `id` đổi theo mỗi lần chạy (và khi dữ liệu sinh thêm); dữ liệu của tab gắn với id này. */
export type StageRun = { id: number; db: EngineAdapter; select?: { n: number; sql: string } };
type Tab = "schema" | "plan" | "btree" | "whatif";
type Load<T> = { ok: true; v: T } | { ok: false; e: string } | null; // null: đang tải

const MAX_JOINS = 3;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Tải khi `on`. Kết quả gắn với `key`: key đổi thì trả null ngay (không hiện số cũ), kết quả về muộn của key cũ bị bỏ.
function useLoad<T>(on: boolean, key: string, fn: () => Promise<T>): Load<T> {
  const [s, set] = useState<{ key: string; r: NonNullable<Load<T>> } | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    fn().then(
      (v) => live && set({ key, r: { ok: true, v } }),
      (e) => live && set({ key, r: { ok: false, e: errText(e) } }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fn đổi mỗi lần render; `key` mô tả đầy đủ đầu vào của nó
  }, [on, key]);
  return s && s.key === key ? s.r : null;
}

function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return tone === "error" ? (
    <Alert variant="destructive" data-testid="stage-error">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  ) : (
    <p role="status" className="m-0 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function Loading() {
  const t = useTranslations("labStage");
  return (
    <div role="status" aria-label={t("loading")} className="flex flex-col gap-2" data-testid="stage-loading">
      <span className="text-sm text-muted-foreground">{t("loading")}</span>
      <Skeleton className="h-40 w-full" aria-hidden />
    </div>
  );
}

// NotSimulated hiện lý do; Conclusion vẽ `render` rồi liệt kê bằng chứng. Khóa dịch do engine trả về.
function OutcomeView<T>({ o, render }: { o: Outcome<T>; render: (c: Conclusion<T>) => ReactNode }) {
  const tr = useTranslations() as unknown as (key: string, values?: Record<string, string | number>) => string;
  if (o.kind === "not_simulated")
    return (
      <Note>
        <span data-testid="stage-not-simulated">{tr(o.reasonKey)}</span>
      </Note>
    );
  return (
    <>
      {render(o)}
      {o.evidence.map((e) => (
        <p key={e.kind} className="m-0 text-sm" data-testid="stage-evidence">
          {tr(e.messageKey, e.values)}
        </p>
      ))}
    </>
  );
}

function SchemaTab({ run, on }: { run: StageRun; on: boolean }) {
  const t = useTranslations("labStage");
  const tl = useTranslations("lab");
  const r = useLoad(on, `${run.id}`, async () =>
    parseSchema((await run.db.execute(STAGE_SCHEMA_QUERY, { internal: true }))[0] ?? { columns: [], rows: [] }),
  );
  // Mảng phải ổn định, nếu không sơ đồ dựng lại và fit lại liên tục (Task047).
  const tables = useMemo(() => (r?.ok ? r.v : []), [r]);
  if (!r) return <Loading />;
  if (!r.ok) return <Note tone="error">{t("error", { message: r.e })}</Note>;
  if (!tables.length) return <Note>{t("schema.none")}</Note>;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="self-start rounded-[2px] bg-label-real px-[7px] text-xs leading-5 text-label-real-foreground" data-testid="stage-label">
        {tl("label.real")}
      </span>
      <p className="m-0 text-sm" data-testid="stage-evidence">{t("schema.evidence", { count: tables.length })}</p>
      <SchemaDiagram tables={tables} />
    </div>
  );
}

function PlanTab({ run, on }: { run: StageRun; on: boolean }) {
  const t = useTranslations("labStage");
  const r = useLoad<Outcome<Plan>>(on && !!run.select, `${run.id}`, () => run.db.explain(run.select!.sql));
  if (!run.select) return <Note>{t("plan.noSelect")}</Note>;
  if (!r) return <Loading />;
  if (!r.ok) return <Note tone="error">{t("error", { message: r.e })}</Note>;
  const plan = r.v.kind === "conclusion" ? r.v.data : null;
  const joins = plan ? joinNodes(plan) : [];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="m-0 min-w-0 text-sm" data-testid="stage-viewing">
        {t("plan.viewing", { n: run.select.n })} <code className="break-all font-mono text-xs">{run.select.sql}</code>
      </p>
      <OutcomeView o={r.v} render={(c) => <PlanTree plan={c.data} label={c.label} />} />
      {plan && joins.length > 0 && (
        <section aria-label={t("plan.joinTitle")} className="flex min-w-0 flex-col gap-3 border-t border-line pt-3" data-testid="stage-joins">
          <h3 className="m-0 text-sm font-semibold">{t("plan.joinTitle")}</h3>
          <p className="m-0 text-xs text-dim">{t("plan.joinNote")}</p>
          {joins.slice(0, MAX_JOINS).map((n) => (
            <div key={n.id} className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium">{t("plan.joinFor", { label: n.label })}</span>
              <JoinAnimation node={n} engine={plan.engine} />
            </div>
          ))}
          {joins.length > MAX_JOINS && <p className="m-0 text-xs text-dim">{t("plan.joinMore", { count: joins.length - MAX_JOINS })}</p>}
        </section>
      )}
    </div>
  );
}

function BTreeTab({ run, on }: { run: StageRun; on: boolean }) {
  const t = useTranslations("labStage");
  const list = useLoad<IndexInfo[]>(on, `${run.id}`, async () =>
    ((await run.db.execute(STAGE_INDEX_QUERY, { internal: true }))[0]?.rows ?? []).map((x) => ({ name: String(x[0]), table: String(x[1]), method: String(x[2]) })),
  );
  // Lựa chọn gắn với đúng lần chạy: chạy lại thì bỏ, không đọc cây của index có thể đã đổi.
  const [pick, setPick] = useState<{ run: number; index: string; key: string } | null>(null);
  const [draft, setDraft] = useState("");
  const cur = pick && pick.run === run.id && list?.ok && list.v.some((x) => x.name === pick.index) ? pick : null;
  const tree = useLoad<{ model: Outcome<BTreeModel>; path?: BTreePath }>(
    on && !!cur,
    `${run.id}:${cur?.index}:${cur?.key}`,
    () => run.db.readBTree(cur!.index, cur!.key ? { probeKey: cur!.key } : undefined),
  );
  if (!list) return <Loading />;
  if (!list.ok) return <Note tone="error">{t("error", { message: list.e })}</Note>;
  if (!list.v.length) return <Note>{t("btree.none")}</Note>;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="stage-index" className="text-sm font-medium">{t("btree.indexLabel")}</label>
        <select
          id="stage-index"
          className="h-9 min-w-0 border border-line bg-surface px-2 text-sm"
          value={cur?.index ?? ""}
          onChange={(e) => (setPick(e.target.value ? { run: run.id, index: e.target.value, key: "" } : null), setDraft(""))}
        >
          <option value="">{t("btree.choose")}</option>
          {list.v.map((x) => (
            <option key={x.name} value={x.name}>{t("btree.option", { index: x.name, table: x.table, method: x.method })}</option>
          ))}
        </select>
      </div>
      {cur && (
        <form className="flex min-w-0 flex-col gap-1" onSubmit={(e) => (e.preventDefault(), setPick({ ...cur, key: draft.trim() }))}>
          <label htmlFor="stage-key" className="text-sm font-medium">{t("btree.keyLabel")}</label>
          <div className="flex min-w-0 gap-2">
            <Input id="stage-key" className="min-w-0" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("btree.keyPlaceholder")} />
            <Button type="submit" data-testid="stage-drop">{t("btree.drop")}</Button>
          </div>
          <p className="m-0 text-xs text-dim">{t("btree.keyHint")}</p>
        </form>
      )}
      {!cur && <Note>{t("btree.pick")}</Note>}
      {cur && !tree && <Loading />}
      {tree && !tree.ok && <Note tone="error">{t("error", { message: tree.e })}</Note>}
      {tree?.ok && (
        <OutcomeView
          o={tree.v.model}
          render={(c) => (
            <div className="flex min-h-96 min-w-0 flex-col" data-testid="stage-btree">
              <BTreeDrop model={c.data} path={tree.v.path} label={c.label} />
            </div>
          )}
        />
      )}
    </div>
  );
}

function WhatIfTab({ run }: { run: StageRun }) {
  const t = useTranslations("labStage");
  if (!run.select) return <Note>{t("whatif.noSelect")}</Note>;
  // key: chạy lại thì dựng mới, không giữ kết quả so sánh của lần trước.
  return <WhatIfCompare key={run.id} adapter={run.db} probe={run.select.sql} />;
}

export function Stage({ run, working, mysql }: { run: StageRun | null; working: boolean; mysql: boolean }) {
  const t = useTranslations("labStage");
  const ts = useTranslations("shell");
  const [tab, setTab] = useState<Tab>("schema");
  // Tab đã mở trong lần chạy này thì giữ dữ liệu khi chuyển tab, không đọc lại.
  const [seen, setSeen] = useState<{ id: number; tabs: Tab[] }>({ id: -1, tabs: [] });
  const open = (x: Tab) => run !== null && (tab === x || (seen.id === run.id && seen.tabs.includes(x)));
  const change = (v: unknown) => {
    if (run) setSeen((s) => ({ id: run.id, tabs: [...new Set([...(s.id === run.id ? s.tabs : []), tab])] }));
    setTab(v as Tab);
  };
  const hint = mysql ? t("mysql") : !run ? (working ? t("working") : ts("placeholder.stage")) : null;
  return (
    <div className="flex min-h-full min-w-0 flex-col">
      <div className="flex h-[var(--h-bar)] flex-none items-center border-b border-line px-[var(--edge)] font-semibold">{ts("tab.stage")}</div>
      <div className="flex min-w-0 flex-col gap-3 p-[var(--edge)]">
        {hint !== null || !run ? (
          <Note>{hint}</Note>
        ) : (
          <Tabs value={tab} onValueChange={change}>
            <TabsList className="w-full" aria-label={t("tabsLabel")} activateOnFocus>
              {(["schema", "plan", "btree", "whatif"] as const).map((x) => (
                <TabsTrigger key={x} value={x}>{t(`tab.${x}`)}</TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="schema" className="min-w-0"><SchemaTab run={run} on={open("schema")} /></TabsContent>
            <TabsContent value="plan" className="min-w-0"><PlanTab run={run} on={open("plan")} /></TabsContent>
            <TabsContent value="btree" className="min-w-0"><BTreeTab run={run} on={open("btree")} /></TabsContent>
            <TabsContent value="whatif" className="min-w-0"><WhatIfTab run={run} /></TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
