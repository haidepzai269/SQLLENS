"use client";

import { Network, PanelBottom, PanelLeft, PanelRight, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isLastOpen, ZONES, type Zone } from "./layout-state";
import { useShell } from "./shell-provider";
import { Tip } from "./tip";

const ICON: Record<Zone, typeof Network> = { sql: PanelLeft, stage: Network, findings: PanelRight, terminal: PanelBottom };

// Một nút bánh răng thay bốn icon. Vùng cuối còn bật thì mục đó bị khóa, nên không bao giờ có màn hình trống.
export function PanelToggles() {
  const t = useTranslations("shell");
  const { state, toggle } = useShell();
  const lastOpen = ZONES.some((z) => isLastOpen(state, z));
  return (
    <DropdownMenu>
      <Tip label={t("tip.layout")}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("toggles.menu")}
              className="text-dim hover:text-text data-popup-open:text-text *:transition-transform *:duration-300 *:ease-out data-popup-open:*:rotate-90"
            />
          }
        >
          <Settings aria-hidden />
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("toggles.label")}</DropdownMenuLabel>
          {ZONES.map((z) => {
            const Icon = ICON[z];
            const on = state.open[z];
            return (
              <DropdownMenuCheckboxItem
                key={z}
                checked={on}
                closeOnClick={false}
                disabled={isLastOpen(state, z)}
                onCheckedChange={() => toggle(z)}
              >
                <Icon aria-hidden />
                <span className="flex-1">{t(`zone.${z}`)}</span>
                <span className="pr-1 text-xs text-muted-foreground">{on ? t("toggles.on") : t("toggles.off")}</span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
        {lastOpen && <p role="note" className="px-1.5 py-1 text-xs text-muted-foreground">{t("toggles.lastOpen")}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
