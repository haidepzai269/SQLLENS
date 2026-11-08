"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import "./about.css";
import { Demo } from "./demo";
import { Hero } from "./hero";
import { SceneDescent, SceneNote } from "./scene-descent";
import { SceneLock } from "./scene-lock";
import { RaceReceipt, SceneRace } from "./scene-race";
import { SceneScale } from "./scene-scale";
import { Cta, Footer, Labels, Limits } from "./sections";
import { gsap, ScrollTrigger, useGSAP } from "./gsap-setup";

export function AboutPage() {
  const t = useTranslations("landing");
  const root = useRef<HTMLDivElement>(null);

  // Vào dần từng phần khi cuộn tới (một lần). Giảm chuyển động thì nội dung đứng yên.
  useGSAP(
    () => {
      if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.set("[data-reveal]", { opacity: 0, y: 28 });
      const batch = ScrollTrigger.batch("[data-reveal]", {
        start: "top 90%",
        once: true,
        onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.9, ease: "expo.out", stagger: 0.09, overwrite: true }),
      });
      return () => batch.forEach((st) => st.kill());
    },
    { scope: root },
  );

  // Đổi ngôn ngữ hoặc nạp font làm chữ dài ngắn khác đi: đo lại điểm kích hoạt của ScrollTrigger.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let id = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(id);
      id = requestAnimationFrame(() => ScrollTrigger.refresh());
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={root} style={{ "--pg": "clamp(16px, 2.8vw, 40px)" } as React.CSSProperties} className="bg-ground text-text">
      <a href="#main" className="absolute -top-16 left-2 z-20 bg-text px-3 py-2 text-ground focus:top-2">{t("skip")}</a>
      <main id="main">
        <Hero />
        <SceneDescent />
        <SceneNote ns="descent" k="note" />
        <SceneRace />
        <RaceReceipt />
        <SceneLock />
        <SceneNote ns="lock" k="context" />
        <SceneScale />
        <ScaleNote />
        <Demo />
        <Labels />
        <Limits />
        <Cta />
      </main>
      <Footer />
    </div>
  );
}

function ScaleNote() {
  const t = useTranslations("landing.scale");
  return (
    <div className="bg-ground px-[var(--pg)] pb-20 pt-4">
      <div className="max-w-[820px] text-[15px] leading-relaxed text-dim">
        <p>{t("realNote")}</p>
        <p className="mt-3">{t("estNote")}</p>
      </div>
    </div>
  );
}
