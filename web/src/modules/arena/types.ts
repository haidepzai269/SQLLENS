// Định nghĩa kiểu dữ liệu cho Deadlock Arena (STR116 / Task168).
// Tuyệt đối không lưu, không log, không gửi SQL người dùng ra mạng (Core Rule 7).

import type { ScenarioId } from "@/modules/conflict-sim/engine/types";

export type ArenaTxStatus = "idle" | "active" | "waiting" | "aborted" | "committed";

export interface ArenaTxStepInfo {
  session: "A" | "B";
  sql: string;
  status: ArenaTxStatus;
  detailKey?: string;
}

export interface ArenaScenarioStep {
  stepIndex: number;
  titleKey: string;
  descriptionKey: string;
  transactions: {
    A: ArenaTxStepInfo;
    B: ArenaTxStepInfo;
  };
  deadlockDetected?: boolean;
  conflictDetected?: boolean;
  errorMessageKey?: string;
  sqlstate?: string;
}

export interface ArenaScenarioConfig {
  id: ScenarioId;
  nameKey: string;
  aboutKey: string;
  totalSteps: number;
  steps: ArenaScenarioStep[];
}

export interface ArenaState {
  scenarioId: ScenarioId;
  stepIndex: number;
  isPlaying: boolean;
  autoPlaySpeedMs: number; // default: 500ms
  setScenario: (id: ScenarioId) => void;
  nextStep: () => void;
  prevStep: () => void;
  setStep: (step: number) => void;
  togglePlay: () => void;
  pause: () => void;
  reset: () => void;
}
