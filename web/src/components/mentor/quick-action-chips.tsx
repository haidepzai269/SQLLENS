"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export interface QuickActionChipsProps {
  onTrigger: (prompt: string) => void;
  isPlanReady?: boolean;
  disabled?: boolean;
  isBusy?: boolean;
  className?: string;
}

export function QuickActionChips({
  onTrigger,
  isPlanReady = false,
  disabled = false,
  isBusy = false,
  className,
}: QuickActionChipsProps) {
  const t = useTranslations("mentor");

  const chips = [
    {
      id: "slow",
      testId: "chip-slow",
      promptKey: "quickChips.slow" as const,
    },
    {
      id: "index",
      testId: "chip-index",
      promptKey: "quickChips.index" as const,
    },
    {
      id: "buffers",
      testId: "chip-buffers",
      promptKey: "quickChips.buffers" as const,
    },
  ];

  const isDisabled = disabled || isBusy;

  return (
    <div
      data-testid="quick-action-chips"
      role="group"
      aria-label="Quick Action Suggestions"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {chips.map((chip) => {
        const text = t(chip.promptKey);
        return (
          <Button
            key={chip.id}
            type="button"
            variant="outline"
            size="sm"
            data-testid={chip.testId}
            disabled={isDisabled}
            onClick={() => onTrigger(text)}
            className={cn(
              "h-7 rounded-full px-2.5 text-xs font-normal transition-colors",
              "border-border/70 hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300",
              isPlanReady && "border-emerald-500/30 bg-emerald-500/5",
              isDisabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {text}
          </Button>
        );
      })}
    </div>
  );
}
