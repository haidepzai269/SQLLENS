import { useTranslations } from "next-intl";
import { h2Style } from "./shell";
import { btnBase, LoginLink, ProductLink, Tag } from "./ui";

export function Labels() {
  const t = useTranslations("landing.labels");
  const rows = [
    { k: "real", tone: "bg-surface", body: t("realBody"), name: t("real") },
    { k: "sim", tone: "bg-raised", body: t("simBody"), name: t("sim") },
    { k: "est", tone: "bg-surface", body: t("estBody"), name: t("est") },
  ] as const;
  return (
    <section aria-labelledby="labels-h" className="bg-ground px-[var(--pg)] py-20 md:py-28">
      <h2 id="labels-h" className="max-w-[18ch] text-text" style={h2Style}>{t("title")}</h2>
      <p className="mt-4 text-base text-ink2 md:text-lg">{t("lead")}</p>
      <ul className="mt-12 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.k} data-reveal className={`${r.tone} grid items-center gap-4 p-6 md:grid-cols-12 md:gap-10 md:p-10`}>
            <div className="md:col-span-4 [&_span]:px-4 [&_span]:py-2 [&_span]:text-xl md:[&_span]:text-2xl"><Tag kind={r.k}>{r.name}</Tag></div>
            <p className="max-w-[56ch] text-lg leading-relaxed text-text md:col-span-8 md:text-xl">{r.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Limits() {
  const t = useTranslations("landing.limits");
  return (
    <section aria-labelledby="limits-h" className="bg-stage px-[var(--pg)] py-20 md:py-28">
      <div className="grid gap-10 md:grid-cols-12">
        <h2 id="limits-h" className="text-text md:col-span-4" style={h2Style}>{t("title")}</h2>
        <ul className="flex flex-col gap-10 md:col-span-8">
          {["l1", "l2", "l3"].map((k) => (
            <li key={k} data-reveal className="max-w-[40ch] text-text" style={{ fontSize: "clamp(22px, 2.3vw, 34px)", lineHeight: 1.25, letterSpacing: "-0.015em" }}>{t(k)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Cta() {
  const t = useTranslations("landing.cta");
  return (
    <section aria-labelledby="cta-h" className="bg-lamp px-[var(--pg)] py-20 text-lamp-ink md:py-32">
      <h2 id="cta-h" style={{ fontSize: "clamp(34px, 6vw, 96px)", lineHeight: 1, letterSpacing: "-0.04em", fontWeight: 600 }}>{t("title")}</h2>
      <p className="mt-6 max-w-[40ch] text-lg md:text-xl">{t("lead")}</p>
      <div className="mt-10 flex flex-wrap gap-3">
        <ProductLink label={t("open")} className={`${btnBase} bg-lamp-ink text-text hover:bg-stage`} />
        <LoginLink label={t("login")} className={`${btnBase} bg-lamp-ink/15 text-lamp-ink hover:bg-lamp-ink/25`} />
      </div>
    </section>
  );
}

export function Footer() {
  const t = useTranslations("landing.footer");
  return (
    <footer className="overflow-hidden bg-ground px-[var(--pg)] pb-8 pt-16">
      <p className="text-lg text-ink2 md:text-xl">{t("line")}</p>
      <p aria-hidden className="mt-6 select-none font-semibold text-text" style={{ fontSize: "clamp(56px, 19vw, 320px)", lineHeight: 0.85, letterSpacing: "-0.06em" }}>{t("name")}</p>
    </footer>
  );
}
