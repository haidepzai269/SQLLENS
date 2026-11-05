"use client";

import { useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { gsap, MOTION, useGSAP } from "./gsap-setup";
import { olClass, Shell } from "./shell";
import { fadeSteps, prepSteps } from "./steps";
import { Tag } from "./ui";

// Số đo thật (Chromium, PGlite 0.5.14, 02/11/2026). Mốc thứ tư không chạy thật nên không có số.
const STAGES = [
  { rows: 10_000, level: 1, kb: 112 },
  { rows: 100_000, level: 1, kb: 936 },
  { rows: 500_000, level: 2, kb: 4640 },
];
const LEAVES = [52, 148, 252, 348];
const TICKS = ["10k", "100k", "500k", "> 500k"];

const box = "fill-raised stroke-control";
const txt = { font: "500 12.5px var(--mono)" } as const;

// Cảnh 4 (giữ màn hình): kéo quy mô thì root tách đôi và một tầng mới mọc lên trên.
export function SceneScale() {
  const t = useTranslations("landing.scale");
  const locale = useLocale();
  const sec = useRef<HTMLElement>(null);
  const fmt = (n: number) => n.toLocaleString(locale);

  useGSAP(
    () => {
      const el = sec.current!;
      const q = (s: string) => el.querySelectorAll<HTMLElement>(s);
      const one = (s: string) => el.querySelector<HTMLElement>(s)!;
      const track = one("[data-track]");
      const tag = (kind: "real" | "est") => one(`[data-tag=${kind}]`);
      const render = (stage: number) => {
        const s = STAGES[stage];
        one("[data-rows]").textContent = s ? t("rowsN", { n: fmt(s.rows) }) : t("unrun");
        one("[data-level]").textContent = s ? t("level", { n: s.level }) : "";
        one("[data-kb]").textContent = s ? `${fmt(s.kb)} KB` : "";
        gsap.set(tag("real"), { display: s ? "inline-flex" : "none" });
        gsap.set(tag("est"), { display: s ? "none" : "inline-flex" });
      };
      const mm = gsap.matchMedia();
      mm.add({ motion: MOTION, narrow: "(max-width: 767px)" }, (c) => {
        if (!c.conditions?.motion) return;
        const { lis, dim, undo } = prepSteps(el.querySelector("ol")!, !!c.conditions.narrow);
        const stage = { p: 0 };
        const move = () => gsap.set(one("[data-thumb]"), { x: (stage.p / 3) * (track.clientWidth - 20) });
        // Dựng trạng thái 10.000 dòng: chưa có tầng mới.
        gsap.set(q("[data-newroot],[data-e2],[data-b],[data-t2]"), { opacity: 0 });
        gsap.set(q("[data-newroot]"), { y: -40 });
        gsap.set(q("[data-e1],[data-t1]"), { opacity: 1 });
        gsap.set(one("[data-thumb]"), { left: 0 });
        gsap.set(q("[data-a]"), { x: 100 });
        gsap.set(q("[data-b]"), { x: -100 });
        render(0);
        move();
        const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: "top top", end: "bottom bottom", scrub: true } });
        const to = (p: number, at: number, d: number) => tl.to(stage, { p, duration: d, ease: "power2.inOut", onUpdate: () => { render(Math.min(Math.round(stage.p), 3)); move(); } }, at);
        tl.to({}, { duration: 0.5 });
        to(1, 0.5, 0.4);
        to(2, 1.5, 0.9);
        tl.to(q("[data-a]"), { x: 0, duration: 0.9, ease: "power2.inOut" }, 1.5)
          .to(q("[data-b]"), { x: 0, opacity: 1, duration: 0.9, ease: "power2.inOut" }, 1.5)
          .to(q("[data-t1]"), { opacity: 0, duration: 0.3 }, 1.5)
          .to(q("[data-t2]"), { opacity: 1, duration: 0.3 }, 2.1)
          .to(q("[data-e1]"), { opacity: 0, duration: 0.4 }, 1.5)
          .to(q("[data-e2]"), { opacity: 1, duration: 0.6 }, 1.9)
          .to(q("[data-newroot]"), { opacity: 1, y: 0, duration: 0.8, ease: "expo.out" }, 1.8);
        to(3, 3.2, 0.4);
        tl.to(q("[data-tree]"), { opacity: 0.35, duration: 0.4 }, 3.2).to({}, { duration: 1 });
        fadeSteps(tl, lis, dim, [0, 0.5, 1.5, 3.2]);
        return () => { undo(); render(2); };
      });
    },
    { scope: sec, dependencies: [locale] },
  );

  const last = STAGES[2];
  return (
    <Shell
      ref={sec}
      id="scale-h"
      bg="bg-ground"
      vh={250}
      title={t("title")}
      lead={t("lead")}
      list={<ol aria-label={t("listLabel")} className={olClass}>{[1, 2, 3, 4].map((n) => <li key={n}>{t(`s${n}`)}</li>)}</ol>}
    >
      <div className="relative">
        <svg data-ui data-tree viewBox="0 0 400 310" role="img" aria-label={t("treeLabel")} className="h-auto w-full overflow-visible">
          <g aria-hidden>
            {LEAVES.map((x) => <line key={x} data-e1 x1={200} y1={180} x2={x} y2={250} className="stroke-control" strokeWidth={1.5} style={{ opacity: 0 }} />)}
            <g data-e2>
              <line x1={200} y1={68} x2={100} y2={140} className="stroke-control" strokeWidth={1.5} />
              <line x1={200} y1={68} x2={300} y2={140} className="stroke-control" strokeWidth={1.5} />
              {LEAVES.map((x, i) => <line key={x} x1={i < 2 ? 100 : 300} y1={180} x2={x} y2={250} className="stroke-control" strokeWidth={1.5} />)}
            </g>
            <g data-newroot>
              <rect x={140} y={28} width={120} height={40} rx={2} className={box} strokeWidth={1.5} />
              <text x={200} y={53} textAnchor="middle" className="fill-ink2" style={txt}>root</text>
            </g>
            {/* Node cũ: lúc đầu là root ở giữa, về sau là internal bên trái. data-a lệch +100 lúc đầu. */}
            <g data-a>
              <rect x={25} y={140} width={150} height={40} rx={2} className={box} strokeWidth={1.5} />
              <text data-t1 x={100} y={165} textAnchor="middle" className="fill-ink2" style={{ ...txt, opacity: 0 }}>root</text>
              <text data-t2 x={100} y={165} textAnchor="middle" className="fill-ink2" style={txt}>internal</text>
            </g>
            <g data-b>
              <rect x={225} y={140} width={150} height={40} rx={2} className={box} strokeWidth={1.5} />
              <text x={300} y={165} textAnchor="middle" className="fill-ink2" style={txt}>internal</text>
            </g>
            {LEAVES.map((x) => (
              <g key={x}>
                <rect x={x - 45} y={250} width={90} height={40} rx={2} className={box} strokeWidth={1.5} />
                <text x={x} y={275} textAnchor="middle" className="fill-ink2" style={txt}>leaf</text>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <p data-rows className="text-2xl font-semibold tabular-nums text-text md:text-3xl">{t("rowsN", { n: fmt(last.rows) })}</p>
        <p data-level className="text-lg tabular-nums text-lamp">{t("level", { n: last.level })}</p>
        <p data-kb className="text-lg tabular-nums text-ink2">{fmt(last.kb)} KB</p>
        <span data-tag="real"><Tag kind="real">{t("real")}</Tag></span>
        <span data-tag="est" style={{ display: "none" }}><Tag kind="est">{t("est")}</Tag></span>
      </div>
      <div data-track aria-hidden className="relative mt-5 h-14">
        <div className="absolute inset-x-0 top-2 h-2 bg-raised" />
        <div data-thumb className="absolute left-0 top-0 h-6 w-5 rounded-[2px] bg-lamp" style={{ left: "calc(66.67% - 13px)" }} />
        <div className="absolute inset-x-0 bottom-0 flex justify-between text-[13px] text-dim">{TICKS.map((k) => <span key={k}>{k}</span>)}</div>
      </div>
    </Shell>
  );
}
