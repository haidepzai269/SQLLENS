"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { EngineId } from "@/contracts/engine";
import type { PlanNode } from "@/contracts/plan";
import { BUCKETS, buildJoinSteps, INNER, isIndexed, joinSupport, OUTER, planRows, START, type JoinKind } from "./steps";

gsap.registerPlugin(useGSAP);

const MOVE = 0.9; // giây mỗi bước
const HOLD = 0.6; // giây dừng giữa hai bước
const QUERY = "(prefers-reduced-motion: reduce)";
const PITCH = 34;
const TOP = 28;
const CH = 28; // chiều cao chip
const AX = 8;
const BX = 120;
const CW = 70;
const HX = 236;
const SANS = { font: "11px var(--font-sans, sans-serif)" };
const MONO = { font: "13px var(--mono)" };
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const reached = (p: number) => Math.floor(p + 1e-6);
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const subscribeReduced = (cb: () => void) => {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const rowY = (i: number) => TOP + i * PITCH + CH / 2;
const bucketY = (k: number) => TOP + k * 68 + 26;
const short = (s?: string) => (s && s.length > 10 ? `${s.slice(0, 9)}…` : s);
const tableOf = (n?: PlanNode): string | undefined => (n ? (n.table ?? n.children.map(tableOf).find(Boolean)) : undefined);

const noop = () => {};
type Actions = { to: (time: number, jump?: boolean) => void; run: () => void; pause: () => void };

function Scene({ node, kind }: { node: PlanNode; kind: JoinKind }) {
  const t = useTranslations("join-anim");
  const indexed = kind === "nested_loop" && isIndexed(node);
  const steps = useMemo(() => buildJoinSteps(kind, indexed), [kind, indexed]);
  const S = steps.length;
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(QUERY).matches, () => false);
  const move = reduced ? 0.001 : MOVE;
  const seg = move + (reduced ? 1.2 : HOLD);
  const at = (k: number) => (k <= 0 ? 0 : (k - 1) * seg + move);
  const ease = useMemo(() => gsap.parseEase("power2.inOut"), []);

  const [p, setP] = useState(0);
  const [playing, setPlaying] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const proxy = useRef({ p: 0 });
  const act = useRef<Actions>({ to: noop, run: noop, pause: noop });

  // Một timeline chỉ tween số p; mọi thứ hiển thị suy ra từ p (giống Task045).
  useGSAP(
    (_, contextSafe) => {
      const px = proxy.current;
      const tl = gsap.timeline({
        paused: true,
        onUpdate: () => {
          setP(px.p);
          if (range.current) range.current.value = String(tl.time());
        },
        onComplete: () => setPlaying(false),
      });
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
      tl.time(at(reached(px.p))); // đổi giảm chuyển động thì về đúng bước cũ
      setP(px.p);
      return () => tl.kill();
    },
    { dependencies: [steps, reduced], scope: wrap, revertOnUpdate: true },
  );

  const k = reached(p);
  const cur = k > 0 ? steps[k - 1] : START;
  const nxt = steps[k] ?? cur;
  // đoạn đang đi nằm giữa bước k và k+1; ease áp ở đây nên p luôn tuyến tính theo timeline
  const f = reduced ? 0 : ease(clamp(p - k));
  const ptr = (key: "a" | "b") => {
    const x = cur[key];
    const y = nxt[key];
    if (x < 0 && y < 0) return null;
    return { y: rowY(x < 0 ? y : y < 0 ? x : lerp(x, y, f)), o: x < 0 ? f : y < 0 ? 1 - f : 1 };
  };
  const pa = ptr("a");
  const pb = ptr("b");

  const hash = kind === "hash_join";
  const W = hash ? 372 : 244;
  const H = TOP + INNER.length * PITCH;
  const rows = planRows(node);
  const names = [short(tableOf(node.children[0])), short(tableOf(node.children[1]))];
  const next = () => act.current.to(at(Math.min(S, reached(proxy.current.p) + 1)));
  const back = () => {
    const q = proxy.current.p;
    act.current.to(at(q > reached(q) + 1e-6 ? reached(q) : Math.max(0, reached(q) - 1)));
  };
  const counter = t("counter", { read: k, total: S });
  const say = (s: (typeof steps)[number]) => t(`step.${s.msg}`, s.vals);
  const last = steps[S - 1];
  const buckets = Array.from({ length: BUCKETS }, (_, b) => INNER.filter((v, j) => v % BUCKETS === b && j < cur.built));

  const chip = (col: "a" | "b", i: number) => {
    const val = col === "a" ? OUTER[i] : INNER[i];
    const active = col === "a" ? cur.a === i : cur.b === i;
    const hit = col === "b" && cur.hits.includes(i);
    const probed = col === "b" && cur.probed.includes(i);
    const x = col === "a" ? AX : BX;
    const strong = hit || (col === "a" && active);
    const state = strong ? "hit" : probed ? "probed" : active ? "active" : col === "b" && hash && i < cur.built ? "built" : "idle";
    return (
      <g key={`${col}${i}`} data-chip={`${col}${i}`} data-state={state}>
        <rect x={x} y={TOP + i * PITCH} width={CW} height={CH} rx={3} className={strong ? "fill-lamp stroke-lamp" : active || probed ? "fill-stage stroke-lamp" : "fill-stage stroke-control"} strokeWidth={1.5} strokeDasharray={probed && !hit ? "3 2" : undefined} />
        <text x={x + CW / 2} y={TOP + i * PITCH + 19} textAnchor="middle" className={strong ? "fill-lamp-ink" : "fill-ink2"} style={MONO}>
          {val}
        </text>
      </g>
    );
  };

  return (
    <div ref={wrap} className="flex min-w-0 flex-col gap-2" data-testid="join-anim" data-step={k} data-playing={playing || undefined} data-kind={kind}>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink2">
        <span data-testid="join-label" data-label="simulated" className="inline-flex h-5 items-center rounded-[2px] border border-label-simulated px-[7px] text-xs text-white">
          {t("label")}
        </span>
        <span className="font-medium text-foreground">{t(`kind.${kind}`)}</span>
      </div>
      <p className="m-0 text-[13px] leading-[18px] text-ink2" data-testid="join-sample">
        {t("sample", { outer: OUTER.length, inner: INNER.length })}{" "}
        <span data-testid="join-rows">{rows === null ? t("rows.none") : "real" in rows ? t("rows.real", { n: rows.real }) : t("rows.est", { n: rows.est })}</span>
      </p>
      <div className="min-w-0 overflow-hidden rounded-[3px] border border-control bg-stage p-2">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("diagram", { kind: t(`kind.${kind}`) })} className="mx-auto block h-auto w-full max-w-[560px]" data-testid="join-svg">
          <text x={AX} y={16} className="fill-dim" style={SANS}>
            {t("outer", { name: names[0] ?? "" })}
          </text>
          <text x={BX} y={16} className="fill-dim" style={SANS}>
            {t(hash ? "innerHash" : "inner", { name: names[1] ?? "" })}
          </text>
          {hash && (
            <text x={HX} y={16} className="fill-dim" style={SANS}>
              {t("hashTable")}
            </text>
          )}
          {hash &&
            buckets.map((cell, b) => (
              <g key={b} data-bucket={b} data-lit={cur.bucket === b || undefined}>
                <rect x={HX} y={TOP + b * 68} width={128} height={60} rx={3} fill="none" className={cur.bucket === b ? "stroke-lamp" : "stroke-control"} strokeWidth={1.5} />
                <text x={HX + 8} y={TOP + b * 68 + 16} className="fill-dim" style={SANS}>
                  {t("bucket", { b })}
                </text>
                <text x={HX + 8} y={TOP + b * 68 + 40} className="fill-ink2" style={MONO}>
                  {cell.join("  ")}
                </text>
              </g>
            ))}
          {hash && cur.bucket >= 0 && (cur.b >= 0 || cur.a >= 0) && (
            <line data-testid="join-link" x1={cur.b >= 0 ? BX + CW : AX + CW} y1={rowY(cur.b >= 0 ? cur.b : cur.a)} x2={HX} y2={bucketY(cur.bucket)} className="stroke-lamp" strokeWidth={1.5} strokeDasharray="4 3" />
          )}
          {OUTER.map((_, i) => chip("a", i))}
          {INNER.map((_, i) => chip("b", i))}
          {pa && pa.o > 0 && <polygon data-testid="join-ptr-a" data-y={pa.y.toFixed(1)} points={`${AX + CW + 4},${pa.y - 5} ${AX + CW + 14},${pa.y} ${AX + CW + 4},${pa.y + 5}`} className="fill-lamp" style={{ opacity: pa.o }} />}
          {pb && pb.o > 0 && <polygon data-testid="join-ptr-b" data-y={pb.y.toFixed(1)} points={`${BX - 4},${pb.y - 5} ${BX - 14},${pb.y} ${BX - 4},${pb.y + 5}`} className="fill-lamp" style={{ opacity: pb.o }} />}
        </svg>
      </div>

      <div className="sticky bottom-0 z-10 shrink-0 border-t border-control bg-stage py-2" data-testid="join-panel">
        <p className="sr-only" data-testid="join-summary">
          {t("summary", { kind: t(`kind.${kind}`), steps: S, cmp: last.compares, out: last.out })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => act.current.run()} disabled={playing}>
            {k >= S ? t("runAgain") : t("run")}
          </Button>
          <Button type="button" variant="outline" onClick={() => act.current.pause()} disabled={!playing}>
            {t("pause")}
          </Button>
          <Button type="button" variant="outline" onClick={back}>
            {t("back")}
          </Button>
          <Button type="button" variant="outline" onClick={next} disabled={k >= S}>
            {t("next")}
          </Button>
          <Button type="button" variant="outline" onClick={() => act.current.to(0, true)}>
            {t("reset")}
          </Button>
          <span className="ml-auto text-[13px] text-ink2" data-testid="join-counter">
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
          data-testid="join-scrub"
          onInput={(e) => act.current.to(Number(e.currentTarget.value), true)}
          className="my-2 block h-6 w-full accent-[var(--lamp)]"
        />
        <p className="m-0 text-[13px] leading-[18px] text-ink2" data-testid="join-stats">
          {t("stats", { cmp: cur.compares, out: cur.out })}
        </p>
        <p aria-live="polite" className="m-0 mt-1 text-[13px] leading-[18px] text-ink2" data-testid="join-explain">
          {k > 0 ? say(cur) : t(`idle.${kind}`)}
        </p>
        {reduced && (
          <p className="m-0 mt-1 text-[13px] leading-[18px] text-dim" data-testid="join-reduced">
            {t("reducedNote")}
          </p>
        )}
        <p className="m-0 mt-1 text-[13px] leading-[18px] text-dim">{t("noTime")}</p>
        <details className="mt-1 text-[13px] text-dim">
          <summary className="cursor-pointer">{t("log")}</summary>
          <ol className="m-0 pl-5" data-testid="join-log">
            {steps.slice(0, k).map((s) => (
              <li key={s.vals.n}>{say(s)}</li>
            ))}
          </ol>
        </details>
      </div>
    </div>
  );
}

// Không mô phỏng thì nói rõ lý do, không chạy gì (nguyên tắc 4).
export function JoinAnimation({ node, engine }: { node: PlanNode; engine: EngineId }) {
  const t = useTranslations("join-anim");
  const s = joinSupport(node, engine);
  if ("reason" in s)
    return (
      <p role="status" className="m-0 text-[13px] leading-[18px] text-ink2" data-testid="join-unsupported" data-reason={s.reason}>
        {t(`unsupported.${s.reason}`, { label: node.label })}
      </p>
    );
  return <Scene key={`${engine}:${node.id}:${s.kind}:${isIndexed(node)}`} node={node} kind={s.kind} />;
}
