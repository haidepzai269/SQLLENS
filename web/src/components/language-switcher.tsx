"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export function LanguageSwitcher() {
  const t = useTranslations("common.language");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  // Đọc query lúc bấm để khỏi cần Suspense cho useSearchParams.
  const change = (next: (typeof routing.locales)[number]) =>
    router.replace(`${pathname}${window.location.search}${window.location.hash}`, { locale: next });

  return (
    <div role="group" aria-label={t("label")} className="flex gap-1">
      {routing.locales.map((l) => (
        <Button
          key={l}
          size="sm"
          variant={l === locale ? "default" : "outline"}
          aria-pressed={l === locale}
          lang={l}
          onClick={() => change(l)}
        >
          {t(l)}
        </Button>
      ))}
    </div>
  );
}
