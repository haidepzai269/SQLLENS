"use client";

// ArenaView cho Deadlock Arena (STR116 / Task168).
// View ghép nối ScenarioPicker, StepController, SimulationBadge (AC1, AC2, AC6).
// Responsive trên mobile 390px, touch target >= 44px, không tràn ngang.

import { useTranslations } from "next-intl";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useArenaStore } from "../arena-store";
import { useArenaSync, type ArenaRole } from "../arena-sync";
import { ArenaWaitGraph } from "../graph/arena-wait-graph";
import { clampArenaStepIndex } from "../graph/graph-elements";
import { getArenaScenario } from "../scenarios-data";
import { ScenarioPicker } from "./scenario-picker";
import { StepController } from "./step-controller";
import { SimulationBadge } from "./simulation-badge";

export interface ArenaViewProps {
  className?: string;
  testId?: string;
  roomId?: string;
  role?: ArenaRole;
  fetchImpl?: typeof fetch;
}

const TX_STATUS_STYLES: Record<string, string> = {
  idle: "border-line text-dim bg-surface",
  active: "border-label-real text-text bg-label-real/10",
  waiting: "border-severity-uncertain text-severity-uncertain bg-severity-uncertain/10",
  aborted: "border-dashed border-severity-broken text-severity-broken bg-destructive/10",
  committed: "border-line text-dim bg-surface",
};

export function ArenaView({
  className,
  testId = "arena-view",
  roomId,
  role,
  fetchImpl,
}: ArenaViewProps) {
  const t = useTranslations("arena");
  const scenarioId = useArenaStore((s) => s.scenarioId);
  const stepIndex = useArenaStore((s) => s.stepIndex);

  useArenaSync({ roomId, role, fetchImpl });

  const scenarioConfig = getArenaScenario(scenarioId);
  const safeStepIndex = clampArenaStepIndex(stepIndex, scenarioConfig.totalSteps);
  const currentStep = scenarioConfig.steps[safeStepIndex] ?? scenarioConfig.steps[0];
  const txA = currentStep.transactions.A;
  const txB = currentStep.transactions.B;
  const isViewer = role === "viewer";

  return (
    <div
      className={`mx-auto flex w-full max-w-5xl flex-col gap-4 p-3 sm:p-6 overflow-x-hidden ${
        className ?? ""
      }`}
      data-testid={testId}
    >
      {/* Header khu vực Arena */}
      <header className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 text-lg font-bold tracking-tight text-text sm:text-xl">
              {t("title")}
            </h1>
            {/* Nhãn Mô phỏng bắt buộc luôn hiển thị ở header (AC2) */}
            <SimulationBadge testId="arena-header-simulation-badge" />
          </div>
          <p className="m-0 text-xs text-dim">{t("subtitle")}</p>
        </div>
      </header>

      {/* Khu vực điều khiển: ScenarioPicker + StepController (hoặc trạng thái Viewer) */}
      {isViewer ? (
        <div
          className="rounded-lg border border-line bg-surface p-3 text-xs text-dim sm:p-4"
          data-testid="arena-viewer-sync-note"
        >
          {t("sync.viewerNote")}
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ScenarioPicker testId="arena-picker" />
            <StepController testId="arena-controller" />
          </div>
          {role === "host" && roomId && (
            <p className="m-0 text-xs text-dim" data-testid="arena-host-sync-note">
              {t("sync.hostNote")}
            </p>
          )}
        </div>
      )}

      {/* Thông tin bước hiện tại */}
      <Card className="border border-line bg-surface shadow-none">
        <CardHeader className="p-3 pb-2 sm:p-4 sm:pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className="text-xs font-semibold uppercase tracking-wider text-dim"
              data-testid="arena-step-indicator"
            >
              {t("view.currentStep", { step: safeStepIndex + 1 })}
            </span>
            {currentStep.deadlockDetected && (
              <span
                className="inline-flex items-center gap-1 rounded bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-severity-broken"
                data-testid="arena-deadlock-badge"
              >
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                {t("view.deadlockAlert")}
              </span>
            )}
          </div>
          <CardTitle className="text-sm font-bold text-text sm:text-base">
            {t(currentStep.titleKey)}
          </CardTitle>
          <p className="m-0 text-xs text-dim leading-relaxed">
            {t(currentStep.descriptionKey)}
          </p>
        </CardHeader>

        <CardContent className="flex flex-col gap-3 p-3 pt-0 sm:p-4 sm:pt-0">
          {/* Cảnh báo Deadlock khi ở bước 3 của deadlock_reverse_order (AC1) */}
          {currentStep.deadlockDetected && (
            <div
              className="flex items-start gap-2.5 rounded border border-dashed border-severity-broken bg-destructive/10 p-3 text-xs text-severity-broken"
              role="alert"
              data-testid="arena-deadlock-alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="flex flex-col gap-0.5">
                <strong className="font-bold">
                  {t("view.deadlockAlert")} {currentStep.sqlstate ? `(${currentStep.sqlstate})` : ""}
                </strong>
                <p className="m-0 text-xs opacity-90 leading-relaxed">
                  {t("view.deadlockDetail")}
                </p>
              </div>
            </div>
          )}

          {/* Đồ thị Cytoscape Wait-For Graph */}
          <ArenaWaitGraph step={currentStep} />

          {/* Danh sách 2 Transaction tại bước này */}
          <div className="flex flex-col gap-2">
            <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-dim">
              {t("view.transactionsTitle")}
            </h2>
            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              data-testid="arena-transactions-grid"
            >
              {/* Transaction A */}
              <div
                className={`flex flex-col gap-2 rounded border p-3 ${
                  TX_STATUS_STYLES[txA.status] ?? "border-line"
                }`}
                data-testid="arena-tx-A"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-text">
                    {t("view.sessionA")}
                  </span>
                  <span
                    className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
                    data-testid="arena-tx-status-A"
                  >
                    {t(`view.status.${txA.status}`)}
                  </span>
                </div>
                <div className="rounded bg-background p-2">
                  <code
                    className="block font-mono text-xs text-text break-words whitespace-pre-wrap"
                    data-testid="arena-tx-sql-A"
                  >
                    {txA.sql}
                  </code>
                </div>
              </div>

              {/* Transaction B */}
              <div
                className={`flex flex-col gap-2 rounded border p-3 ${
                  TX_STATUS_STYLES[txB.status] ?? "border-line"
                }`}
                data-testid="arena-tx-B"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-text">
                    {t("view.sessionB")}
                  </span>
                  <span
                    className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
                    data-testid="arena-tx-status-B"
                  >
                    {t(`view.status.${txB.status}`)}
                  </span>
                </div>
                <div className="rounded bg-background p-2">
                  <code
                    className="block font-mono text-xs text-text break-words whitespace-pre-wrap"
                    data-testid="arena-tx-sql-B"
                  >
                    {txB.sql}
                  </code>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
