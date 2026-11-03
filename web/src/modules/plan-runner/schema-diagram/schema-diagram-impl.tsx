"use client";

import "@xyflow/react/dist/style.css";
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Edge as RFEdge } from "@xyflow/react";
import { Maximize, Minus, Plus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TableInfo } from "@/modules/data-lab/generate/plan-data";
import {
  autoLayout, cardHeight, CARD_W, COLLAPSE_OVER, loadPos, NARROW_MAX, relations, savePos, separate, tableKey, type Pos, type Rect,
} from "./layout";
import { TableCard, type TableNode } from "./table-node";

const nodeTypes = { table: TableCard };
const fitOpts = { maxZoom: 1, padding: 0.1, duration: 0 };

function Inner({ tables }: { tables: TableInfo[] }) {
  const t = useTranslations("schema-diagram");
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState<boolean | null>(null);
  const [override, setOverride] = useState<boolean | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const many = tables.length > COLLAPSE_OVER;
  const collapsed = override ?? many;
  const { edges: rels, missing } = useMemo(() => relations(tables), [tables]);
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNode>([]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW_MAX));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const heightOf = useMemo(() => new Map(tables.map((x) => [tableKey(x), cardHeight(x, collapsed)])), [tables, collapsed]);
  const rectOf = useCallback((k: string, p: Pos): Rect => ({ x: p.x, y: p.y, w: CARD_W, h: heightOf.get(k) ?? 0 }), [heightOf]);

  const build = useCallback(
    (useSaved: boolean): TableNode[] => {
      const auto = autoLayout(tables, !!narrow, collapsed);
      const saved = useSaved ? loadPos(!!narrow) : {};
      const placed: Rect[] = [];
      return tables.map((tb) => {
        const k = tableKey(tb);
        const wanted = saved[k] ?? auto[k];
        // vị trí đã lưu có thể chồng khi bảng đổi chiều cao (gọn/đủ cột): đẩy ra trước khi hiện
        const position = saved[k] ? separate(rectOf(k, wanted), placed) : wanted;
        placed.push(rectOf(k, position));
        return {
          id: k, type: "table", position, draggable: true,
          ariaLabel: t("nodeLabel", { name: tb.name, count: tb.columns.length }),
          data: { table: tb, collapsed, missing: missing.filter((m) => m.from === tb.name).map((m) => m.column) },
        };
      });
    },
    [tables, narrow, collapsed, missing, rectOf, t],
  );

  useEffect(() => {
    if (narrow === null) return;
    setNodes(build(true));
    const id = requestAnimationFrame(() => rf.fitView(fitOpts));
    return () => cancelAnimationFrame(id);
  }, [build, narrow, setNodes, rf]);

  const persist = (list: TableNode[]) => savePos(!!narrow, Object.fromEntries(list.map((n) => [n.id, n.position])));

  const settle = (id: string, pos?: Pos) => {
    setNodes((cur) => {
      const me = cur.find((n) => n.id === id);
      if (!me) return cur;
      const others = cur.filter((n) => n.id !== id).map((n) => rectOf(n.id, n.position));
      const position = separate(rectOf(id, pos ?? me.position), others);
      const next = cur.map((n) => (n.id === id ? { ...n, position } : n));
      persist(next);
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || !el.classList.contains("react-flow__node")) return;
    e.preventDefault();
    const id = el.dataset.id!;
    const step = e.shiftKey ? 64 : 16;
    const me = nodes.find((n) => n.id === id);
    if (me) settle(id, { x: me.position.x + d[0] * step, y: me.position.y + d[1] * step });
  };

  const edges: RFEdge[] = useMemo(
    () =>
      rels.map((r) => ({
        id: r.id, source: r.source, target: r.target,
        sourceHandle: collapsed ? "t" : r.sourceCol, targetHandle: collapsed ? "t" : r.targetCol,
        focusable: false, selectable: false,
        style: { stroke: dragging && (r.source === dragging || r.target === dragging) ? "var(--lamp)" : "var(--dim)", strokeWidth: 1.5 },
      })),
    [rels, collapsed, dragging],
  );

  const relayout = () => {
    savePos(!!narrow, null);
    setNodes(build(false));
    requestAnimationFrame(() => rf.fitView(fitOpts));
  };

  if (tables.length === 0)
    return <p role="status" className="rounded-xl border border-rule p-6 text-center text-sm text-dim">{t("empty")}</p>;

  return (
    <section aria-labelledby="sd-title" className="flex min-w-0 flex-col gap-2">
      <h2 id="sd-title" className="sr-only">{t("title")}</h2>
      {/* Y2: cụm nút nằm trên canvas, không đè lên thẻ */}
      <div role="toolbar" aria-label={t("toolbar")} className="flex flex-wrap items-center gap-1.5">
        <Button variant="outline" className="h-11 min-w-11 sm:h-8 sm:min-w-8" aria-label={t("zoomIn")} onClick={() => rf.zoomIn({ duration: 0 })}><Plus /></Button>
        <Button variant="outline" className="h-11 min-w-11 sm:h-8 sm:min-w-8" aria-label={t("zoomOut")} onClick={() => rf.zoomOut({ duration: 0 })}><Minus /></Button>
        <Button variant="outline" className="h-11 sm:h-8" onClick={() => rf.fitView(fitOpts)}><Maximize />{t("fit")}</Button>
        <Button variant="outline" className="h-11 sm:h-8" onClick={relayout}><RotateCcw />{t("relayout")}</Button>
        {many && (
          <Button variant="outline" className="h-11 sm:h-8" aria-pressed={!collapsed} onClick={() => setOverride(!collapsed)}>
            {collapsed ? t("showColumns") : t("hideColumns")}
          </Button>
        )}
      </div>
      {many && collapsed && <p className="text-xs text-dim" role="note">{t("collapsedNote", { count: tables.length, limit: COLLAPSE_OVER })}</p>}
      {missing.length > 0 && <p className="text-xs text-dim" role="note">{t("missingNote", { count: missing.length })}</p>}
      <div
        ref={wrap}
        role="group"
        aria-label={t("canvas")}
        data-testid="schema-canvas"
        onKeyDown={onKeyDown}
        className="h-[60vh] min-h-72 w-full overflow-hidden rounded-xl border border-rule bg-stage"
      >
        {narrow !== null && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStart={(_, n) => setDragging(n.id)}
            onNodeDragStop={(_, n) => {
              setDragging(null);
              settle(n.id, n.position);
            }}
            minZoom={0.3}
            maxZoom={1.6}
            nodesConnectable={false}
            edgesFocusable={false}
            disableKeyboardA11y
            onlyRenderVisibleElements={tables.length > 60}
            panActivationKeyCode="Space"
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="var(--canvas-dot)" />
          </ReactFlow>
        )}
      </div>
      <Summary tables={tables} rels={rels} missing={missing} />
    </section>
  );
}

// Bản tóm tắt chữ cho trình đọc màn hình (AC7).
function Summary({ tables, rels, missing }: { tables: TableInfo[]; rels: ReturnType<typeof relations>["edges"]; missing: ReturnType<typeof relations>["missing"] }) {
  const t = useTranslations("schema-diagram");
  return (
    <div className="sr-only" data-testid="schema-summary">
      <h3>{t("summaryTitle", { count: tables.length })}</h3>
      <ul>
        {tables.map((tb) => (
          <li key={tableKey(tb)}>
            {t("summaryTable", { name: tb.name, count: tb.columns.length })}
            <ul>
              {tb.columns.map((c) => (
                <li key={c.name}>
                  {c.name}, {c.type}
                  {c.isPrimaryKey ? `, ${t("pk")}` : ""}
                  {c.references ? `, ${t("fkTo", { table: c.references.table, column: c.references.column })}` : ""}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <h3>{t("summaryRelations", { count: rels.length + missing.length })}</h3>
      <ul>
        {rels.map((r) => (
          <li key={r.id}>{t("summaryRel", { from: r.source.split(".").slice(1).join("."), fromCol: r.sourceCol, to: r.target.split(".").slice(1).join("."), toCol: r.targetCol })}</li>
        ))}
        {missing.map((m) => (
          <li key={`${m.from}.${m.column}`}>{t("summaryMissing", { from: m.from, column: m.column, table: m.table })}</li>
        ))}
      </ul>
    </div>
  );
}

export default function SchemaDiagramImpl({ tables }: { tables: TableInfo[] }) {
  return (
    <ReactFlowProvider>
      <Inner tables={tables} />
    </ReactFlowProvider>
  );
}
