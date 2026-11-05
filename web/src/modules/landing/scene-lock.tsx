"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { gsap, MOTION, useGSAP } from "./gsap-setup";
import { olClass, Shell } from "./shell";
import { fadeSteps, prepSteps } from "./steps";
import { Tag } from "./ui";

// Cảnh 3 (giữ màn hình): hai session giữ khóa chéo nhau thành vòng chờ, rồi một bên bị hủy.
export function SceneLock() {
  const t = useTranslations("landing.lock");
  const sec = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = sec.current!;
      const q = (s: string) => el.querySelectorAll(s);
      const mm = gsap.matchMedia();
      mm.add({ motion: MOTION, narrow: "(max-width: 767px)" }, (c) => {
        if (!c.conditions?.motion) return;
        const { lis, dim, undo } = prepSteps(el.querySelector("ol")!, !!c.conditions.narrow);
        gsap.set(q("[data-hold],[data-wait],[data-cycle],[data-abort]"), { opacity: 0 });
        gsap.set(q("[data-box]"), { attr: { class: "fill-raised stroke-control" } });
        const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: "top top", end: "bottom bottom", scrub: true } });
        const at = (i: number) => 0.4 + i * 1.1;
        const step = (i: number, sel: string) => tl.fromTo(q(sel), { opacity: 0 }, { opacity: 1, duration: 0.6 }, at(i));
        step(0, "[data-hold=a1]");
        step(1, "[data-hold=b2]");
        step(2, "[data-wait=a2]");
        step(3, "[data-wait=b1]");
        tl.fromTo(q("[data-cycle]"), { opacity: 0 }, { opacity: 1, duration: 0.5 }, at(3) + 0.4);
        step(4, "[data-abort]");
        tl.set(q("[data-box]"), { attr: { class: "fill-raised stroke-negative" } }, at(4) + 0.3);
        tl.to({}, { duration: 1.2 });
        fadeSteps(tl, lis, dim, [0, 1, 2, 3, 4].map(at));
        return undo;
      });
    },
    { scope: sec },
  );

  const hold = (id: string, x: number) => (
    <g data-hold={id}>
      <line x1={x} y1={64} x2={x} y2={246} className="stroke-ink2" strokeWidth={2.5} />
      <path d={`M${x - 6} 236 L${x} 248 L${x + 6} 236`} fill="none" className="stroke-ink2" strokeWidth={2.5} />
      <text x={x + 10} y={160} className="fill-ink2" style={{ font: "500 13px var(--sans)" }}>{t("holds")}</text>
    </g>
  );

  return (
    <Shell
      ref={sec}
      id="lock-h"
      bg="bg-stage"
      vh={300}
      title={t("title")}
      lead={t("lead")}
      list={<ol aria-label={t("listLabel")} className={olClass}>{[1, 2, 3, 4, 5].map((n) => <li key={n}>{t(`s${n}`)}</li>)}</ol>}
    >
      <svg data-ui viewBox="0 0 400 320" role="img" aria-label={t("title")} className="h-auto w-full overflow-visible">
        {[{ x: 10, k: "sessionA" }, { x: 260, k: "sessionB" }].map((s) => (
          <g key={s.k} aria-hidden>
            <rect data-box x={s.x} y={10} width={130} height={52} rx={2} className="fill-raised stroke-negative" strokeWidth={2} />
            <text x={s.x + 65} y={41} textAnchor="middle" className="fill-text" style={{ font: "600 15px var(--sans)" }}>{t(s.k)}</text>
          </g>
        ))}
        {[{ x: 10, k: "row1" }, { x: 260, k: "row2" }].map((r) => (
          <g key={r.k} aria-hidden>
            <rect x={r.x} y={250} width={130} height={52} rx={2} className="fill-surface stroke-control" strokeWidth={1.5} />
            <text x={r.x + 65} y={281} textAnchor="middle" className="fill-ink2" style={{ font: "500 14px var(--mono)" }}>{t(r.k)}</text>
          </g>
        ))}
        <g aria-hidden>
          {hold("a1", 75)}
          {hold("b2", 325)}
          <g data-wait="a2">
            <line x1={125} y1={64} x2={285} y2={248} className="stroke-ink2" strokeWidth={2.5} strokeDasharray="7 6" />
            <text x={256} y={200} className="fill-ink2" style={{ font: "500 13px var(--sans)" }}>{t("waits")}</text>
          </g>
          <g data-wait="b1">
            <line x1={275} y1={64} x2={115} y2={248} className="stroke-ink2" strokeWidth={2.5} strokeDasharray="7 6" />
            <text x={118} y={200} className="fill-ink2" style={{ font: "500 13px var(--sans)" }}>{t("waits")}</text>
          </g>
          <g data-cycle>
            <line x1={125} y1={64} x2={285} y2={248} className="stroke-negative" strokeWidth={3.5} strokeDasharray="7 6" />
            <line x1={275} y1={64} x2={115} y2={248} className="stroke-negative" strokeWidth={3.5} strokeDasharray="7 6" />
          </g>
          <g data-abort>
            <rect x={120} y={140} width={160} height={32} rx={2} className="fill-stage stroke-negative" strokeWidth={2} />
            <text x={200} y={161} textAnchor="middle" className="fill-severity-broken-foreground" style={{ font: "600 14px var(--sans)" }}>{t("abort")}</text>
          </g>
        </g>
      </svg>
      <div className="mt-6"><Tag kind="sim">{t("tag")}</Tag></div>
    </Shell>
  );
}
