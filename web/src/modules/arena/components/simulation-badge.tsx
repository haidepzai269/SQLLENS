"use client";

// SimulationBadge cho Deadlock Arena (STR116 / Task168).
// BẮT BUỘC hiển thị nhãn "Mô phỏng" theo Nguyên tắc 1 của SQLLens.
// Không có tùy chọn ẩn (AC2).

import { useTranslations } from "next-intl";
import { ConclusionBadge } from "@/components/ui/conclusion-badge";

export interface SimulationBadgeProps {
  className?: string;
  testId?: string;
}

export function SimulationBadge({
  className,
  testId = "arena-simulation-badge",
}: SimulationBadgeProps) {
  const t = useTranslations("arena");

  return (
    <ConclusionBadge
      label="simulated"
      note={t("simulationBadgeNote")}
      testId={testId}
      className={className}
    />
  );
}
