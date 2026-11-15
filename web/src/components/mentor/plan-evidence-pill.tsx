"use client";

import React, { useCallback } from "react";
import { Loader2, Zap, Database } from "lucide-react";
import { useTranslations } from "next-intl";
import type { EngineId } from "@/contracts/engine";
import { cn } from "cn";

export const PLAN_EVIDENCE_STORAGE_KEY = "sqllens_plan_evidence_enabled";

export interface PlanEvidencePillProps {
  isAttached: boolean;
  isMeasuring?: boolean;
  onToggle?: (enabled: boolean) => void;
  engine: "postgres" | "mysql" | EngineId;
  className?: string;
}

export function PlanEvidencePill({
  isAttached,
  isMeasuring = false,
  onToggle,
  engine,
  className,
}: PlanEvidencePillProps) {
  const t = useTranslations("mentor");

  const handleClick = useCallback(() => {
    if (engine === "mysql" || isMeasuring) {
      return;
    }

    const nextState = !isAttached;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(PLAN_EVIDENCE_STORAGE_KEY, String(nextState));
      }
    } catch {
      // Safe fallback khi môi trường hạn chế localStorage
    }

    onToggle?.(nextState);
  }, [engine, isMeasuring, isAttached, onToggle]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (engine === "mysql" || isMeasuring) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        handleClick();
      }
    },
    [engine, isMeasuring, handleClick]
  );

  // Trường hợp Engine MySQL: Không chạy tự động, hiển thị badge hướng dẫn bấm nút phân tích
  if (engine === "mysql") {
    return (
      <div
        data-testid="plan-evidence-pill"
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium",
          "border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 select-none",
          className
        )}
      >
        <Database className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="truncate">{t("planPill.mysqlPrompt")}</span>
      </div>
    );
  }

  // Trường hợp PostgreSQL đang đo lường trong Web Worker (3-5ms)
  if (isMeasuring) {
    return (
      <div
        data-testid="plan-evidence-pill"
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium",
          "border border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300 select-none animate-pulse",
          className
        )}
      >
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-teal-600 dark:text-teal-400" />
        <span className="truncate">{t("planPill.measuring")}</span>
      </div>
    );
  }

  // Trường hợp PostgreSQL: Toggle Switch bật/tắt Plan
  return (
    <button
      type="button"
      data-testid="plan-evidence-pill"
      role="switch"
      aria-checked={isAttached}
      aria-label={t("planPill.toggleAria")}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium transition-all duration-150 cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        isAttached
          ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 shadow-xs"
          : "border border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/70",
        className
      )}
    >
      <Zap
        className={cn(
          "h-3 w-3 shrink-0 transition-colors",
          isAttached
            ? "fill-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            : "text-muted-foreground/60"
        )}
      />
      <span className="truncate">
        {isAttached ? t("planPill.attached") : t("planPill.off")}
      </span>
    </button>
  );
}
