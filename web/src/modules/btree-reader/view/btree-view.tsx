"use client";

import { useTranslations } from "next-intl";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BTreeModel, BTreeNode, BTreePath } from "@/contracts/btree";
import type { EvidenceLabel } from "@/contracts/conclusion";
import { CAP, layoutTree, MIN_GAP, NH, NW, PAD, pathItemIds, settle, type Item, type Off } from "./layout";

type Mode = "fixed" | "free";
const MODE_KEY = "sqllens.btree.mode";
const NEG_INF = "−∞";
const STEP = 8;

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* localStorage bị chặn: bỏ qua, giao diện vẫn chạy */
    }
  },
};

export function readStoredMode(): Mode {
  return store.get(MODE_KEY) === "free" ? "free" : "fixed";
}

function readOffsets(key: string): Off {
  try {
    const o = JSON.parse(store.get(key) ?? "{}");
    const out: Off = {};
    for (const [k, v] of Object.entries(o ?? {})) {
      const p = v as { x?: unknown; y?: unknown };
      if (typeof p?.x === "number" && typeof p?.y === "number" && Number.isFinite(p.x + p.y)) out[k] = { x: p.x, y: p.y };
    }
    return out;
  } catch {
    return {};
  }
}

// Vị trí tâm node theo tọa độ SVG, để Task041 đặt key rơi. undefined nếu trang chưa vẽ (bị ẩn).
const registry = new Map<number, { x: number; y: number }>();
export function nodePosition(page: number): { x: number; y: number } | undefined {
  return registry.get(page);
}

function Badge({ label, text, tooltip }: { label: EvidenceLabel; text: string; tooltip?: string }) {
  const cls =
    label === "real"
      ? "bg-label-real text-label-real-foreground"
      : label === "simulated"
        ? "border border-label-simulated text-white"
        : "border border-dashed border-label-estimated italic text-white";
  return (
    <span
      data-testid="btree-label"
      data-label={label}
      title={tooltip}
      className={`inline-flex h-5 items-center gap-1 rounded-[2px] px-[7px] text-xs ${cls}`}
    >
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

const cut = (s: string) => (s.length > 7 ? `${s.slice(0, 6)}…` : s);
function cells(n: BTreeNode): string[] {
  const k = n.keys.map((x) => (x === "" ? NEG_INF : x));
  return k.length > 3 ? [k[0], k[1], "…"] : k;
}

type NodeProps = {
  item: Item;
  x: number;
  y: number;
  node?: BTreeNode;
  lit: boolean;
  free: boolean;
  dimmed?: boolean;
  title: string;
  caption: string;
  aria: string;
  onDown: (e: React.PointerEvent, id: string) => void;
  onKey: (e: React.KeyboardEvent, id: string) => void;
  dragging: boolean;
};

const NodeG = memo(function NodeG({ item, x, y, node, lit, free, dimmed, title, caption, aria, onDown, onKey, dragging }: NodeProps) {
  const stroke = lit || dragging ? "stroke-lamp" : "stroke-control";
  return (
    <g
      transform={`translate(${x} ${y})`}
      data-page={item.page}
      data-hidden-level={item.page === undefined ? item.level : undefined}
      data-lit={lit || undefined}
      data-dimmed={dimmed ? "true" : undefined}
      tabIndex={free ? 0 : undefined}
      role={free ? "button" : undefined}
      aria-label={free ? aria : undefined}
      className={`outline-none ${free ? "cursor-grab focus-visible:[&>rect:first-of-type]:stroke-lamp active:cursor-grabbing" : ""}`}
      style={dimmed ? { opacity: 0.22 } : (free ? { touchAction: "none" } : undefined)}
      onPointerDown={free ? (e) => onDown(e, item.id) : undefined}
      onKeyDown={free ? (e) => onKey(e, item.id) : undefined}
    >
      <title>{title}</title>
      {node ? (
        <>
          <rect width={NW} height={NH} rx={2} className={`fill-card ${stroke}`} strokeWidth={lit ? 1.5 : 1} />
          {[1, 2].map((c) => (
            <line key={c} x1={(NW / 3) * c} x2={(NW / 3) * c} y1={0} y2={NH} className="stroke-control" />
          ))}
          {cells(node).map((k, i) => (
            <text key={i} x={(NW / 3) * i + NW / 6} y={20} textAnchor="middle" className="fill-ink2" style={{ font: "12.5px var(--mono)" }}>
              {cut(k)}
            </text>
          ))}
          <text x={0} y={NH + 12} className="fill-dim" style={{ font: "11px var(--sans)" }}>
            {caption}
          </text>
        </>
      ) : (
        <>
          <rect width={item.w} height={NH} rx={2} strokeDasharray="3 3" className={`fill-stage ${lit ? "stroke-lamp" : "stroke-control"}`} strokeWidth={lit ? 1.5 : 1} />
          <text x={item.w / 2} y={20} textAnchor="middle" className="fill-ink2" style={{ font: "12.5px var(--mono)" }}>
            {caption}
          </text>
        </>
      )}
    </g>
  );
});

export function BTreeView({
  model,
  path,
  label,
  mode,
  onModeChange,
  align,
  dimmed,
  dimReason,
}: {
  model: BTreeModel;
  path?: BTreePath;
  align?: number[]; // đường đi cần thấy trong khung (không tô sáng): đặt tổ tiên ngay trên con và cuộn tới đó
  label: EvidenceLabel;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  dimmed?: boolean;
  dimReason?: string;
}) {
  const t = useTranslations("btree");
  const free = mode === "free";
  const offKey = `sqllens.btree.${model.engine === "mysql" ? "my" : "pg"}`;
  const pathPages = useMemo(() => path?.pages ?? [], [path]);
  // Cha có thể tạo mảng mới mỗi lần render: giữ tham chiếu theo nội dung, kẻo layout và vị trí cuộn bị đặt lại.
  const alignKey = align?.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const alignPages = useMemo(() => align, [alignKey]);
  const layout = useMemo(() => layoutTree(model, pathPages, alignPages), [model, pathPages, alignPages]);
  const byPage = useMemo(() => new Map(model.nodes.map((n) => [n.page, n])), [model]);
  const [off, setOff] = useState<Off>({});
  const [drag, setDrag] = useState<string | null>(null);
  const offRef = useRef(off);
  useLayoutEffect(() => {
    offRef.current = off;
  });
  const posRef = useRef<Map<string, { x: number; y: number; w: number }>>(new Map());
  const gesture = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; x: number; y: number } | null>(null);

  // đọc localStorage sau hydrate để server và client render giống nhau
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOff(readOffsets(offKey)), [offKey]);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number; w: number }>();
    for (const it of layout.items) {
      const o = free ? off[it.id] : undefined;
      m.set(it.id, { x: Math.max(0, it.x + (o?.x ?? 0)), y: Math.max(0, it.y + (o?.y ?? 0)), w: it.w });
    }
    return m;
  }, [layout, off, free]);
  useLayoutEffect(() => {
    posRef.current = pos;
  });

  useLayoutEffect(() => {
    registry.clear();
    for (const it of layout.items) {
      const p = pos.get(it.id);
      if (it.page !== undefined && p) registry.set(it.page, { x: p.x + NW / 2, y: p.y + NH / 2 });
    }
    return () => registry.clear();
  }, [layout, pos]);

  const commit = useCallback(
    (id: string, x: number, y: number) => {
      const rects = layout.items.map((it) => {
        const p = posRef.current.get(it.id)!;
        return { id: it.id, x: it.id === id ? x : p.x, y: it.id === id ? y : p.y, w: it.w, h: NH + CAP };
      });
      // +2: viền node dày đến 1,5 px, để khoảng trống nhìn thấy vẫn đủ MIN_GAP
      const s = settle(rects, id, MIN_GAP + 2);
      const it = layout.items.find((i) => i.id === id)!;
      const next = { ...offRef.current, [id]: { x: s.x - it.x, y: s.y - it.y } };
      setOff(next);
      store.set(offKey, JSON.stringify(next));
    },
    [layout, offKey],
  );

  const onDown = useCallback((e: React.PointerEvent, id: string) => {
    if (e.button > 0) return;
    const o = offRef.current[id] ?? { x: 0, y: 0 };
    gesture.current = { id, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, x: o.x, y: o.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag(id);
  }, []);

  const base = (id: string) => layout.items.find((i) => i.id === id)!;
  const scroller = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  // Ở "Kéo tự do" cảm ứng không cuộn gốc được (touch-action: none), nên kéo nền để cuộn.
  const panDown = (e: React.PointerEvent) => {
    const sc = scroller.current;
    if (!free || !sc || (e.target as Element).closest("[data-page],[data-hidden-level]")) return;
    pan.current = { x: e.clientX, y: e.clientY, l: sc.scrollLeft, t: sc.scrollTop };
    sc.setPointerCapture(e.pointerId);
  };
  const panMove = (e: React.PointerEvent) => {
    const p = pan.current;
    const sc = scroller.current;
    if (!p || !sc) return;
    sc.scrollLeft = p.l - (e.clientX - p.x);
    sc.scrollTop = p.t - (e.clientY - p.y);
  };
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const b = base(g.id);
    const dx = Math.max(-b.x, g.ox + e.clientX - g.sx);
    const dy = Math.max(-b.y, g.oy + e.clientY - g.sy);
    g.x = dx;
    g.y = dy;
    setOff({ ...offRef.current, [g.id]: { x: dx, y: dy } });
  };
  const onUp = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setDrag(null);
    // dùng vị trí cuối của cử chỉ, không đọc state vì lần render cuối có thể chưa chạy
    const b = base(g.id);
    commit(g.id, b.x + g.x, b.y + g.y);
  };

  const onKey = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      const d = e.shiftKey ? STEP * 4 : STEP;
      const mv = ({ ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] } as Record<string, number[]>)[e.key];
      if (!mv) return;
      e.preventDefault();
      const p = posRef.current.get(id)!;
      commit(id, Math.max(0, p.x + mv[0]), Math.max(0, p.y + mv[1]));
    },
    [commit],
  );

  // Trang sâu nhất trên đường đi; nếu nó bị ẩn thì nhìn vào khối hidden của tầng đó.
  const lastOnPath = pathPages.length ? pathPages[pathPages.length - 1] : model.rootPage;
  const focusId = byPage.has(lastOnPath) ? `p${lastOnPath}` : `h${Math.max(0, model.height - pathPages.length)}`;
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const ids = new Set(pathItemIds(layout.items, model.height, alignPages ?? []));
    const on = layout.items.filter((i) => ids.has(i.id));
    if (on.length) {
      // đường đi đã nằm trong một cột: cuộn tới giữa cột, và về đầu trang theo chiều dọc
      const lo = Math.min(...on.map((i) => i.x));
      const hi = Math.max(...on.map((i) => i.x + i.w));
      sc.scrollLeft = Math.max(0, (lo + hi) / 2 - sc.clientWidth / 2);
      sc.scrollTop = 0;
      return;
    }
    const it = layout.items.find((i) => i.id === focusId) ?? layout.items.find((i) => i.page === model.rootPage);
    if (it) sc.scrollLeft = Math.max(0, it.x + it.w / 2 - sc.clientWidth / 2);
  }, [layout, focusId, model.rootPage, model.height, alignPages]);

  const pick = (m: Mode) => {
    store.set(MODE_KEY, m);
    onModeChange(m);
  };
  const reset = () => {
    setOff({});
    store.set(offKey, "{}");
  };

  let w = layout.width;
  let h = layout.height;
  for (const [id, p] of pos) {
    const it = base(id);
    w = Math.max(w, p.x + it.w + PAD);
    h = Math.max(h, p.y + NH + CAP + PAD);
  }

  const lit = new Set(pathPages.map((p) => `p${p}`));
  const levels = model.height;
  // trang trên đường đi không có trong nodes: tô khối hidden của đúng tầng
  pathPages.forEach((p, i) => {
    if (!byPage.has(p)) lit.add(`h${levels - 1 - i}`);
  });
  const laneName = (level: number) => (levels === 1 ? "laneSingle" : level === levels - 1 ? "laneRoot" : level === 0 ? "laneLeaf" : "laneInternal");
  const keyList = (n: BTreeNode) => n.keys.map((k) => (k === "" ? NEG_INF : k)).join(", ");
  const summary =
    t("summary", { levels, pages: model.totalPages, shown: model.nodes.length }) +
    (path ? " " + t("summaryPath", { key: path.key, pages: pathPages.join(" → ") }) : "");
  const center = (id: string) => {
    const p = pos.get(id)!;
    return { x: p.x + base(id).w / 2, top: p.y, bottom: p.y + NH + (base(id).page === undefined ? 0 : CAP), left: p.x, right: p.x + base(id).w, cy: p.y + NH / 2 };
  };

  return (
    <section
      aria-label={t("region")}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-stage"
      data-testid="btree-view"
      data-mode={mode}
      data-dimmed={dimmed ? "true" : undefined}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-[var(--edge)] py-2">
        <h3 className="m-0 w-full min-w-0 truncate sm:w-auto sm:flex-1 font-mono text-[12.5px] font-normal text-ink2" title={t("title", { index: model.index, table: model.table, columns: model.columns.join(", ") })}>
          {t("title", { index: model.index, table: model.table, columns: model.columns.join(", ") })}
        </h3>
        <Badge label={label} text={t(`label.${label}`)} tooltip={t(`labelTooltip.${label}`)} />
        <div role="group" aria-label={t("mode.label")} className="flex">
          {(["fixed", "free"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => pick(m)}
              className={`h-8 px-3 text-xs ${mode === m ? "text-white" : "text-dim hover:text-white"}`}
            >
              <span className={`inline-block pb-0.5 ${mode === m ? "border-b border-lamp" : "border-b border-transparent"}`}>{t(`mode.${m}`)}</span>
            </button>
          ))}
        </div>
        {free && (
          <button type="button" onClick={reset} className="h-8 rounded-[4px] border border-control px-3 text-xs text-white hover:bg-muted">
            {t("reset")}
          </button>
        )}
      </div>
      {dimmed && dimReason && (
        <div
          data-testid="btree-dimmed-notice"
          className="mx-[var(--edge)] my-1 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200"
        >
          {dimReason}
        </div>
      )}
      <p className="sr-only" id="btree-summary" data-testid="btree-summary">
        {summary}
      </p>
      <div
        tabIndex={0}
        role="region"
        aria-label={t("scroll")}
        data-testid="btree-scroll"
        ref={scroller}
        className={`min-h-[200px] min-w-0 flex-1 overflow-auto ${free ? "cursor-grab" : ""}`}
        onPointerDown={panDown}
        onPointerMove={panMove}
        onPointerUp={() => (pan.current = null)}
        onPointerCancel={() => (pan.current = null)}
        style={
          free
            ? {
                touchAction: "none",
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Ccircle cx='1' cy='1' r='1' fill='%2334343a'/%3E%3C/svg%3E\")",
                backgroundAttachment: "local",
              }
            : undefined
        }
      >
        <svg
          width={w}
          height={h}
          role="group"
          aria-label={t("title", { index: model.index, table: model.table, columns: model.columns.join(", ") })}
          aria-describedby="btree-summary"
          data-testid="btree-svg"
          data-dimmed={dimmed ? "true" : undefined}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          style={{ display: "block", touchAction: free ? "none" : undefined }}
        >
          {Array.from({ length: levels }, (_, r) => (
            <text key={r} x={PAD} y={PAD + r * 80 + 20} className="fill-dim" style={{ font: "12px var(--sans)" }}>
              {t(laneName(levels - 1 - r))}
            </text>
          ))}
          <g fill="none" data-dimmed={dimmed ? "true" : undefined} style={dimmed ? { opacity: 0.22 } : undefined}>
            {layout.edges.map((e, i) => {
              const a = center(e.from);
              const b = center(e.to);
              let d: string;
              if (e.kind === "next") d = b.left >= a.right ? `M${a.right} ${a.cy}L${b.left} ${b.cy}` : `M${a.left} ${a.cy}L${b.right} ${b.cy}`;
              else {
                const my = (a.bottom + b.top) / 2;
                d = `M${a.x} ${a.bottom}C${a.x} ${my} ${b.x} ${my} ${b.x} ${b.top}`;
              }
              const on = e.lit;
              return <path key={i} d={d} className={on ? "stroke-lamp" : "stroke-control"} strokeWidth={on ? 1.5 : 1} data-edge={e.kind} data-from={e.from} data-to={e.to} data-lit={on || undefined} data-dimmed={dimmed ? "true" : undefined} />;
            })}
          </g>
          <g data-dimmed={dimmed ? "true" : undefined} style={dimmed ? { opacity: 0.22 } : undefined}>
            {layout.items.map((it) => {
              const p = pos.get(it.id)!;
              const n = it.page === undefined ? undefined : byPage.get(it.page);
              const hidden = it.page === undefined;
              const text = hidden ? t("hidden", { count: it.count ?? 0 }) : "";
              return (
                <NodeG
                  key={it.id}
                  item={it}
                  x={p.x}
                  y={p.y}
                  node={n}
                  lit={lit.has(it.id)}
                  free={free}
                  dimmed={dimmed}
                  dragging={drag === it.id}
                  title={n ? t("nodeTitle", { page: n.page, total: n.totalKeys, keys: keyList(n) }) : text}
                  caption={n ? t("pageCaption", { page: n.page, total: n.totalKeys }) : text}
                  aria={n ? t("moveAria", { name: t("pageName", { page: n.page }) }) : t("moveAria", { name: text })}
                  onDown={onDown}
                  onKey={onKey}
                />
              );
            })}
          </g>
        </svg>
      </div>
      {free && <p className="m-0 px-[var(--edge)] py-2 text-[13px] leading-[18px] text-ink2">{t("freeHint")}</p>}
    </section>
  );
}
