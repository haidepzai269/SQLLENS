"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BTreeModel, BTreePath } from "@/contracts/btree";
import type { EvidenceLabel } from "@/contracts/conclusion";
import { Button } from "@/components/ui/button";
import { usePrefersReducedMotion } from "@/lib/reduced-motion";
import { CAP, NH, NW } from "../view/layout";
import { BTreeView, nodePosition, readStoredMode } from "../view/btree-view";
import { buildSteps, rangeError } from "./steps";

gsap.registerPlugin(useGSAP);

const MOVE = 0.9; // giây mỗi bước di chuyển
const HOLD = 0.5; // giây dừng giữa hai bước
const HEAP_W = 120;
const HEAP_GAP = 24;
const HEAP_BAND = HEAP_GAP + NH + 16;
const MARKER_H = 20;
const LIFT = 4; // key nằm hơi cao hơn mép trên node để không che chữ trong ô khóa
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const reached = (p: number) => Math.floor(p + 1e-6);
type Actions = { to: (time: number, jump?: boolean) => void; run: () => void; pause: () => void };
const noop = () => {};
type Box = { x: number; y: number; w: number; cap: number };

function Scene({
  model,
  path,
  label,
  to,
  dimmed,
  dimReason,
}: {
  model: BTreeModel;
  path?: BTreePath;
  label: EvidenceLabel;
  to?: string;
  dimmed?: boolean;
  dimReason?: string;
}) {
  const t = useTranslations("btree-anim");
  const tb = useTranslations("btree");
  const isCovering = !!(path?.isCovering || model.isCovering);
  const isDual = !!(model.clusteredIndex && !isCovering);

  const steps = useMemo(() => (!dimmed && path && path.pages.length ? buildSteps(model, path, to) : []), [dimmed, model, path, to]);
  const err = !dimmed && path && path.pages.length ? rangeError(model, path, to) : undefined;
  const S = steps.length;
  const hasHeap = path?.heapPage !== undefined;
  const reduced = usePrefersReducedMotion();
  const move = reduced ? 0 : MOVE; // giảm chuyển động: nhảy ngay với duration = 0
  const seg = move + (reduced ? 0 : HOLD);
  const at = (k: number) => (k <= 0 ? 0 : (k - 1) * seg + move); // thời điểm timeline khi key tới bước k

  const [mode, setMode] = useState<"fixed" | "free">("fixed");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc localStorage sau hydrate
  useEffect(() => setMode(readStoredMode()), []);

  const wrap = useRef<HTMLDivElement>(null);
  const [hostReady1, setHost1] = useState<HTMLElement | null>(null);
  const [hostReady2, setHost2] = useState<HTMLElement | null>(null);
  const hostRef1 = useRef<HTMLElement | null>(null);
  const hostRef2 = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    // lấy vùng cuộn của BTreeView sau khi nó vẽ
    const scrolls = wrap.current?.querySelectorAll<HTMLElement>('[data-testid="btree-scroll"]');
    if (scrolls && scrolls.length > 0) {
      hostRef1.current = scrolls[0];
      setHost1(hostRef1.current);
      if (scrolls.length > 1) {
        hostRef2.current = scrolls[1];
        setHost2(hostRef2.current);
      }
    }
  }, [isDual]);

  const view1 = useMemo(
    () => <BTreeView model={model} label={label} mode={mode} onModeChange={setMode} align={path?.pages} dimmed={dimmed} dimReason={dimReason} />,
    [model, label, mode, path, dimmed, dimReason],
  );

  const view2 = useMemo(
    () =>
      model.clusteredIndex ? (
        <BTreeView
          model={model.clusteredIndex}
          label={label}
          mode={mode}
          onModeChange={setMode}
          align={path?.lookupPages}
          dimmed={dimmed}
          dimReason={dimReason}
        />
      ) : null,
    [model.clusteredIndex, label, mode, path, dimmed, dimReason],
  );

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const ov1 = useRef<SVGSVGElement>(null);
  const ov2 = useRef<SVGSVGElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const proxy = useRef({ p: 0 });
  const stepRef = useRef(0);

  const secCount = path?.pages.length ?? 0;

  const act = useRef<Actions>({ to: noop, run: noop, pause: noop });
  useGSAP(
    (_, contextSafe) => {
      const host1 = hostRef1.current;
      if (!host1 || !S || !path || dimmed) return;
      const host2 = hostRef2.current;

      const px = proxy.current;
      px.p = 0;
      const eases = steps.map((s) => gsap.parseEase(s.heap ? "back.in" : "power2.in")); // trọng lực; heap lùi lấy đà rồi lao
      const prevPosition1 = host1.style.position;
      host1.style.position = "relative";
      let prevPosition2: string | undefined;
      if (host2) {
        prevPosition2 = host2.style.position;
        host2.style.position = "relative";
      }

      const rect = (j: number): Box | null => {
        const st = steps[j];
        if (!st.heap) {
          const c = nodePosition(st.page);
          if (c) return { x: c.x - NW / 2, y: c.y - NH / 2, w: NW, cap: CAP };
          if (st.slide) return null; // leaf trượt sang luôn nằm trong model; không thấy thì không vẽ

          const host = st.isClustered && host2 ? host2 : host1;
          const svg = host.querySelector<SVGSVGElement>('[data-testid="btree-svg"]');
          const height = st.isClustered && model.clusteredIndex ? model.clusteredIndex.height : model.height;
          const g = svg?.querySelector(`g[data-hidden-level="${Math.max(0, height - 1 - (st.isClustered ? j - secCount : j))}"]`);
          const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g?.getAttribute("transform") ?? "");
          const w = Number(g?.querySelector("rect")?.getAttribute("width"));
          return m && w ? { x: +m[1], y: +m[2], w, cap: 0 } : null;
        }
        const leaf = rect(st.src);
        if (!leaf) return null;
        const cx = leaf.cap ? leaf.x + leaf.w - 30 : leaf.x + leaf.w / 2; // lệch phải để dây nối không cắt chú thích của leaf
        return { x: cx - HEAP_W / 2, y: leaf.y + NH + leaf.cap + HEAP_GAP, w: HEAP_W, cap: 0 };
      };

      const set = (el: Element | null, a: Record<string, string | number | null>) => {
        for (const [k, v] of Object.entries(a)) {
          if (v === null) el?.removeAttribute(k);
          else el?.setAttribute(k, String(v));
        }
      };

      // Mọi thứ vẽ ra đều suy từ px.p (vị trí timeline) và vị trí node hiện tại, không giữ trạng thái riêng.
      const render = (follow: boolean) => {
        const p = px.p;
        const o1 = ov1.current;
        const o2 = ov2.current;

        const svg1 = host1.querySelector<SVGSVGElement>('[data-testid="btree-svg"]');
        if (o1 && svg1) {
          set(o1, { width: svg1.getAttribute("width"), height: Number(svg1.getAttribute("height")) + (hasHeap ? HEAP_BAND : 0) });
        }

        const svg2 = host2?.querySelector<SVGSVGElement>('[data-testid="btree-svg"]');
        if (o2 && svg2) {
          set(o2, { width: svg2.getAttribute("width"), height: svg2.getAttribute("height") });
        }

        const boxes = steps.map((_, j) => rect(j));

        steps.forEach((s, j) => {
          const b = boxes[j];
          const f = clamp(eases[j](clamp(p - j)));
          const lit = p >= j + 1 - 1e-6 ? "true" : null;
          const a = boxes[s.src];
          const o = s.isClustered ? o2 : o1;
          if (!o) return;

          const q = <T extends Element>(sel: string) => o.querySelector<T>(sel);

          if (b && a && s.src >= 0 && (!s.isClustered || steps[s.src].isClustered)) {
            const bx = b.x + b.w / 2;
            const ax = s.heap ? bx : a.x + a.w / 2;
            const slide = s.slide ? `M${a.x + a.w} ${a.y + NH / 2}L${b.x} ${b.y + NH / 2}` : null;
            const ay = a.y + NH + a.cap;
            const my = (ay + b.y) / 2;
            set(q(`[data-edge="${j}"]`), {
              d: slide ?? (s.heap ? `M${ax} ${ay}L${bx} ${b.y}` : `M${ax} ${ay}C${ax} ${my} ${bx} ${my} ${bx} ${b.y}`),
              "stroke-dashoffset": 1 - f,
              "data-lit": lit,
            });
          }

          if (s.heap) {
            if (b) q("[data-heap]")?.setAttribute("transform", `translate(${b.x} ${b.y})`);
            const r = q<SVGElement>("[data-heap-lit]");
            set(r, { "data-lit": lit });
            r?.style.setProperty("opacity", String(f));
          } else {
            const r = q<SVGElement>(`[data-node="${j}"]`);
            if (b) set(r, { x: b.x, y: b.y, width: b.w, height: NH });
            set(r, { "data-lit": lit });
            r?.style.setProperty("opacity", String(f));
          }
        });

        // Viên bi di chuyển:
        const j = clamp(Math.ceil(p) - 1, 0, S - 1);
        const end = boxes[j];
        const prev = boxes[steps[j].src];
        const isClusteredStep = steps[j].isClustered;

        const keyEl1 = o1?.querySelector<SVGElement>("[data-key]");
        const keyEl2 = o2?.querySelector<SVGElement>("[data-key]");

        if (p <= 0 || !end) {
          keyEl1?.style.setProperty("opacity", "0");
          keyEl2?.style.setProperty("opacity", "0");
        } else if (isClusteredStep) {
          // Giai đoạn 2: viên bi nằm trên cây Clustered Index (Tree 2)
          keyEl1?.style.setProperty("opacity", "0");
          if (keyEl2) {
            const u = eases[j](clamp(p - j));
            const ex = end.x + end.w / 2;
            const sx = prev && steps[steps[j].src].isClustered ? prev.x + prev.w / 2 : ex;
            const sy = prev && steps[steps[j].src].isClustered ? prev.y : Math.max(MARKER_H / 2, end.y - 28);
            const x = sx + (ex - sx) * u;
            const y = sy + (end.y - sy) * u;
            keyEl2.setAttribute("transform", `translate(${x} ${y - LIFT})`);
            keyEl2.style.setProperty("opacity", "1");
            if (follow && host2) {
              if (x < host2.scrollLeft + 40 || x > host2.scrollLeft + host2.clientWidth - 40) host2.scrollLeft = Math.max(0, x - host2.clientWidth / 2);
              if (y < host2.scrollTop + 20 || y > host2.scrollTop + host2.clientHeight - 20) host2.scrollTop = Math.max(0, y - host2.clientHeight / 2);
            }
          }
        } else {
          // Giai đoạn 1: viên bi nằm trên cây Secondary Index (Tree 1)
          keyEl2?.style.setProperty("opacity", "0");
          if (keyEl1) {
            const u = eases[j](clamp(p - j));
            const ex = end.x + end.w / 2;
            const sx = prev ? prev.x + prev.w / 2 : ex;
            const sy = prev ? prev.y : Math.max(MARKER_H / 2, end.y - 28);
            const x = sx + (ex - sx) * u;
            const y = sy + (end.y - sy) * u;
            keyEl1.setAttribute("transform", `translate(${x} ${y - LIFT})`);
            keyEl1.style.setProperty("opacity", String(j === 0 ? Math.min(1, (p - j) * 4) : 1));
            if (follow) {
              if (x < host1.scrollLeft + 40 || x > host1.scrollLeft + host1.clientWidth - 40) host1.scrollLeft = Math.max(0, x - host1.clientWidth / 2);
              if (y < host1.scrollTop + 20 || y > host1.scrollTop + host1.clientHeight - 20) host1.scrollTop = Math.max(0, y - host1.clientHeight / 2);
            }
          }
        }

        const k = reached(p);
        if (k !== stepRef.current) setStep((stepRef.current = k));
        if (range.current && follow) range.current.value = String(tl.time());
      };

      const tl = gsap.timeline({ paused: true, onUpdate: () => render(true), onComplete: () => setPlaying(false) });
      for (let k = 1; k <= S; k++) tl.to(px, { p: k, duration: move, ease: "none" }, (k - 1) * seg);

      act.current = {
        to: contextSafe!((time: number, jump = false) => {
          gsap.killTweensOf(tl);
          tl.pause();
          setPlaying(false);
          if (jump || reduced) tl.time(time, false);
          else tl.tweenTo(time, { ease: "none", duration: Math.min(Math.abs(tl.time() - time), seg) || 0.001 });
        }),
        run: contextSafe!(() => {
          gsap.killTweensOf(tl);
          if (reduced) {
            tl.progress(1);
            setPlaying(false);
            return;
          }
          if (tl.progress() >= 1) tl.restart();
          else tl.play();
          setPlaying(true);
        }),
        pause: contextSafe!(() => {
          tl.pause();
          setPlaying(false);
        }),
      };

      if (range.current) range.current.max = String(tl.duration());
      tl.time(at(stepRef.current));
      render(false);

      const mo = new MutationObserver(() => render(false));
      const svg1 = host1.querySelector<SVGSVGElement>('[data-testid="btree-svg"]');
      if (svg1) mo.observe(svg1, { attributes: true, attributeFilter: ["transform", "width", "height"], subtree: true, childList: true });
      if (host2) {
        const svg2 = host2.querySelector<SVGSVGElement>('[data-testid="btree-svg"]');
        if (svg2) mo.observe(svg2, { attributes: true, attributeFilter: ["transform", "width", "height"], subtree: true, childList: true });
      }

      return () => {
        mo.disconnect();
        tl.kill();
        host1.style.position = prevPosition1;
        if (host2 && prevPosition2 !== undefined) host2.style.position = prevPosition2;
      };
    },
    { dependencies: [hostReady1, hostReady2, steps, reduced, dimmed, isDual], scope: wrap, revertOnUpdate: true },
  );

  const next = () => act.current.to(at(Math.min(S, reached(proxy.current.p) + 1)));
  const back = () => {
    const p = proxy.current.p;
    act.current.to(at(p > reached(p) + 1e-6 ? reached(p) : Math.max(0, reached(p) - 1)));
  };

  const cur = step > 0 ? steps[step - 1] : null;
  const say = (s: (typeof steps)[number]) => t(`step.${s.msg}`, { ...s.vals, n: s.n, page: s.page, kind: t(`kind.${s.kind}`) });
  const endStep = steps.find((s) => s.end);
  const leaves = steps.filter((s) => !s.heap && s.kind !== "root" && s.kind !== "internal").length;

  const key = path?.key ?? "";
  const shortKey = key.length > 14 ? `${key.slice(0, 13)}…` : key;
  const markerW = Math.max(32, shortKey.length * 7.6 + 16);

  const lookupKey = path?.lookupKey ?? "";
  const shortLookupKey = lookupKey.length > 14 ? `${lookupKey.slice(0, 13)}…` : lookupKey;
  const markerW2 = Math.max(32, shortLookupKey.length * 7.6 + 16);

  const counter = t("counter", { read: step, total: S });

  return (
    <div
      ref={wrap}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="btree-drop"
      data-step={step}
      data-dimmed={dimmed ? "true" : undefined}
      data-playing={playing || undefined}
    >
      {/* Badge Covering Index hoặc Bookmark Lookup */}
      {isCovering ? (
        <div className="flex items-center gap-2 border-b border-emerald-500/30 bg-emerald-950/40 px-[var(--edge)] py-1.5" data-testid="covering-badge">
          <span className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {tb("coveringBadge")}
          </span>
        </div>
      ) : isDual ? (
        <div className="flex items-center gap-2 border-b border-blue-500/30 bg-blue-950/40 px-[var(--edge)] py-1.5" data-testid="bookmark-badge">
          <span className="inline-flex items-center gap-1.5 rounded border border-blue-500/40 bg-blue-500/20 px-2 py-0.5 text-xs font-semibold text-blue-300">
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            {tb("bookmarkBadge")}
          </span>
        </div>
      ) : null}

      {/* Vùng hiển thị cây (1 cây thông thường hoặc 2 cây Bookmark Lookup) */}
      {isDual ? (
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 p-2 lg:grid-cols-2">
          {/* Cây 1: Secondary Index */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded border border-control/70 bg-stage">
            <div className="border-b border-control/70 bg-surface/60 px-3 py-1.5 font-mono text-xs font-medium text-ink2">
              {tb("secondaryIndex")}: {model.index} ({model.columns.join(", ")})
            </div>
            {view1}
          </div>

          {/* Cây 2: Clustered Index (PRIMARY) */}
          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col rounded border transition-colors ${
              cur?.isClustered ? "border-lamp/80 bg-lamp/5" : "border-control/70 bg-stage"
            }`}
            data-testid="clustered-tree-container"
          >
            <div className="border-b border-control/70 bg-surface/60 px-3 py-1.5 font-mono text-xs font-medium text-ink2">
              {tb("clusteredIndex")}: {model.clusteredIndex!.index} (PRIMARY)
            </div>
            {view2}
          </div>
        </div>
      ) : (
        view1
      )}

      {/* Overlay cây 1 */}
      {hostReady1 &&
        S > 0 &&
        !dimmed &&
        createPortal(
          <svg
            ref={ov1}
            aria-hidden="true"
            data-testid="btree-drop-layer"
            style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}
          >
            {steps
              .slice(0, isDual ? secCount : S)
              .map((s, j) =>
                s.src >= 0 && !s.isClustered ? (
                  <path
                    key={`e${j}`}
                    data-edge={j}
                    fill="none"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                    className="stroke-lamp"
                    strokeWidth={1.5}
                  />
                ) : null,
              )}
            {hasHeap && (
              <g data-heap="">
                <rect width={HEAP_W} height={NH} rx={2} strokeDasharray="3 3" className="fill-stage stroke-control" />
                <text x={HEAP_W / 2} y={20} textAnchor="middle" className="fill-ink2" style={{ font: "12.5px var(--mono)" }}>
                  {t("heapName", { page: path?.heapPage ?? 0 })}
                </text>
                <rect data-heap-lit="" width={HEAP_W} height={NH} rx={2} fill="none" className="stroke-lamp" strokeWidth={1.5} style={{ opacity: 0 }} />
              </g>
            )}
            {steps.slice(0, isDual ? secCount : S).map((s, j) => (s.heap || s.isClustered ? null : <rect key={`n${j}`} data-node={j} rx={2} fill="none" className="stroke-lamp" strokeWidth={1.5} style={{ opacity: 0 }} />))}
            <g data-key="" style={{ opacity: 0 }}>
              <title>{t("keyTitle", { key })}</title>
              <rect x={-markerW / 2} y={-MARKER_H / 2} width={markerW} height={MARKER_H} rx={3} className="fill-lamp" />
              <text y={4.5} textAnchor="middle" className="fill-lamp-ink" style={{ font: "12.5px var(--mono)" }}>
                {shortKey}
              </text>
            </g>
          </svg>,
          hostReady1,
        )}

      {/* Overlay cây 2 (Clustered Index Bookmark Lookup) */}
      {hostReady2 &&
        isDual &&
        !dimmed &&
        createPortal(
          <svg
            ref={ov2}
            aria-hidden="true"
            data-testid="btree-drop-layer-clustered"
            style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}
          >
            {steps.slice(secCount).map((s, idx) => {
              const j = secCount + idx;
              return s.src >= 0 && s.isClustered && steps[s.src].isClustered ? (
                <path
                  key={`e${j}`}
                  data-edge={j}
                  fill="none"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1}
                  className="stroke-lamp"
                  strokeWidth={1.5}
                />
              ) : null;
            })}
            {steps.slice(secCount).map((s, idx) => {
              const j = secCount + idx;
              return <rect key={`n${j}`} data-node={j} rx={2} fill="none" className="stroke-lamp" strokeWidth={1.5} style={{ opacity: 0 }} />;
            })}
            <g data-key="" style={{ opacity: 0 }}>
              <title>{t("keyTitle", { key: lookupKey })}</title>
              <rect x={-markerW2 / 2} y={-MARKER_H / 2} width={markerW2} height={MARKER_H} rx={3} className="fill-lamp" />
              <text y={4.5} textAnchor="middle" className="fill-lamp-ink" style={{ font: "12.5px var(--mono)" }}>
                {shortLookupKey}
              </text>
            </g>
          </svg>,
          hostReady2,
        )}

      {/* Bảng điều khiển timeline bên dưới */}
      <div className="sticky bottom-0 z-10 shrink-0 border-t border-control bg-stage px-[var(--edge)] py-2" data-testid="btree-drop-panel">
        {dimmed ? (
          <div className="flex flex-col gap-2">
            <p role="status" aria-live="polite" className="m-0 text-[13px] font-medium leading-[18px] text-amber-400" data-testid="drop-dimmed-explain" data-dimmed="true">
              {dimReason ?? t("dimReason")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled>
                {t("run")}
              </Button>
              <Button type="button" variant="outline" disabled>
                {t("pause")}
              </Button>
              <Button type="button" variant="outline" disabled>
                {t("back")}
              </Button>
              <Button type="button" variant="outline" disabled>
                {t("next")}
              </Button>
              <Button type="button" variant="outline" disabled>
                {t("reset")}
              </Button>
            </div>
            <input
              ref={range}
              type="range"
              disabled
              min={0}
              max={1}
              defaultValue={0}
              aria-label={t("scrub")}
              data-testid="drop-scrub"
              className="my-2 block h-6 w-full cursor-not-allowed opacity-40 accent-[var(--lamp)]"
            />
            <p aria-live="polite" className="m-0 text-[13px] leading-[18px] text-ink2" data-testid="drop-explain">
              {dimReason ?? t("dimReason")}
            </p>
          </div>
        ) : S === 0 ? (
          <p role="status" className="m-0 text-[13px] leading-[18px] text-ink2" data-testid="drop-no-path">
            {err ? t(`rangeError.${err}`) : to !== undefined ? t("noPathRange") : t("noPath")}
          </p>
        ) : (
          <>
            <p className="sr-only" data-testid="drop-summary">
              {to !== undefined
                ? t("summaryRange", { key, to, pages: steps.filter((s) => !s.heap).map((s) => s.page).join(" → ") })
                : isDual
                  ? t("summaryBookmark", {
                      key,
                      pages: path!.pages.join(" → "),
                      lookupPages: path!.lookupPages!.join(" → "),
                      lookupKey: path!.lookupKey ?? "",
                    })
                  : t(hasHeap ? "summaryHeap" : "summary", { key, pages: path!.pages.join(" → "), heap: path!.heapPage ?? 0 })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => act.current.run()} disabled={playing}>
                {step >= S ? t("runAgain") : t("run")}
              </Button>
              <Button type="button" variant="outline" onClick={() => act.current.pause()} disabled={!playing}>
                {t("pause")}
              </Button>
              <Button type="button" variant="outline" onClick={back}>
                {t("back")}
              </Button>
              <Button type="button" variant="outline" onClick={next} disabled={step >= S}>
                {t("next")}
              </Button>
              <Button type="button" variant="outline" onClick={() => act.current.to(0, true)}>
                {t("reset")}
              </Button>
              <span className="ml-auto text-[13px] text-ink2" data-testid="drop-counter">
                {counter}
              </span>
            </div>
            <input
              ref={range}
              type="range"
              min={0}
              max={at(S)}
              step={0.01}
              defaultValue={0}
              aria-label={t("scrub")}
              aria-valuetext={counter}
              data-testid="drop-scrub"
              onInput={(e) => act.current.to(Number(e.currentTarget.value), true)}
              className="my-2 block h-6 w-full accent-[var(--lamp)]"
            />
            <p aria-live="polite" className="m-0 text-[13px] leading-[18px] text-ink2" data-testid="drop-explain">
              {cur ? say(cur) : t(to !== undefined ? "idleRange" : "idle", { key, to: to ?? "" })}
            </p>
            {endStep?.end && step >= endStep.n && (
              <p className="m-0 mt-1 text-[13px] leading-[18px] text-ink2" data-testid="drop-range-end" data-end={endStep.end}>
                {t(`end.${endStep.end}`, { leaves, to: to ?? "" })}
              </p>
            )}
            {reduced && (
              <p className="m-0 mt-1 text-[13px] leading-[18px] text-dim" data-testid="drop-reduced">
                {t("reducedNote")}
              </p>
            )}
            <details className="mt-1 text-[13px] text-dim">
              <summary className="cursor-pointer">{t("log")}</summary>
              <ol className="m-0 pl-5" data-testid="drop-log">
                {steps.slice(0, step).map((s) => (
                  <li key={s.n}>{say(s)}</li>
                ))}
              </ol>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

// path chỉ là gợi ý của engine: không có thì cây vẫn vẽ, animation không chạy và không vẽ đường đi đoán.
export function BTreeDrop({
  model,
  path,
  label,
  to,
  dimmed,
  dimReason,
}: {
  model: BTreeModel;
  path?: BTreePath;
  label: EvidenceLabel;
  to?: string;
  dimmed?: boolean;
  dimReason?: string;
}) {
  const sig = `${model.engine}:${model.index}:${path?.key}:${path?.pages.join(",")}:${path?.heapPage}:${path?.lookupKey}:${path?.lookupPages?.join(",")}:${to}:${dimmed ? "1" : "0"}:${path?.isCovering ? "1" : "0"}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- giữ path ổn định theo nội dung, tránh dựng lại timeline khi cha tạo object mới
  const stable = useMemo(() => path, [sig]);
  return <Scene key={sig} model={model} path={stable} label={label} to={to} dimmed={dimmed} dimReason={dimReason} />;
}
