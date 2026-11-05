"use client";

import "@xyflow/react/dist/style.css";
import { Background, BackgroundVariant, Handle, Position, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow, type Edge, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import { useFormatter, useTranslations } from "next-intl";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { EvidenceLabel } from "@/contracts/conclusion";
import type { Plan, PlanNode } from "@/contracts/plan";
import { expectedTotal, flatten, layoutPlan, NARROW, NH, NW, signature, skew, type Flat, type Pos } from "./layout";

const STEP = 16;
const STEP_BIG = 64;
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* localStorage bị chặn: bỏ qua, giao diện vẫn chạy */
    }
  },
};
const storeKey = (narrow: boolean) => `sqllens.plan.${narrow ? "narrow" : "wide"}`;

// Bản lưu chỉ được dùng khi đúng plan này (cùng chữ ký các bước) và tọa độ hợp lệ.
function readStored(narrow: boolean, sig: string): Record<string, Pos> {
  try {
    const o = JSON.parse(store.get(storeKey(narrow)) ?? "null") as { sig?: unknown; pos?: Record<string, Partial<Pos>> } | null;
    if (!o || o.sig !== sig || !o.pos) return {};
    const out: Record<string, Pos> = {};
    for (const [k, v] of Object.entries(o.pos)) if (typeof v?.x === "number" && typeof v?.y === "number" && Number.isFinite(v.x + v.y)) out[k] = { x: v.x, y: v.y };
    return out;
  } catch {
    return {};
  }
}

function Badge({ label, text }: { label: EvidenceLabel; text: string }) {
  const cls =
    label === "real"
      ? "bg-label-real text-label-real-foreground"
      : label === "simulated"
        ? "border border-label-simulated text-white"
        : "border border-dashed border-label-estimated italic text-white";
  return (
    <span data-testid="plan-label" data-label={label} className={`inline-flex h-5 items-center gap-1 rounded-[2px] px-[7px] text-xs ${cls}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="currentColor" stroke="currentColor">
        {label === "real" && <circle cx="5" cy="5" r="4" />}
        {label === "simulated" && (
          <>
            <circle cx="5" cy="5" r="3.5" fill="none" />
            <path d="M5 1.5a3.5 3.5 0 0 1 0 7z" stroke="none" />
          </>
        )}
        {label === "estimated" && <path d="M0 3.5q1.25-2 2.5 0t2.5 0 2.5 0 2.5 0M0 7q1.25-2 2.5 0t2.5 0 2.5 0 2.5 0" fill="none" />}
      </svg>
      {text}
    </span>
  );
}

type StepData = { step: PlanNode; analyzed: boolean; narrow: boolean; onOpen: (id: string, el: HTMLElement) => void; onMove: (id: string, dx: number, dy: number) => void };
type StepNode = Node<StepData, "step">;

function useNum() {
  const t = useTranslations("plan-tree");
  const f = useFormatter();
  // undefined là "engine không cung cấp", không được hiện thành 0.
  return (v: number | undefined) => (v === undefined ? t("none") : f.number(v));
}

const Row = ({ k, v, missing }: { k: string; v: string; missing: boolean }) => (
  <div className="flex min-w-0 justify-between gap-2">
    <dt className="shrink-0 text-dim">{k}</dt>
    <dd title={v} className={`min-w-0 truncate pr-0.5 text-right ${missing ? "italic text-dim" : "font-mono text-text"}`}>{v}</dd>
  </div>
);

const StepCard = memo(function StepCard({ id, data }: NodeProps<StepNode>) {
  const t = useTranslations("plan-tree");
  const num = useNum();
  const { step: n, analyzed, narrow } = data;
  const gap = skew(n, analyzed);
  const text = (v: string | undefined) => v ?? t("none");
  return (
    <div style={{ width: NW, height: NH }}>
      <Handle id="t" type="target" position={Position.Left} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <button
        type="button"
        data-testid="plan-step"
        data-step={id}
        data-kind={n.kind}
        aria-haspopup="dialog"
        title={t("open", { name: n.label })}
        onClick={(e) => data.onOpen(id, e.currentTarget)}
        onKeyDown={(e) => {
          const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
          if (!d) return;
          e.preventDefault();
          const s = e.shiftKey ? STEP_BIG : STEP;
          data.onMove(id, d[0] * s, d[1] * s);
        }}
        className="flex h-full w-full cursor-grab flex-col gap-1.5 overflow-hidden rounded-[4px] border border-line bg-raised p-3 text-left text-xs text-ink2 outline-none focus-visible:ring-2 focus-visible:ring-lamp active:cursor-grabbing"
      >
        <span className="shrink-0 truncate text-sm font-semibold text-text">{n.label}</span>
        {gap && (
          <span data-testid="plan-skew" data-skew={gap} className="flex shrink-0 items-start gap-1 rounded-[2px] border border-severity-uncertain bg-severity-uncertain-bg px-1.5 py-0.5 text-severity-uncertain-foreground">
            <span aria-hidden="true">!</span>
            {t(`skew.${gap}`)}
          </span>
        )}
        <dl className="flex shrink-0 flex-col gap-0.5">
          <Row k={t("fields.table")} v={text(n.table)} missing={n.table === undefined} />
          <Row k={t("fields.index")} v={text(n.index)} missing={n.index === undefined} />
          <Row k={t("card.estRows")} v={num(n.estimatedRows)} missing={n.estimatedRows === undefined} />
          <Row k={t("card.actualRows")} v={num(n.actualRows)} missing={n.actualRows === undefined} />
          <Row k={t("card.pages")} v={num(n.pagesRead)} missing={n.pagesRead === undefined} />
        </dl>
      </button>
      <Handle id="s" type="source" position={narrow ? Position.Left : Position.Right} isConnectable={false} className="!pointer-events-none !opacity-0" />
    </div>
  );
});
const nodeTypes = { step: StepCard };

function Detail({ step, analyzed, label, onClose, returnTo }: { step: PlanNode | undefined; analyzed: boolean; label: EvidenceLabel; onClose: () => void; returnTo: React.RefObject<HTMLElement | null> }) {
  const t = useTranslations("plan-tree");
  const num = useNum();
  const gap = step && skew(step, analyzed);
  const rows: [string, string, boolean][] = step
    ? [
        [t("fields.table"), step.table ?? t("none"), step.table === undefined],
        [t("fields.index"), step.index ?? t("none"), step.index === undefined],
        [t("fields.condition"), step.condition ?? t("none"), step.condition === undefined],
        [t("fields.filter"), step.filter ?? t("none"), step.filter === undefined],
        [t("fields.estRows"), num(step.estimatedRows), step.estimatedRows === undefined],
        [t("fields.loops"), num(step.loops), step.loops === undefined],
        [t("fields.estTotal"), num(expectedTotal(step)), step.estimatedRows === undefined],
        [t("fields.actualRows"), num(step.actualRows), step.actualRows === undefined],
        [t("fields.pages"), num(step.pagesRead), step.pagesRead === undefined],
      ]
    : [];
  return (
    <Dialog open={!!step} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} finalFocus={returnTo} data-testid="plan-detail" className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        {step && (
          <>
            <DialogTitle>{t("detailTitle", { name: step.label })}</DialogTitle>
            <DialogDescription render={<div />} className="flex flex-col gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <Badge label={label} text={t(`label.${label}`)} />
              </span>
              {!analyzed && <span data-testid="plan-detail-notanalyzed">{t("notAnalyzed")}</span>}
            </DialogDescription>
            <section>
              <h3 className="text-xs font-semibold text-text">{t("explainTitle")}</h3>
              <p className="text-sm">{t(`kind.${step.kind}`)}</p>
            </section>
            {gap && (
              <p data-testid="plan-detail-skew" className="rounded-[2px] border border-severity-uncertain bg-severity-uncertain-bg px-2 py-1 text-severity-uncertain-foreground">
                <strong>{t(`skew.${gap}`)}.</strong> {t("skew.detail", { est: num(expectedTotal(step)), actual: num(step.actualRows) })}
              </p>
            )}
            <dl className="flex flex-col gap-1 text-xs">
              {rows.map(([k, v, missing]) => (
                <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
                  <dt className="text-dim">{k}</dt>
                  <dd className={`break-words ${missing ? "italic text-dim" : "font-mono text-text"}`}>{v}</dd>
                </div>
              ))}
            </dl>
            <Button variant="outline" onClick={onClose}>{t("close")}</Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Canvas({ plan, label, narrow, flat, sig, onReset, openNode }: { plan: Plan; label: EvidenceLabel; narrow: boolean; flat: Flat[]; sig: string; onReset: () => void; openNode?: { id: string; nonce: number } }) {
  const t = useTranslations("plan-tree");
  const num = useNum();
  const rf = useReactFlow();
  const [openId, setOpenId] = useState<string>();
  const [dragId, setDragId] = useState<string>();
  const returnTo = useRef<HTMLElement | null>(null);
  // Bấm "Mở nút trong Plan" ở cột Rủi ro: mở đúng nút đó, một lần cho mỗi lần bấm.
  const [shownNonce, setShownNonce] = useState<number>();
  if (openNode && openNode.nonce !== shownNonce) {
    setShownNonce(openNode.nonce);
    if (flat.some((f) => f.node.id === openNode.id)) setOpenId(openNode.id);
  }

  const save = useCallback(
    (ns: Node[]) => store.set(storeKey(narrow), JSON.stringify({ sig, pos: Object.fromEntries(ns.map((n) => [n.id, n.position])) })),
    [narrow, sig],
  );
  const onOpen = useCallback((id: string, el: HTMLElement) => {
    returnTo.current = el;
    setOpenId(id);
  }, []);
  const [nodes, setNodes] = useState<Node[]>(() => {
    const base = { ...layoutPlan(flat, narrow), ...readStored(narrow, sig) };
    return flat.map((f) => ({
      id: f.node.id,
      type: "step",
      position: base[f.node.id],
      initialWidth: NW,
      initialHeight: NH,
      focusable: false,
      data: { step: f.node, analyzed: plan.analyzed, narrow, onOpen, onMove: () => {} } satisfies StepData,
    }));
  });
  const nodesRef = useRef(nodes);
  const onMove = useCallback(
    (id: string, dx: number, dy: number) => {
      const next = nodesRef.current.map((n) => (n.id === id ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n));
      nodesRef.current = next;
      setNodes(next);
      save(next);
    },
    [save],
  );
  const shown = useMemo(() => nodes.map((n) => ({ ...n, data: { ...n.data, onMove } })), [nodes, onMove]);

  const edges = useMemo<Edge[]>(
    () =>
      flat.flatMap((f) =>
        f.parent
          ? [
              {
                id: `${f.parent}>${f.node.id}`,
                source: f.parent,
                target: f.node.id,
                sourceHandle: "s",
                targetHandle: "t",
                type: "smoothstep",
                focusable: false,
                style: { stroke: dragId === f.parent || dragId === f.node.id ? "var(--lamp)" : "var(--control)", strokeWidth: 1.5 },
              },
            ]
          : [],
      ),
    [flat, dragId],
  );
  const onNodesChange = useCallback((c: NodeChange[]) => {
    const next = applyNodeChanges(c, nodesRef.current);
    nodesRef.current = next;
    setNodes(next);
  }, []);
  // Plan dài: mở ở đầu cây cho đọc được, nút "Vừa màn hình" mới thu cả cây.
  const first = narrow ? 3 : 4;
  const initialFit = useMemo(() => ({ maxZoom: 1, minZoom: 0.3, padding: 0.12, nodes: flat.length > first ? flat.slice(0, first).map((f) => ({ id: f.node.id })) : undefined }), [flat, first]);
  const step = openId ? flat.find((f) => f.node.id === openId)?.node : undefined;

  return (
    <section aria-label={t("region")} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2" data-testid="plan-tree" data-narrow={narrow}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge label={label} text={t(`label.${label}`)} />
      </div>
      {!plan.analyzed && (
        <p role="note" data-testid="plan-notanalyzed" className="rounded-[2px] border border-dashed border-label-estimated px-2 py-1 text-xs text-ink2">{t("notAnalyzed")}</p>
      )}
      <div role="group" aria-label={t("canvasLabel", { count: flat.length })} className="h-[min(75dvh,640px)] min-h-[320px] min-w-0 overflow-hidden rounded-[4px] border border-line bg-stage" data-testid="plan-canvas">
        <ReactFlow
          nodes={shown}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStart={(_, n) => setDragId(n.id)}
          onNodeDragStop={() => {
            setDragId(undefined);
            save(nodesRef.current);
          }}
          fitView
          fitViewOptions={initialFit}
          minZoom={0.3}
          maxZoom={1.6}
          nodesConnectable={false}
          elementsSelectable={false}
          nodeDragThreshold={3}
          panActivationKeyCode="Space"
          disableKeyboardA11y
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="var(--canvas-dot)" />
        </ReactFlow>
      </div>
      <div role="toolbar" aria-label={t("toolbar.label")} className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => rf.zoomIn({ duration: 0 })}>{t("toolbar.zoomIn")}</Button>
        <Button variant="outline" size="sm" onClick={() => rf.zoomOut({ duration: 0 })}>{t("toolbar.zoomOut")}</Button>
        <Button variant="outline" size="sm" onClick={() => rf.fitView({ maxZoom: 1, minZoom: 0.3, padding: 0.12, duration: 0 })}>{t("toolbar.fit")}</Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            store.set(storeKey(narrow), null);
            onReset();
          }}
        >
          {t("toolbar.reset")}
        </Button>
      </div>
      <p className="text-xs text-dim">{t("hint")}</p>
      <details className="text-xs text-ink2" data-testid="plan-summary">
        <summary className="cursor-pointer text-text">{t("summary.title")}</summary>
        <ol className="mt-1 flex flex-col gap-0.5">
          {flat.map((f) => (
            <li key={f.node.id} style={{ paddingLeft: Math.min(f.depth, 6) * 12 }}>
              {t("summary.item", {
                name: f.node.label,
                table: f.node.table ? t("summary.onTable", { table: f.node.table }) : "",
                est: num(f.node.estimatedRows),
                actual: num(f.node.actualRows),
                pages: num(f.node.pagesRead),
              })}
            </li>
          ))}
        </ol>
      </details>
      <Detail step={step} analyzed={plan.analyzed} label={label} onClose={() => setOpenId(undefined)} returnTo={returnTo} />
    </section>
  );
}

export default function PlanTreeFlow({ plan, label, openNode }: { plan: Plan; label: EvidenceLabel; openNode?: { id: string; nonce: number } }) {
  const t = useTranslations("plan-tree");
  const wrap = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState<boolean>();
  const [resets, setResets] = useState(0);
  // Chọn bố cục theo bề rộng vùng chứa, không theo màn hình, vì cây nằm trong một cột của màn hình chính.
  useLayoutEffect(() => {
    const el = wrap.current!;
    const measure = () => setNarrow(el.clientWidth < NARROW);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const flat = useMemo(() => flatten(plan), [plan]);
  const sig = useMemo(() => signature(flat), [flat]);
  return (
    <div ref={wrap} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {narrow === undefined ? (
        <p className="text-xs text-dim">{t("loading")}</p>
      ) : (
        <ReactFlowProvider key={`${narrow}|${sig}|${resets}`}>
          <Canvas plan={plan} label={label} narrow={narrow} flat={flat} sig={sig} openNode={openNode} onReset={() => setResets((n) => n + 1)} />
        </ReactFlowProvider>
      )}
    </div>
  );
}
