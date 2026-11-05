"use client";

import { Suspense, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter as useRawRouter, useSearchParams } from "next/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Link } from "@/i18n/navigation";
import "../landing/about.css";
import { gsap, MOTION, useGSAP } from "../landing/gsap-setup";
import { descent, resetTree, ROUTES, Tree } from "../landing/tree";
import { btnPrimary, btnQuiet } from "../landing/ui";
import { useAuth } from "./auth-provider";
import { GUEST_LIMIT } from "./guest";
import { providerNext, safeNext } from "./next";

const PROVIDERS = ["google", "github"] as const;
const KEYS = Object.keys(ROUTES);
const HOP = 0.7;

// Một timeline lặp: lần lượt bốn khóa rơi từ root qua internal xuống leaf rồi sang heap. Giảm chuyển động thì chỉ vẽ sẵn một đường đi.
function Scene() {
  const t = useTranslations("auth.page");
  const tl = useTranslations("landing");
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const svg = root.current!.querySelector("svg[data-ui]")!;
      const read = root.current!.querySelector<HTMLElement>("[data-read]")!;
      const set = (n: number) => (read.textContent = t("read", { n, total: 4 }));
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        const loop = gsap.timeline({ repeat: -1 });
        KEYS.forEach((key) => {
          const sub = gsap.timeline();
          descent(sub, svg, ROUTES[key], key, HOP);
          ROUTES[key].forEach((_, i) => sub.call(() => set(i + 1), [], `s${i}`));
          loop.call(() => (resetTree(svg), set(0))).add(sub).to({}, { duration: 1.1 });
        });
        return () => loop.kill();
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [t] },
  );
  return (
    <div ref={root} className="mx-auto flex h-full w-full max-w-[560px] flex-col justify-center gap-4">
      <div className="[&_svg]:mx-auto [&_svg]:max-h-[22svh] [&_svg]:w-auto md:[&_svg]:max-h-[62svh]">
        <Tree label={tl("hero.treeLabel")} lit={ROUTES["7421"]} />
      </div>
      <p data-read className="m-0 text-[15px] tabular-nums text-ink2" aria-live="off">{t("read", { n: 4, total: 4 })}</p>
      <p className="m-0 text-[15px] text-dim max-md:hidden">{t("caption")}</p>
    </div>
  );
}

function Body() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const sp = useSearchParams();
  const raw = useRawRouter();
  const { status } = useAuth();
  const next = safeNext(sp.get("next"), locale);
  const authError = sp.get("auth_error");
  const failure = authError === "cancelled" || authError === "failed" ? authError : null;
  // Đã đăng nhập thì không ở lại đây. next đã có tiền tố ngôn ngữ nên dùng router gốc, không dùng router của next-intl.
  useEffect(() => {
    if (status === "user") raw.replace(next);
  }, [status, next, raw]);
  const load = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;
  return (
    <main
      style={{ "--pg": "clamp(16px, 2.8vw, 40px)" } as React.CSSProperties}
      className="relative grid min-h-svh grid-rows-[auto_1fr] bg-ground text-text md:h-svh md:grid-cols-12 md:grid-rows-1"
    >
      <div className="absolute right-[var(--pg)] top-5 z-10 flex h-11 items-center">
        <LanguageSwitcher />
      </div>
      <section className="flex min-w-0 flex-col px-[var(--pg)] py-5 md:col-span-7">
        <div className="flex items-center justify-between gap-4">
          <Link href="/about" className="flex min-h-11 items-center gap-2 text-lg font-semibold">
            <svg viewBox="0 0 20 20" aria-hidden className="size-6">
              <circle cx="10" cy="10" r="8.5" fill="none" strokeWidth="1.5" className="stroke-text" />
              <path d="M10 6v3M10 9H6.5v2.5M10 9h3.5v2.5" fill="none" strokeWidth="1.2" className="stroke-text" />
              <rect x="8.5" y="4" width="3" height="3" className="fill-lamp" />
              <rect x="5" y="11.5" width="3" height="3" className="fill-text" />
              <rect x="12" y="11.5" width="3" height="3" className="fill-text" />
            </svg>
            SQLLens
          </Link>
        </div>
        <div className="flex flex-1 flex-col justify-center py-3 md:py-0">
          <h1 className="text-text" style={{ fontSize: "clamp(28px, 4.2vw, 68px)", lineHeight: 1.04, letterSpacing: "-0.035em", fontWeight: 600 }}>
            <span className="about-load block" style={load(60)}>{t("page.line1")}</span>
            <span className="about-load block" style={load(170)}>{t("page.line2")}</span>
          </h1>
          <p className="about-load mt-4 max-w-[42ch] text-base leading-relaxed text-ink2 md:mt-6 md:text-xl" style={load(320)}>{t("page.lead")}</p>
          {failure && (
            <p role="alert" data-testid="login-error" className="mt-4 max-w-[46ch] border-l-4 border-lamp bg-surface px-4 py-3 text-base text-text">
              {t(`banner.${failure}`)}
            </p>
          )}
          {status === "unavailable" && (
            <p role="status" data-testid="login-unavailable" className="mt-4 max-w-[46ch] bg-surface px-4 py-3 text-base text-text">{t("page.unavailable")}</p>
          )}
          <div className="about-load mt-6 flex flex-wrap gap-3" style={load(420)}>
            {PROVIDERS.map((p, i) => (
              <a
                key={p}
                href={`/api/auth/${p}/start?next=${encodeURIComponent(providerNext(next, locale))}`}
                className={`${i === 0 ? btnPrimary : btnQuiet} max-sm:w-full`}
              >
                {t("continueWith", { provider: t(`providers.${p}`) })}
              </a>
            ))}
          </div>
          <div className="about-load mt-4 flex flex-wrap gap-x-6 gap-y-1" style={load(500)}>
            <Link href="/" className="inline-flex min-h-11 items-center text-base text-text underline underline-offset-4 hover:text-lamp">{t("page.trial")}</Link>
            <Link href="/about" className="inline-flex min-h-11 items-center text-base text-ink2 underline underline-offset-4 hover:text-text">{t("page.about")}</Link>
          </div>
          <p className="about-load mt-2 max-w-[48ch] text-[15px] text-dim" style={load(580)}>{t("page.note", { total: GUEST_LIMIT })}</p>
        </div>
      </section>
      <aside className="about-stage-shape about-stage min-h-0 bg-stage px-[var(--pg)] py-4 md:col-span-5 md:py-10 md:pl-14">
        <Scene />
      </aside>
    </main>
  );
}

export function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Body />
    </Suspense>
  );
}
