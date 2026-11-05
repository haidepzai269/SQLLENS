"use client";

import { useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { gsap, MOTION, useGSAP } from "./gsap-setup";
import { Shell } from "./shell";
import { Tag } from "./ui";

// Số đo thật (Chromium, PGlite 0.5.14, PostgreSQL 18.6, 02/11/2026): SELECT * FROM orders WHERE customer_id = 42.
export const RACE = [
  { rows: 10_000, idx: 15, seq: 84 },
  { rows: 100_000, idx: 15, seq: 834 },
  { rows: 500_000, idx: 16, seq: 4167 },
];
const MAX = RACE[2].seq;
const lerp = (k: "rows" | "idx" | "seq", p: number) => {
  const i = Math.min(Math.floor(p), 1);
  return RACE[i][k] + (RACE[i + 1][k] - RACE[i][k]) * (p - i);
};

// Cảnh 2 (giữ màn hình): kéo ba quy mô, Seq Scan đọc thêm hàng nghìn trang còn Index Scan đứng yên.
export function SceneRace() {
  const t = useTranslations("landing.race");
  const locale = useLocale();
  const sec = useRef<HTMLElement>(null);
  const fmt = (n: number) => Math.round(n).toLocaleString(locale);
  const last = RACE[2];

  useGSAP(
    () => {
      const el = sec.current!;
      const $ = (s: string) => el.querySelector<HTMLElement>(s)!;
      const render = (p: number) => {
        const seq = lerp("seq", p), idx = lerp("idx", p);
        $("[data-rows]").textContent = t("rows", { rows: fmt(RACE[Math.round(p)].rows) });
        $("[data-seq-n]").textContent = t("pages", { n: fmt(seq) });
        $("[data-idx-n]").textContent = t("pages", { n: fmt(idx) });
        gsap.set($("[data-seq-bar]"), { scaleX: seq / MAX });
        gsap.set($("[data-idx-bar]"), { scaleX: Math.max(idx / MAX, 0.008) });
      };
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        const s = { p: 0 };
        render(0);
        const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: "top top", end: "bottom bottom", scrub: true } });
        tl.to({}, { duration: 0.5 })
          .to(s, { p: 1, duration: 0.6, ease: "power2.inOut", onUpdate: () => render(s.p) })
          .to({}, { duration: 0.6 })
          .to(s, { p: 2, duration: 0.6, ease: "power2.inOut", onUpdate: () => render(s.p) })
          .to({}, { duration: 0.8 });
        return () => render(2);
      });
    },
    { scope: sec, dependencies: [locale] },
  );

  return (
    <Shell ref={sec} id="race-h" bg="bg-ground" vh={210} title={t("title")} lead={t("lead")} list={null}>
      <div className="flex flex-col gap-8" data-ui>
        <p data-rows className="font-semibold tabular-nums text-text" style={{ fontSize: "clamp(32px, 4.4vw, 64px)", letterSpacing: "-0.03em", lineHeight: 1 }}>
          {t("rows", { rows: fmt(last.rows) })}
        </p>
        <div>
          <p className="flex flex-wrap justify-between gap-x-4 text-base md:text-lg">
            <span className="text-ink2">{t("seq")}</span>
            <span data-seq-n className="font-semibold tabular-nums text-text">{t("pages", { n: fmt(last.seq) })}</span>
          </p>
          <div className="mt-2 h-12 bg-raised"><div data-seq-bar className="h-full origin-left bg-text" style={{ transform: "scaleX(1)" }} /></div>
        </div>
        <div>
          <p className="flex flex-wrap justify-between gap-x-4 text-base md:text-lg">
            <span className="text-ink2">{t("idx")}</span>
            <span data-idx-n className="font-semibold tabular-nums text-lamp">{t("pages", { n: fmt(last.idx) })}</span>
          </p>
          <div className="mt-2 h-12 bg-raised"><div data-idx-bar className="h-full origin-left bg-lamp" style={{ transform: `scaleX(${last.idx / MAX})` }} /></div>
        </div>
      </div>
    </Shell>
  );
}

// Biên lai: ba quy mô đã đo, luôn hiện đủ kể cả khi giảm chuyển động.
export function RaceReceipt() {
  const t = useTranslations("landing.race");
  const locale = useLocale();
  const f = (n: number) => n.toLocaleString(locale);
  return (
    <div className="bg-ground px-[var(--pg)] pb-24 pt-2">
      <div className="max-w-[820px]">
        <Tag kind="real">{useTranslations("landing.scale")("real")}</Tag>
        <table className="mt-5 w-full text-left text-base md:text-lg">
          <caption className="sr-only">{t("tableLabel")}</caption>
          <thead className="text-ink2">
            <tr><th scope="col" className="py-2 pr-4 font-medium">{t("colRows")}</th><th scope="col" className="py-2 pr-4 text-right font-medium">{t("colIdx")}</th><th scope="col" className="py-2 text-right font-medium">{t("colSeq")}</th></tr>
          </thead>
          <tbody className="tabular-nums">
            {RACE.map((r) => (
              <tr key={r.rows} className="bg-surface odd:bg-raised/40"><th scope="row" className="py-3 pl-3 pr-4 font-medium">{f(r.rows)}</th><td className="py-3 pr-4 text-right text-lamp">{f(r.idx)}</td><td className="py-3 pr-3 text-right">{f(r.seq)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-5 text-[15px] leading-relaxed text-dim">{t("context")}</p>
      </div>
    </div>
  );
}
