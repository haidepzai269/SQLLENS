"use client";

import { useEffect } from "react";
import { AlertCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useEngineReleaseNotice } from "../engine-binding";

export function EngineReleaseToast() {
  const t = useTranslations("workspace");
  const { visible, dismiss } = useEngineReleaseNotice();

  // AC3: Tự ẩn sau 5 giây
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      dismiss();
    }, 5000);
    return () => clearTimeout(timer);
  }, [visible, dismiss]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="engine-release-toast"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-md animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="pointer-events-auto flex items-start gap-3 rounded-lg border border-amber-500/30 bg-surface p-3.5 shadow-lg">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-500" aria-hidden="true" />
        <div className="flex flex-col gap-1 pr-2">
          <p className="text-xs font-semibold text-text" data-testid="release-failed-title">
            {t("project.releaseFailed")}
          </p>
          <p className="text-[11px] text-dim leading-relaxed" data-testid="release-failed-desc">
            {t("project.releaseFailedDesc")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={dismiss}
          aria-label={t("dismiss")}
          data-testid="engine-release-toast-dismiss"
          className="size-6 shrink-0 text-dim hover:text-text"
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
