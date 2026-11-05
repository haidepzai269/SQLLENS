"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { BTreeModel, BTreePath } from "@/contracts/btree";
import type { EvidenceLabel } from "@/contracts/conclusion";
import { Button } from "@/components/ui/button";
import { CAP, NH, NW } from "../view/layout";
import { BTreeView, nodePosition, readStoredMode } from "../view/btree-view";
import { buildSteps, rangeError } from "./steps";

gsap.registerPlugin(useGSAP);

const MOVE = 0.9; // giây mỗi bước di chuyển
const HOLD = 0.5; // giây dừng giữa hai bước
const QUERY = "(prefers-reduced-motion: reduce)";
const HEAP_W = 120;
const HEAP_GAP = 24;
const HEAP_BAND = HEAP_GAP + NH + 16;
const MARKER_H = 20;
const LIFT = 4; // key nằm hơi cao hơn mép trên node để không che chữ trong ô khóa

const subscribeReduced = (cb: () => void) => {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const reached = (p: number) => Math.floor(p + 1e-6);
type Actions = { to: (time: number, jump?: boolean) => void; run: () => void; pause: () => void };
const noop = () => {};
type Box = { x: number; y: number; w: number; cap: number };

function Scene({ model, path, label, to }: { model: BTreeModel; path?: BTreePath; label: EvidenceLabel; to?: string }) {
  const t = useTranslations("btree-anim");
  const steps = useMemo(() => (path && path.pages.length ? buildSteps(model, path, to) : []), [model, path, to]);
  const err = path && path.pages.length ? rangeError(model, path, to) : undefined;
  const S = steps.length;
  const hasHeap = path?.heapPage !== undefined;
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(QUERY).matches, () => false);
  const move = reduced ? 0.001 : MOVE; // giảm chuyển động: nhảy ngay, vẫn là cùng một timeline
  const seg = move + (reduced ? 1.2 : HOLD);
  const at = (k: number) => (k <= 0 ? 0 : (k - 1) * seg + move); // thời điểm timeline khi key tới bước k

  const [mode, setMode] = useState<"fixed" | "free">("fixed");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc localStorage sau hydrate
  useEffect(() => setMode(readStoredMode()), []);
  const wrap = useRef<HTMLDivElement>(null);
  const [hostReady, setHost] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // lấy vùng cuộn của BTreeView sau khi nó vẽ
    hostRef.current = wrap.current?.querySelector<HTMLElement>('[data-testid="btree-scroll"]') ?? null;
    setHost(hostRef.current);
  }, []);
  const view = useMemo(() => <BTreeView model={model} label={label} mode={mode} onModeChange={setMode} align={path?.pages} />, [model, label, mode, path]);

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const ov = useRef<SVGSVGElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const proxy = useRef({ p: 0 });
  const stepRef = useRef(0);

  const act = useRef<Actions>({ to: noop, run: noop, pause: noop });
  useGSAP(
    (_, contextSafe) => {
      const host = hostRef.current;
      if (!host || !S || !path || !ov.current) return;
      const o = ov.current;
      const svg = host.querySelector<SVGSVGElement>('[data-testid="btree-svg"]');
      if (!svg) return;
      const px = proxy.current;
      px.p = 0;
      const eases = steps.map((s) => gsap.parseEase(s.heap ? "back.in" : "power2.in")); // trọng lực; heap lùi lấy đà rồi lao
      const q = <T extends Element>(sel: string) => o.querySelector<T>(sel);
      const prevPosition = host.style.position;
      host.style.position = "relative"; // lớp key nằm tuyệt đối trong vùng cuộn, cuộn cùng cây

      const rect = (j: number): Box | null => {
        const st = steps[j];
        if (!st.heap) {
          const c = nodePosition(st.page);
          if (c) return { x: c.x - NW / 2, y: c.y - NH / 2, w: NW, cap: CAP };
          if (st.slide) return null; // leaf trượt sang luôn nằm trong model; không thấy thì không vẽ
          // trang chưa đọc: key đi vào khối hidden của đúng tầng
          const g = svg.querySelector(`g[data-hidden-level="${Math.max(0, model.height - 1 - j)}"]`);
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
        set(o, { width: svg.getAttribute("width"), height: Number(svg.getAttribute("height")) + (hasHeap ? HEAP_BAND : 0) });
        const boxes = steps.map((_, j) => rect(j));
        steps.forEach((s, j) => {
          const b = boxes[j];
          const f = clamp(eases[j](clamp(p - j)));
          const lit = p >= j + 1 - 1e-6 ? "true" : null;
          const a = boxes[s.src];
          if (b && a && s.src >= 0) {
            const bx = b.x + b.w / 2;
            const ax = s.heap ? bx : a.x + a.w / 2;
            const slide = s.slide ? `M${a.x + a.w} ${a.y + NH / 2}L${b.x} ${b.y + NH / 2}` : null;
            const ay = a.y + NH + a.cap;
            const my = (ay + b.y) / 2;
            set(q(`[data-edge="${j}"]`), { d: slide ?? (s.heap ? `M${ax} ${ay}L${bx} ${b.y}` : `M${ax} ${ay}C${ax} ${my} ${bx} ${my} ${bx} ${b.y}`), "stroke-dashoffset": 1 - f, "data-lit": lit });
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
        // key: đoạn đang đi nằm giữa đích j-1 và j; ease áp ở đây nên p luôn tuyến tính theo timeline
        const j = clamp(Math.ceil(p) - 1, 0, S - 1);
        const end = boxes[j];
        const prev = boxes[steps[j].src];
        const keyEl = q<SVGElement>("[data-key]");
        if (p <= 0 || !end) keyEl?.style.setProperty("opacity", "0");
        else {
          const u = eases[j](clamp(p - j));
          const ex = end.x + end.w / 2;
          const sx = prev ? prev.x + prev.w / 2 : ex;
          const sy = prev ? prev.y : Math.max(MARKER_H / 2, end.y - 28);
          const x = sx + (ex - sx) * u;
          const y = sy + (end.y - sy) * u;
          keyEl?.setAttribute("transform", `translate(${x} ${y - LIFT})`);
          keyEl?.style.setProperty("opacity", String(j === 0 ? Math.min(1, (p - j) * 4) : 1));
          if (follow) {
            if (x < host.scrollLeft + 40 || x > host.scrollLeft + host.clientWidth - 40) host.scrollLeft = Math.max(0, x - host.clientWidth / 2);
            if (y < host.scrollTop + 20 || y > host.scrollTop + host.clientHeight - 20) host.scrollTop = Math.max(0, y - host.clientHeight / 2);
          }
        }
        const k = reached(p);
        if (k !== stepRef.current) setStep((stepRef.current = k));
        if (range.current && follow) range.current.value = String(tl.time());
      };

      const tl = gsap.timeline({ paused: true, onUpdate: () => render(true), onComplete: () => setPlaying(false) });
      for (let k = 1; k <= S; k++) tl.to(px, { p: k, duration: move, ease: "none" }, (k - 1) * seg);
      // jump: nhảy thẳng (kéo thanh tua, giảm chuyển động); không thì chạy tới đó bằng chính timeline
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
      tl.time(at(stepRef.current)); // dựng lại (đổi giảm chuyển động, đổi cây) thì về đúng bước cũ
      render(false);

      // kéo node ở "Kéo tự do" đổi vị trí: key và đèn đọc lại vị trí mới, timeline giữ nguyên thời điểm
      const mo = new MutationObserver(() => render(false));
      mo.observe(svg, { attributes: true, attributeFilter: ["transform", "width", "height"], subtree: true, childList: true });
      return () => {
        mo.disconnect();
        tl.kill();
        host.style.position = prevPosition;
      };
    },
    { dependencies: [hostReady, steps, reduced], scope: wrap, revertOnUpdate: true },
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
  const counter = t("counter", { read: step, total: S });

  return (
    <div ref={wrap} className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="btree-drop" data-step={step} data-playing={playing || undefined}>
      {view}
      {hostReady &&
        S > 0 &&
        createPortal(
          <svg ref={ov} aria-hidden="true" data-testid="btree-drop-layer" style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}>
            {steps.map((s, j) =>
              s.src >= 0 ? <path key={`e${j}`} data-edge={j} fill="none" pathLength={1} strokeDasharray={1} strokeDashoffset={1} className="stroke-lamp" strokeWidth={1.5} /> : null,
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
            {steps.map((s, j) => (s.heap ? null : <rect key={`n${j}`} data-node={j} rx={2} fill="none" className="stroke-lamp" strokeWidth={1.5} style={{ opacity: 0 }} />))}
            <g data-key="" style={{ opacity: 0 }}>
              <title>{t("keyTitle", { key })}</title>
              <rect x={-markerW / 2} y={-MARKER_H / 2} width={markerW} height={MARKER_H} rx={3} className="fill-lamp" />
              <text y={4.5} textAnchor="middle" className="fill-lamp-ink" style={{ font: "12.5px var(--mono)" }}>
                {shortKey}
              </text>
            </g>
          </svg>,
          hostReady,
        )}
      <div className="sticky bottom-0 z-10 shrink-0 border-t border-control bg-stage px-[var(--edge)] py-2" data-testid="btree-drop-panel">
        {S === 0 ? (
          <p role="status" className="m-0 text-[13px] leading-[18px] text-ink2" data-testid="drop-no-path">
            {err ? t(`rangeError.${err}`) : to !== undefined ? t("noPathRange") : t("noPath")}
          </p>
        ) : (
          <>
            <p className="sr-only" data-testid="drop-summary">
              {to !== undefined
                ? t("summaryRange", { key, to, pages: steps.filter((s) => !s.heap).map((s) => s.page).join(" → ") })
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
export function BTreeDrop({ model, path, label, to }: { model: BTreeModel; path?: BTreePath; label: EvidenceLabel; to?: string }) {
  const sig = `${model.engine}:${model.index}:${path?.key}:${path?.pages.join(",")}:${path?.heapPage}:${to}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- giữ path ổn định theo nội dung, tránh dựng lại timeline khi cha tạo object mới
  const stable = useMemo(() => path, [sig]);
  return <Scene key={sig} model={model} path={stable} label={label} to={to} />;
}
