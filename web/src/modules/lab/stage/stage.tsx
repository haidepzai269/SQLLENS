"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tip } from "@/components/shell/tip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BTreeModel, BTreePath } from "@/contracts/btree";
import type { Conclusion, Outcome } from "@/contracts/conclusion";
import type { EngineAdapter } from "@/contracts/engine";
import type { EvidencePack } from "@/contracts/mentor";
import type { RuleHit } from "@/contracts/finding";
import type { Plan } from "@/contracts/plan";
import type { FindingsRun } from "@/modules/findings/ui/use-findings";
import { AuthContext, useAuth } from "@/modules/auth/auth-provider";
import { GUEST_LOCKED_TABS, LockedTab, useGuest } from "@/modules/auth/guest";
import { LoginDialog } from "@/modules/auth/login-dialog";
import { buildEvidencePack } from "@/modules/mentor/evidence";
import { parseSchema } from "@/modules/data-lab/generate/plan-data";
import { JoinAnimation } from "@/modules/plan-runner/join-anim/join-animation";
import { PlanTree } from "@/modules/plan-runner/plan-tree";
import { SchemaDiagram } from "@/modules/plan-runner/schema-diagram/schema-diagram";
import { retarget } from "@/modules/what-if/capacity-ui/measure-level";
import { WhatIfCompare } from "@/modules/what-if/compare-ui/what-if-compare";
import { joinNodes, MYSQL_SCHEMA_QUERY, mysqlSchema, STAGE_INDEX_QUERY, STAGE_SCHEMA_QUERY, type IndexInfo } from "./stage-data";

// Capacity (GSAP, B-Tree) và Mentor (đọc stream) chỉ tải khi mở tab của chúng.
const CapacityPanel = dynamic(() => import("@/modules/what-if/capacity-ui").then((m) => m.CapacityPanel), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" aria-hidden />,
});
const MentorPanel = dynamic(() => import("@/modules/mentor/ui/mentor-panel").then((m) => m.MentorPanel), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" aria-hidden />,
});
// Tranh chấp kéo Cytoscape: chỉ tải khi mở tab của nó.
const ConflictPanel = dynamic(() => import("@/modules/conflict-sim/ui/conflict-panel").then((m) => m.ConflictPanel), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" aria-hidden />,
});
// BTreeDrop kéo GSAP: chỉ tải khi mở tab B-Tree.
const BTreeDrop = dynamic(() => import("@/modules/btree-reader/anim/btree-drop").then((m) => m.BTreeDrop), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" aria-hidden />,
});

/** Một lần chạy xong. `id` đổi theo mỗi lần chạy (và khi dữ liệu sinh thêm); dữ liệu của tab gắn với id này. */
export type StageRun = { id: number; db: EngineAdapter; select?: { n: number; sql: string } } & Pick<FindingsRun, "sql" | "srcSql" | "statements" | "explain">;
/** Cột Rủi ro nhờ Stage mở tab, làm nổi bảng hoặc mở nút plan. `nonce` đổi theo mỗi lần bấm. */
export type StageFocus = { nonce: number; runId: number; tab?: "schema" | "plan"; table?: string; planNodeId?: string };
/** Rủi ro đã kiểm cho Mentor; `pending` thì chờ kiểm xong rồi mới dựng gói bằng chứng. */
export type StageFindings = { hits: RuleHit[]; pending: boolean };
type Tab = "schema" | "plan" | "btree" | "whatif" | "capacity" | "mentor" | "conflict";
const TABS = ["schema", "plan", "btree", "whatif", "capacity", "mentor", "conflict"] as const;
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

function SchemaTab({ run, on, focus }: { run: StageRun; on: boolean; focus?: { table: string; nonce: number } }) {
  const t = useTranslations("labStage");
  const tl = useTranslations("lab");
  const my = run.db.engine === "mysql";
  const r = useLoad(on, `${run.id}`, async () => {
    const res = (await run.db.execute(my ? MYSQL_SCHEMA_QUERY : STAGE_SCHEMA_QUERY, { internal: true }))[0] ?? { columns: [], rows: [] };
    return parseSchema(my ? mysqlSchema(res) : res);
  });
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
      <SchemaDiagram tables={tables} focus={focus} />
    </div>
  );
}

function PlanTab({ run, r, openNode }: { run: StageRun; r: Load<Outcome<Plan>>; openNode?: { id: string; nonce: number } }) {
  const t = useTranslations("labStage");
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
      <OutcomeView o={r.v} render={(c) => <PlanTree plan={c.data} label={c.label} openNode={openNode} />} />
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

function BTreeTab({ run, on, list }: { run: StageRun; on: boolean; list: Load<IndexInfo[]> }) {
  const t = useTranslations("labStage");
  const ts = useTranslations("shell");
  // Lựa chọn gắn với đúng lần chạy: chạy lại thì bỏ, không đọc cây của index có thể đã đổi.
  const [pick, setPick] = useState<{ run: number; index: string; key: string; to: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const cur = pick && pick.run === run.id && list?.ok && list.v.some((x) => x.name === pick.index) ? pick : null;
  const tree = useLoad<{ model: Outcome<BTreeModel>; path?: BTreePath }>(
    on && !!cur,
    `${run.id}:${cur?.index}:${cur?.key}:${!!cur?.to}`,
    // khoảng khóa cần đọc nhiều leaf hơn: cây nhỏ thì đọc hết, cây lớn thì leaf nào chưa đọc animation sẽ dừng và nói rõ
    () => run.db.readBTree(cur!.index, cur!.key ? { probeKey: cur!.key, ...(cur!.to ? { maxNodes: 300 } : {}) } : undefined),
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
          onChange={(e) => (setPick(e.target.value ? { run: run.id, index: e.target.value, key: "", to: "" } : null), setDraft(""), setDraftTo(""))}
        >
          <option value="">{t("btree.choose")}</option>
          {list.v.map((x) => (
            <option key={x.name} value={x.name}>{t("btree.option", { index: x.name, table: x.table, method: x.method })}</option>
          ))}
        </select>
      </div>
      {cur && (
        <form className="flex min-w-0 flex-col gap-1" onSubmit={(e) => (e.preventDefault(), setPick({ ...cur, key: draft.trim(), to: draftTo.trim() }))}>
          <label htmlFor="stage-key" className="text-sm font-medium">{t("btree.keyLabel")}</label>
          <div className="flex min-w-0 gap-2">
            <Input id="stage-key" className="min-w-0" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("btree.keyPlaceholder")} />
            <Input id="stage-key-to" aria-label={t("btree.toLabel")} className="min-w-0" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} placeholder={t("btree.toPlaceholder")} />
            <Tip label={ts("tip.drop")}><Button type="submit" data-testid="stage-drop">{t("btree.drop")}</Button></Tip>
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
              <BTreeDrop model={c.data} path={tree.v.path} label={c.label} to={cur?.key && cur.to ? cur.to : undefined} />
            </div>
          )}
        />
      )}
    </div>
  );
}

// MySQL: B-Tree, Thử sửa, Capacity, Mentor chưa mô phỏng được. Lý do lấy từ adapter (btree, whatif) hoặc khóa riêng.
function MysqlNotSim({ run, which }: { run: StageRun; which: "btree" | "whatif" | "capacity" | "mentor" }) {
  const r = useLoad<Outcome<never>>(true, `${run.id}:${which}`, async () =>
    which === "btree" ? (await run.db.readBTree("")).model as Outcome<never> : which === "whatif" ? ((await run.db.tryChange("", "")) as Outcome<never>) : { kind: "not_simulated", reasonKey: `mysql.notSimulated.${which}` },
  );
  if (!r) return <Loading />;
  return r.ok ? <OutcomeView o={r.v} render={() => null} /> : <Note tone="error">{errText(r.e)}</Note>;
}

function CapacityTab({ run, list }: { run: StageRun; list: Load<IndexInfo[]> }) {
  const t = useTranslations("labStage");
  // Lựa chọn gắn với đúng lần chạy: chạy lại thì bỏ, panel dựng mới nên không còn số của lần trước.
  const [pick, setPick] = useState<{ run: number; index: string } | null>(null);
  if (!list) return <Loading />;
  if (!list.ok) return <Note tone="error">{t("error", { message: list.e })}</Note>;
  if (!list.v.length) return <Note>{t("capacity.none")}</Note>;
  const info = pick && pick.run === run.id ? list.v.find((x) => x.name === pick.index) : undefined;
  // Câu thăm dò là SELECT đang xem, nhưng chỉ khi nó đọc đúng bảng của index (retarget đổi tên bảng trong câu sang bảng tạm).
  const probe = info && run.select && retarget(run.select.sql, info.table) !== run.select.sql ? run.select.sql : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="stage-cap-index" className="text-sm font-medium">{t("capacity.indexLabel")}</label>
        <select
          id="stage-cap-index"
          className="h-9 min-w-0 border border-line bg-surface px-2 text-sm"
          value={info?.name ?? ""}
          onChange={(e) => setPick(e.target.value ? { run: run.id, index: e.target.value } : null)}
        >
          <option value="">{t("capacity.choose")}</option>
          {list.v.map((x) => (
            <option key={x.name} value={x.name}>{t("btree.option", { index: x.name, table: x.table, method: x.method })}</option>
          ))}
        </select>
        {info && (
          <p className="m-0 text-xs text-dim" data-testid="stage-cap-probe">
            {probe ? t("capacity.probe", { n: run.select!.n }) : run.select ? t("capacity.noProbe", { table: info.table }) : t("capacity.noSelect")}
          </p>
        )}
      </div>
      {info ? <CapacityPanel key={`${run.id}:${info.name}`} adapter={run.db} index={info.name} table={info.table} probe={probe} /> : <Note>{t("capacity.pick")}</Note>}
    </div>
  );
}

function MentorTab({ run, plan, askRef, findings }: { run: StageRun; plan: Load<Outcome<Plan>>; askRef: RefObject<string>; findings: StageFindings }) {
  const t = useTranslations("labStage");
  const auth = useAuth();
  const [login, setLogin] = useState(false);
  // Tab bị bỏ (chạy lại, đổi engine): bản lưu tạm không còn giữ câu hỏi cũ.
  useEffect(() => () => void (askRef.current = ""), [askRef]);
  // MentorPanel và hộp thoại đăng nhập của nó ghi vào askRef thay vì sqlRef của lab (xem stash.ts).
  const ctx = useMemo(() => ({ ...auth, sqlRef: askRef }), [auth, askRef]);
  // Gói bằng chứng: chỉ câu SELECT đang xem và plan của nó, không dòng kết quả, không dữ liệu bảng. Rủi ro chỉ là kết quả luật (không dòng dữ liệu).
  const evidence = useMemo<EvidencePack | null>(
    () => (run.select && plan ? buildEvidencePack({ engine: run.db.engine, sql: run.select.sql, plan: plan.ok && plan.v.kind === "conclusion" ? plan.v.data : undefined, findings: findings.hits }) : null),
    [run, plan, findings.hits],
  );
  if (!run.select) return <Note>{t("mentor.noSelect")}</Note>;
  if (!evidence || findings.pending) return <Loading />;
  return (
    <AuthContext.Provider value={ctx}>
      <div className="flex min-w-0 flex-col gap-3">
        {auth.status === "anon" && (
          <Alert data-testid="mentor-invite">
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{t("mentor.invite")}</span>
              <Button size="sm" variant="outline" onClick={() => setLogin(true)}>{t("mentor.signIn")}</Button>
            </AlertDescription>
          </Alert>
        )}
        <p className="m-0 text-xs text-dim" data-testid="mentor-pack-note">{t("mentor.planNote", { n: run.select.n })}</p>
        <MentorPanel adapter={run.db} evidence={evidence} probe={run.select.sql} />
        <LoginDialog open={login} reason="ai" onClose={() => setLogin(false)} />
      </div>
    </AuthContext.Provider>
  );
}

function WhatIfTab({ run }: { run: StageRun }) {
  const t = useTranslations("labStage");
  if (!run.select) return <Note>{t("whatif.noSelect")}</Note>;
  // key: chạy lại thì dựng mới, không giữ kết quả so sánh của lần trước.
  return <WhatIfCompare key={run.id} adapter={run.db} probe={run.select.sql} />;
}

export function Stage({ run, working, askRef, focus, findings }: { run: StageRun | null; working: boolean; askRef: RefObject<string>; focus?: StageFocus | null; findings: StageFindings }) {
  const t = useTranslations("labStage");
  const ts = useTranslations("shell");
  const [tab, setTab] = useState<Tab>("schema");
  const { guest } = useGuest();
  const locked = (x: Tab) => guest && GUEST_LOCKED_TABS.has(x); // khách xem được Sơ đồ, Plan và Tranh chấp
  const gated = (x: Tab, node: ReactNode) => (locked(x) ? <LockedTab name={t(`tab.${x}`)} /> : node);
  // Panel giữ mounted (keepMounted) nên chuyển tab không đọc lại: explain chạy thật câu SELECT, đọc lại sẽ làm nextval() nhảy thêm.
  const [seen, setSeen] = useState<{ id: number; tabs: Tab[] }>({ id: -1, tabs: [] });
  const open = (x: Tab) => !locked(x) && run !== null && (tab === x || (seen.id === run.id && seen.tabs.includes(x)));
  const change = (v: unknown) => {
    if (run) setSeen((s) => ({ id: run.id, tabs: [...new Set([...(s.id === run.id ? s.tabs : []), tab])] }));
    setTab(v as Tab);
  };
  // Plan và danh sách index dùng chung giữa các tab: tải một lần cho mỗi lần chạy, không tải lại khi đổi tab.
  const my = run?.db.engine === "mysql";
  const plan = useLoad<Outcome<Plan>>(!!run?.select && (open("plan") || (!my && open("mentor"))), `${run?.id}`, () => run!.explain(run!.select!.sql));
  const indexes = useLoad<IndexInfo[]>(!!run && !my && (open("btree") || open("capacity")), `${run?.id}`, async () =>
    ((await run!.db.execute(STAGE_INDEX_QUERY, { internal: true }))[0]?.rows ?? []).map((x) => ({ name: String(x[0]), table: String(x[1]), method: String(x[2]) })),
  );
  // Bấm một rủi ro: mở tab tương ứng (chỉnh state ngay lúc render, không qua effect).
  const [doneNonce, setDoneNonce] = useState(0);
  const f = run && focus && focus.runId === run.id ? focus : null;
  if (f && f.nonce !== doneNonce) {
    setDoneNonce(f.nonce);
    if (f.tab && f.tab !== tab) change(f.tab);
  }
  const hint = !run ? (working ? t("working") : ts("placeholder.stage")) : null;
  return (
    <div className="flex min-h-full min-w-0 flex-col">
      <div className="flex h-[var(--h-bar)] flex-none items-center border-b border-line px-[var(--edge)] font-semibold">{ts("tab.stage")}</div>
      <div className="flex min-w-0 flex-col gap-3 p-[var(--edge)]">
        {hint !== null || !run ? (
          <Note>{hint}</Note>
        ) : (
          <Tabs value={tab} onValueChange={change}>
            <TabsList className="h-auto w-full flex-wrap" aria-label={t("tabsLabel")} activateOnFocus>
              {TABS.map((x) => (
                <Tip key={x} label={ts(`tip.tab.${x}`)}><TabsTrigger value={x}>{t(`tab.${x}`)}{locked(x) && <Lock aria-hidden className="size-3" />}</TabsTrigger></Tip>
              ))}
            </TabsList>
            <TabsContent value="schema" className="min-w-0" keepMounted><SchemaTab run={run} on={open("schema")} focus={f?.table ? { table: f.table, nonce: f.nonce } : undefined} /></TabsContent>
            <TabsContent value="plan" className="min-w-0" keepMounted><PlanTab run={run} r={plan} openNode={f?.planNodeId ? { id: f.planNodeId, nonce: f.nonce } : undefined} /></TabsContent>
            <TabsContent value="btree" className="min-w-0" keepMounted>{gated("btree", my ? <MysqlNotSim run={run} which="btree" /> : <BTreeTab run={run} on={open("btree")} list={indexes} />)}</TabsContent>
            <TabsContent value="whatif" className="min-w-0" keepMounted>{gated("whatif", my ? <MysqlNotSim run={run} which="whatif" /> : <WhatIfTab run={run} />)}</TabsContent>
            <TabsContent value="capacity" className="min-w-0" keepMounted>{gated("capacity", open("capacity") && (my ? <MysqlNotSim run={run} which="capacity" /> : <CapacityTab run={run} list={indexes} />))}</TabsContent>
            <TabsContent value="mentor" className="min-w-0" keepMounted>{gated("mentor", open("mentor") && (my ? <MysqlNotSim run={run} which="mentor" /> : <MentorTab run={run} plan={plan} askRef={askRef} findings={findings} />))}</TabsContent>
            <TabsContent value="conflict" className="min-w-0" keepMounted>{open("conflict") && <ConflictPanel />}</TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
