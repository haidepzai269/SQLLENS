"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface NatWarningBannerProps {
  visible: boolean;
  className?: string;
}

/**
 * Banner cảnh báo khi kết nối WebRTC P2P thất bại sau 10 giây (Symmetric NAT / firewall).
 */
export function NatWarningBanner({ visible, className }: NatWarningBannerProps) {
  const t = useTranslations("room.p2p");

  if (!visible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="nat-warning-banner"
      className={cn(
        "flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <p className="min-w-0 break-words leading-relaxed">{t("natWarning")}</p>
    </div>
  );
}
