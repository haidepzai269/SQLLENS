"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";
import { descent, resetTree, ROUTES, Tree } from "./tree";
import { gsap, MOTION, ScrollTrigger, useGSAP } from "./gsap-setup";
import { btnQuiet, LoginLink, ProductLink } from "./ui";

const KEYS = Object.keys(ROUTES);
const HOP = 0.75;

export function Hero() {
  const t = useTranslations("landing");
  const root = useRef<HTMLElement>(null);
  const play = useRef<(key: string) => void>(() => {});
  const [sel, setSel] = useState(KEYS[2]);

  useGSAP(
    (_, contextSafe) => {
      const svg = root.current!.querySelector("svg[data-ui]")!;
      const readout = root.current!.querySelector<HTMLElement>("[data-read]")!;
      const setRead = (n: number) => (readout.textContent = t("hero.read", { n }));
      let tl: gsap.core.Timeline | undefined;
      let timer: gsap.core.Tween | undefined;
      let visible = true;
      const mm = gsap.matchMedia();

      mm.add({ motion: MOTION, reduce: "(prefers-reduced-motion: reduce)" }, (c) => {
        const animate = !!c.conditions?.motion;
        const run = contextSafe!((key: string, loop: boolean) => {
          tl?.kill();
          timer?.kill();
          resetTree(svg);
          setSel(key);
          setRead(0);
          const route = ROUTES[key];
          if (!animate) {
            // Giảm chuyển động: vẽ sẵn đường đi, không có gì chạy.
            gsap.set(svg.querySelectorAll(route.flatMap((id, i) => [`[data-lit-n="${id}"]`, i ? `[data-lit-e="${route[i - 1]}-${id}"]` : ""]).filter(Boolean).join(",")), { opacity: 1 });
            setRead(4);
            return;
          }
          tl = gsap.timeline({
            paused: !visible,
            onComplete: () => {
              if (loop) timer = gsap.delayedCall(1.8, () => run(KEYS[(KEYS.indexOf(key) + 1) % KEYS.length], true));
            },
          });
          descent(tl, svg, route, key, HOP);
          route.forEach((_, i) => tl!.call(() => setRead(i + 1), [], `s${i}`));
        });
        play.current = (key) => run(key, false);
        run("7421", true);
        const st = ScrollTrigger.create({
          trigger: root.current,
          start: "top bottom",
          end: "bottom top",
          onToggle: (self) => {
            visible = self.isActive;
            if (visible) { tl?.resume(); timer?.resume(); } else { tl?.pause(); timer?.pause(); }
          },
        });
        return () => st.kill();
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative bg-ground" style={{ "--pg": "clamp(16px, 2.8vw, 40px)" } as React.CSSProperties}>
      <header className="flex items-center justify-between gap-4 px-[var(--pg)] pt-5">
        <a href="#top" className="flex items-center gap-2 text-lg font-semibold">
          <svg viewBox="0 0 20 20" aria-hidden className="size-6">
            <circle cx="10" cy="10" r="8.5" fill="none" strokeWidth="1.5" className="stroke-text" />
            <path d="M10 6v3M10 9H6.5v2.5M10 9h3.5v2.5" fill="none" strokeWidth="1.2" className="stroke-text" />
            <rect x="8.5" y="4" width="3" height="3" className="fill-lamp" />
            <rect x="5" y="11.5" width="3" height="3" className="fill-text" />
            <rect x="12" y="11.5" width="3" height="3" className="fill-text" />
          </svg>
          SQLLens
        </a>
        <nav aria-label={t("nav.label")} className="flex items-center gap-1 sm:gap-4">
          <LanguageSwitcher />
          <LoginLink label={t("nav.login")} className="inline-flex min-h-11 items-center px-2 text-base text-ink2 hover:text-text max-sm:hidden" />
          <ProductLink label={t("nav.open")} className={`${btnQuiet} min-h-11 px-4 text-[15px]`} />
        </nav>
      </header>

      <div id="top" className="grid min-h-[calc(100svh-4.5rem)] md:grid-cols-12">
        <div className="flex flex-col justify-center px-[var(--pg)] py-14 md:col-span-7 md:py-10">
          <h1 className="text-text" style={{ fontSize: "clamp(28px, 4.6vw, 76px)", lineHeight: 1.02, letterSpacing: "-0.035em", fontWeight: 600 }}>
            <span className="about-load block" style={{ "--d": "60ms" } as React.CSSProperties}>{t("hero.line1")}</span>
            <span className="about-load block" style={{ "--d": "170ms" } as React.CSSProperties}>{t("hero.line2")}</span>
          </h1>
          <p className="about-load mt-8 max-w-[40ch] text-lg leading-relaxed text-ink2 md:text-xl" style={{ "--d": "380ms" } as React.CSSProperties}>
            {t("hero.lead")}
          </p>
          <div className="about-load mt-8 flex flex-wrap gap-3" style={{ "--d": "460ms" } as React.CSSProperties}>
            <ProductLink label={t("hero.open")} />
            <LoginLink label={t("hero.login")} />
          </div>
          <p className="about-load mt-5 max-w-[46ch] text-[15px] text-dim" style={{ "--d": "540ms" } as React.CSSProperties}>{t("hero.note")}</p>
        </div>

        <div className="md:col-span-5 md:pt-10">
          <div className="about-stage-shape about-stage h-full bg-stage py-10 pl-[calc(var(--pg)+8px)] pr-[var(--pg)] md:pl-14 md:pr-[var(--pg)]">
            <div className="mx-auto flex h-full max-w-[600px] flex-col justify-center gap-5">
              <Tree label={t("hero.treeLabel")} lit={ROUTES["7421"]} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <span id="pick" className="text-[15px] text-ink2">{t("hero.pick")}</span>
                <div role="group" aria-labelledby="pick" className="flex flex-wrap gap-2">
                  {KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={sel === k}
                      aria-label={t("hero.keyBtn", { key: k })}
                      onClick={() => play.current(k)}
                      className="min-h-11 min-w-16 rounded-[2px] bg-raised px-3 text-[15px] font-semibold tabular-nums transition-colors duration-[180ms] hover:bg-control aria-pressed:bg-lamp aria-pressed:text-lamp-ink"
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <span data-read className="ml-auto text-[15px] tabular-nums text-ink2" aria-live="off">{t("hero.read", { n: 4 })}</span>
              </div>
              <p className="text-[15px] text-dim">{t("hero.caption")}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
