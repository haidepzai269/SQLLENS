"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";
import { EngineTabs, type LockedId } from "./engine-tabs";
import { PanelToggles } from "./panel-toggles";
import { useShell } from "./shell-provider";

export function AppHeader() {
  const t = useTranslations("shell");
  const { hasWorkspace } = useShell();
  const [note, setNote] = useState<LockedId | null>(null);
  return (
    <>
      <a
        href={hasWorkspace ? "#stage" : "#content"}
        className="absolute -top-16 left-2 z-20 bg-text px-3 py-2 text-ground focus:top-2"
      >
        {t("skip")}
      </a>
      <header className="flex flex-none flex-wrap items-center border-b border-line bg-ground px-[var(--edge)] min-[901px]:flex-nowrap">
        <div className="flex h-[var(--h-top)] flex-none items-center gap-2 text-sm font-semibold">
          <svg viewBox="0 0 20 20" aria-hidden className="size-5">
            <circle cx="10" cy="10" r="8.5" fill="none" strokeWidth="1.5" className="stroke-text" />
            <path d="M10 6v3M10 9H6.5v2.5M10 9h3.5v2.5" fill="none" strokeWidth="1.2" className="stroke-text" />
            <rect x="8.5" y="4" width="3" height="3" className="fill-lamp" />
            <rect x="5" y="11.5" width="3" height="3" className="fill-text" />
            <rect x="12" y="11.5" width="3" height="3" className="fill-text" />
          </svg>
          <span>{t("appName")}</span>
        </div>
        <div className="h-[var(--h-top)] min-w-0 min-[901px]:ml-4 max-[900px]:order-5 max-[900px]:h-10 max-[900px]:w-full max-[900px]:border-t max-[900px]:border-line">
          <EngineTabs onNote={setNote} />
        </div>
        <div className="flex-1" />
        {hasWorkspace && (
          <div className="flex items-center max-[900px]:hidden">
            <PanelToggles />
            <div aria-hidden className="mx-2 h-5 w-px bg-line" />
          </div>
        )}
        <div className="flex h-[var(--h-top)] items-center">
          <LanguageSwitcher />
        </div>
      </header>
      <p
        role="status"
        className={note ? "flex-none border-b border-line bg-surface px-[var(--edge)] py-1 text-ink2" : "sr-only"}
      >
        {note && t("lockedReason", { engine: t(`engines.${note}`) })}
      </p>
    </>
  );
}
