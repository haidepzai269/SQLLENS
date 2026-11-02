"use client";

import { Network, PanelBottom, PanelLeft, PanelRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { isLastOpen, ZONES, type Zone } from "./layout-state";
import { useShell } from "./shell-provider";

const ICON: Record<Zone, typeof Network> = { sql: PanelLeft, stage: Network, findings: PanelRight, terminal: PanelBottom };

// Vùng cuối còn bật thì khóa nút (aria-disabled), nên không bao giờ có màn hình trống.
export function PanelToggles() {
  const t = useTranslations("shell");
  const { state, toggle } = useShell();
  return (
    <div role="group" aria-label={t("toggles.label")} className="flex items-center gap-0.5">
      {ZONES.map((z) => {
        const Icon = ICON[z];
        const last = isLastOpen(state, z);
        return (
          <Button
            key={z}
            variant="ghost"
            size="icon-sm"
            aria-pressed={state.open[z]}
            aria-disabled={last || undefined}
            aria-label={t(`zone.${z}`)}
            title={last ? t("toggles.lastOpen") : t(`zone.${z}`)}
            onClick={() => toggle(z)}
            className={
              "relative w-8 text-dim aria-pressed:text-text aria-disabled:cursor-not-allowed aria-disabled:opacity-60 " +
              "aria-pressed:after:absolute aria-pressed:after:inset-x-2 aria-pressed:after:-bottom-2 aria-pressed:after:h-px aria-pressed:after:bg-lamp"
            }
          >
            <Icon aria-hidden />
          </Button>
        );
      })}
    </div>
  );
}
