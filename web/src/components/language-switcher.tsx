"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Tip } from "@/components/shell/tip";
import { routing } from "@/i18n/routing";

export function LanguageSwitcher() {
  const t = useTranslations("common.language");
  const ts = useTranslations("shell.tip.language");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  // Đọc query lúc bấm để khỏi cần Suspense cho useSearchParams. Giữ cả tham số engine và hash.
  const change = (next: (typeof routing.locales)[number]) =>
    router.replace(`${pathname}${window.location.search}${window.location.hash}`, { locale: next });

  return (
    <div role="group" aria-label={t("label")} className="flex h-full">
      {routing.locales.map((l) => (
        <Tip key={l} label={ts(l)}>
        <button
          type="button"
          aria-pressed={l === locale}
          aria-label={t(l)}
          lang={l}
          onClick={() => change(l)}
          className="relative min-h-9 px-2 text-dim hover:text-text aria-pressed:font-medium aria-pressed:text-text aria-pressed:after:absolute aria-pressed:after:inset-x-2 aria-pressed:after:bottom-0 aria-pressed:after:h-px aria-pressed:after:bg-lamp"
        >
          {l.toUpperCase()}
        </button>
        </Tip>
      ))}
    </div>
  );
}
