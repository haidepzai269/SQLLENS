"use client";

// Panel AI Mentor cho Deadlock Arena (SP024 / STR116 / Task170).
// Chỉ hiển thị với người dùng VIP (isVip === true), luôn gắn nhãn Mô phỏng ở kết quả.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useArenaStore } from "../arena-store";
import { SimulationBadge } from "../components/simulation-badge";
import {
  analyzeArenaStepWithMentor,
  type ArenaMentorErrorKind,
} from "./arena-mentor-prompt";

export interface ArenaMentorPanelProps {
  isVip?: boolean;
  fetchImpl?: typeof fetch;
  className?: string;
}

export function ArenaMentorPanel({
  isVip,
  fetchImpl,
  className,
}: ArenaMentorPanelProps) {
  const t = useTranslations("arena");
  const locale = useLocale();
  const scenarioId = useArenaStore((s) => s.scenarioId);
  const stepIndex = useArenaStore((s) => s.stepIndex);

  const contextKey = `${scenarioId}:${stepIndex}`;
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    analysis: string | null;
    errorKind: Exclude<ArenaMentorErrorKind, "aborted"> | null;
  }>({
    key: contextKey,
    loading: false,
    analysis: null,
    errorKind: null,
  });
  const abortControllerRef = useRef<AbortController | null>(null);

  const isCurrentContext = state.key === contextKey;
  const loading = isCurrentContext ? state.loading : false;
  const analysis = isCurrentContext ? state.analysis : null;
  const errorKind = isCurrentContext ? state.errorKind : null;

  // Cleanup: hủy request đang chạy khi đổi kịch bản/bước hoặc unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [contextKey]);

  const handleAnalyze = useCallback(async () => {
    if (isVip !== true) {
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestKey = contextKey;

    setState({
      key: requestKey,
      loading: true,
      analysis: null,
      errorKind: null,
    });

    const result = await analyzeArenaStepWithMentor(
      {
        scenarioId,
        stepIndex,
        locale,
        signal: controller.signal,
      },
      fetchImpl
    );

    if (abortControllerRef.current !== controller) {
      return;
    }

    if (result.ok) {
      setState({
        key: requestKey,
        loading: false,
        analysis: result.analysis,
        errorKind: null,
      });
    } else if (result.errorKind !== "aborted") {
      setState({
        key: requestKey,
        loading: false,
        analysis: null,
        errorKind: result.errorKind,
      });
    }
  }, [contextKey, fetchImpl, isVip, locale, scenarioId, stepIndex]);

  if (isVip !== true) {
    return null;
  }

  return (
    <section
      className={`flex flex-col gap-3 ${className ?? ""}`}
      data-testid="arena-mentor-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void handleAnalyze();
          }}
          disabled={loading}
          className="min-h-[44px] w-full sm:w-auto gap-2 border-line bg-surface text-text hover:bg-muted"
          data-testid="arena-mentor-trigger"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          <span>{loading ? t("mentor.analyzing") : t("mentor.trigger")}</span>
        </Button>
      </div>

      {errorKind && (
        <div
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-severity-broken sm:flex-row sm:items-center sm:justify-between"
          role="alert"
          data-testid="arena-mentor-error"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="break-words">{t(`mentor.errors.${errorKind}`)}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void handleAnalyze();
            }}
            className="min-h-[36px] shrink-0 gap-1.5 self-start sm:self-auto"
            data-testid="arena-mentor-retry"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            <span>{t("mentor.retry")}</span>
          </Button>
        </div>
      )}

      {analysis && (
        <Card
          className="border border-line bg-surface shadow-none"
          data-testid="arena-mentor-result"
        >
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 p-3 pb-2 sm:p-4 sm:pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-dim">
              {t("mentor.resultTitle")}
            </CardTitle>
            <SimulationBadge testId="arena-mentor-simulation-badge" />
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
            <p className="m-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-text sm:text-sm">
              {analysis}
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
