"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

export type ConclusionLabelType = "real" | "simulated" | "estimated" | "not_simulated";

export interface ConclusionBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  label: ConclusionLabelType;
  /** Tùy chọn override ghi chú giải thích trong tooltip */
  note?: string;
  testId?: string;
}

const BADGE_STYLES: Record<ConclusionLabelType, string> = {
  real: "bg-label-real text-label-real-foreground border-transparent",
  simulated: "border border-label-simulated text-white bg-transparent",
  estimated: "border border-dashed border-label-estimated italic text-white bg-transparent",
  not_simulated: "border border-severity-uncertain text-severity-uncertain bg-transparent",
};

/**
 * ConclusionBadge: Hiển thị nhãn kết luận chuẩn hóa kèm Tooltip giải thích tường minh
 * nguồn gốc dữ liệu theo Nguyên tắc 1 & 2 của SQLLens.
 * Tuyệt đối không bao giờ đánh giá "thiết kế này ổn/tốt/xấu".
 */
export function ConclusionBadge({
  label,
  note,
  className,
  testId = "conclusion-badge",
  ...props
}: ConclusionBadgeProps) {
  const t = useTranslations("common.conclusionLabels");

  const labelTexts: Record<ConclusionLabelType, { name: string; tooltip: string }> = {
    real: {
      name: t("real.name"),
      tooltip: note ?? t("real.tooltip"),
    },
    simulated: {
      name: t("simulated.name"),
      tooltip: note ?? t("simulated.tooltip"),
    },
    estimated: {
      name: t("estimated.name"),
      tooltip: note ?? t("estimated.tooltip"),
    },
    not_simulated: {
      name: t("not_simulated.name"),
      tooltip: note ?? t("not_simulated.tooltip"),
    },
  };

  const current = labelTexts[label];

  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              {...props}
              data-testid={testId}
              data-label={label}
              className={cn(
                "inline-flex h-5 cursor-help items-center rounded-[2px] px-[7px] text-xs font-medium select-none",
                BADGE_STYLES[label],
                className
              )}
            >
              {current.name}
            </span>
          }
        />
        <TooltipContent
          side="top"
          className="max-w-xs text-xs font-normal leading-relaxed"
          data-testid={`${testId}-tooltip`}
        >
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-text">{current.name}</span>
            <p className="m-0 text-dim">{current.tooltip}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
