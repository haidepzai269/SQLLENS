"use client";

// StepController cho Deadlock Arena (STR116 / Task168).
// Điều khiển Trước / Sau / Auto-Play (500ms) / Về đầu (AC5).
// Responsive trên mobile 390px, touch target >= 44px.

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Play, Pause, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useArenaStore } from "../arena-store";
import { getArenaScenario } from "../scenarios-data";

export interface StepControllerProps {
  className?: string;
  testId?: string;
}

export function StepController({
  className,
  testId = "arena-step-controller",
}: StepControllerProps) {
  const t = useTranslations("arena");
  const scenarioId = useArenaStore((s) => s.scenarioId);
  const stepIndex = useArenaStore((s) => s.stepIndex);
  const isPlaying = useArenaStore((s) => s.isPlaying);
  const autoPlaySpeedMs = useArenaStore((s) => s.autoPlaySpeedMs);

  const nextStep = useArenaStore((s) => s.nextStep);
  const prevStep = useArenaStore((s) => s.prevStep);
  const togglePlay = useArenaStore((s) => s.togglePlay);
  const reset = useArenaStore((s) => s.reset);

  const scenarioConfig = getArenaScenario(scenarioId);
  const totalSteps = scenarioConfig.totalSteps;
  const isAtFirstStep = stepIndex <= 0;
  const isAtLastStep = stepIndex >= totalSteps - 1;

  // Auto-play timer loop
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const timer = setInterval(() => {
      useArenaStore.getState().nextStep();
    }, autoPlaySpeedMs);

    return () => {
      clearInterval(timer);
    };
  }, [isPlaying, autoPlaySpeedMs]);

  return (
    <div
      className={`flex min-w-0 flex-col gap-2 ${className ?? ""}`}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className="text-xs font-semibold text-text"
          data-testid="arena-step-progress"
        >
          {t("controls.stepProgress", {
            current: stepIndex + 1,
            total: totalSteps,
          })}
        </span>
        <span className="text-[11px] text-dim">
          {t("controls.speed", { speed: autoPlaySpeedMs })}
        </span>
      </div>

      {/* Thanh tiến trình bước (step progress dots) */}
      <div
        className="flex w-full items-center gap-1 py-1"
        role="progressbar"
        aria-valuenow={stepIndex + 1}
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuetext={t("controls.stepProgress", {
          current: stepIndex + 1,
          total: totalSteps,
        })}
      >
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
              i <= stepIndex
                ? "bg-primary"
                : "bg-surface-elevated border border-line"
            }`}
          />
        ))}
      </div>

      {/* Cụm nút điều khiển */}
      <div
        role="group"
        aria-label={t("controls.play")}
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"
      >
        <Button
          type="button"
          variant="outline"
          onClick={prevStep}
          disabled={isAtFirstStep || isPlaying}
          data-testid="arena-btn-prev"
          aria-label={t("controls.prev")}
          className="h-11 min-h-[44px] gap-1.5 text-xs sm:h-9 sm:min-h-0"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span>{t("controls.prev")}</span>
        </Button>

        <Button
          type="button"
          variant={isPlaying ? "destructive" : "default"}
          onClick={togglePlay}
          data-testid="arena-btn-play"
          aria-label={isPlaying ? t("controls.pause") : t("controls.play")}
          className="h-11 min-h-[44px] gap-1.5 text-xs font-medium sm:h-9 sm:min-h-0"
        >
          {isPlaying ? (
            <>
              <Pause className="h-4 w-4" aria-hidden />
              <span>{t("controls.pause")}</span>
            </>
          ) : (
            <>
              <Play className="h-4 w-4" aria-hidden />
              <span>{t("controls.play")}</span>
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={nextStep}
          disabled={isAtLastStep || isPlaying}
          data-testid="arena-btn-next"
          aria-label={t("controls.next")}
          className="h-11 min-h-[44px] gap-1.5 text-xs sm:h-9 sm:min-h-0"
        >
          <span>{t("controls.next")}</span>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={reset}
          disabled={isAtFirstStep && !isPlaying}
          data-testid="arena-btn-reset"
          aria-label={t("controls.reset")}
          className="h-11 min-h-[44px] gap-1.5 text-xs sm:h-9 sm:min-h-0"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          <span>{t("controls.reset")}</span>
        </Button>
      </div>
    </div>
  );
}
