"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { descent, resetTree, ROUTES, Tree } from "./tree";
import { gsap, MOTION, useGSAP } from "./gsap-setup";
import { olClass, Shell } from "./shell";
import { fadeSteps, prepSteps } from "./steps";

// Cảnh 1 (giữ màn hình): key 7421 rơi từ root qua internal xuống leaf rồi sang heap, bước chữ đổi theo cuộn.
export function SceneDescent() {
  const t = useTranslations("landing.descent");
  const sec = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = sec.current!;
      const svg = el.querySelector("svg")!;
      const mm = gsap.matchMedia();
      mm.add({ motion: MOTION, narrow: "(max-width: 767px)" }, (c) => {
        if (!c.conditions?.motion) return;
        const { lis, dim, undo } = prepSteps(el.querySelector("ol")!, !!c.conditions.narrow);
        resetTree(svg);
        const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: "top top", end: "bottom bottom", scrub: true } });
        tl.to({}, { duration: 0.4 });
        descent(tl, svg, ROUTES["7421"], "7421", 1);
        fadeSteps(tl, lis, dim, [0, 1, 2, 3].map((i) => tl.labels[`s${i}`] - 0.9));
        tl.to({}, { duration: 0.8 });
        return undo;
      });
    },
    { scope: sec },
  );

  return (
    <Shell
      ref={sec}
      id="descent-h"
      bg="bg-stage"
      vh={270}
      title={t("title")}
      lead={t("lead")}
      list={<ol aria-label={t("listLabel")} className={olClass}>{[1, 2, 3, 4].map((n) => <li key={n}>{t(`s${n}`)}</li>)}</ol>}
    >
      <Tree label={t("title")} lit={ROUTES["7421"]} />
    </Shell>
  );
}

export function SceneNote({ ns, k, tone = "bg-stage" }: { ns: string; k: string; tone?: string }) {
  const t = useTranslations(`landing.${ns}`);
  return <p className={`${tone} px-[var(--pg)] pb-20 pt-4 text-[15px] leading-relaxed text-dim`}>{t(k)}</p>;
}
