"use client";

// ScenarioPicker cho Deadlock Arena (STR116 / Task168).
// Liệt kê đúng 5 kịch bản từ SCENARIOS trong conflict-sim engine (AC4).
// Responsive trên mobile 390px, touch target >= 44px.

import { useTranslations } from "next-intl";
import type { ScenarioId } from "@/modules/conflict-sim/engine/types";
import { useArenaStore } from "../arena-store";
import { ARENA_SCENARIO_IDS, getArenaScenario } from "../scenarios-data";

export interface ScenarioPickerProps {
  className?: string;
  testId?: string;
}

export function ScenarioPicker({
  className,
  testId = "arena-scenario-picker",
}: ScenarioPickerProps) {
  const t = useTranslations("arena");
  const scenarioId = useArenaStore((s) => s.scenarioId);
  const setScenario = useArenaStore((s) => s.setScenario);

  const currentConfig = getArenaScenario(scenarioId);

  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 ${className ?? ""}`}
      data-testid={testId}
    >
      <label
        htmlFor="arena-scenario-select"
        className="text-xs font-semibold text-text"
      >
        {t("scenarios.label")}
      </label>
      <div className="relative min-w-0">
        <select
          id="arena-scenario-select"
          data-testid="arena-scenario-select"
          value={scenarioId}
          onChange={(e) => setScenario(e.target.value as ScenarioId)}
          className="h-11 w-full rounded border border-line bg-surface px-3 py-2 text-sm font-medium text-text shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring sm:h-9"
          aria-label={t("scenarios.label")}
        >
          {ARENA_SCENARIO_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`scenarios.${id}`)}
            </option>
          ))}
        </select>
      </div>
      <p
        className="m-0 text-xs text-dim leading-relaxed"
        data-testid="arena-scenario-about"
      >
        {t(currentConfig.aboutKey)}
      </p>
    </div>
  );
}
