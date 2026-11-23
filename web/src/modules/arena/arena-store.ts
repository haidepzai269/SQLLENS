// Store quản lý trạng thái điều khiển kịch bản Deadlock Arena (STR116 / Task168).
// Lưu trạng thái hoàn toàn cục bộ trong Zustand, không gửi mạng, bảo toàn Core Rule 7.

import { create } from "zustand";
import type { ScenarioId } from "@/modules/conflict-sim/engine/types";
import { getArenaScenario } from "./scenarios-data";
import type { ArenaState } from "./types";

export const DEFAULT_ARENA_SCENARIO_ID: ScenarioId = "deadlock_reverse_order";
export const DEFAULT_ARENA_AUTOPLAY_SPEED_MS = 500;

export const useArenaStore = create<ArenaState>((set, get) => ({
  scenarioId: DEFAULT_ARENA_SCENARIO_ID,
  stepIndex: 0,
  isPlaying: false,
  autoPlaySpeedMs: DEFAULT_ARENA_AUTOPLAY_SPEED_MS,

  setScenario: (id: ScenarioId) => {
    // Đang auto-play mà người dùng chọn kịch bản khác: tự động pause và reset stepIndex về 0
    set({
      scenarioId: id,
      stepIndex: 0,
      isPlaying: false,
    });
  },

  nextStep: () => {
    const { scenarioId, stepIndex, isPlaying } = get();
    const scenario = getArenaScenario(scenarioId);
    const maxStep = scenario.totalSteps - 1;

    if (stepIndex >= maxStep) {
      if (isPlaying) {
        set({ isPlaying: false });
      }
      return;
    }

    const nextIndex = stepIndex + 1;
    const willReachEnd = nextIndex >= maxStep;

    set({
      stepIndex: nextIndex,
      // Tự động dừng auto-play khi chạm bước cuối
      isPlaying: willReachEnd ? false : isPlaying,
    });
  },

  prevStep: () => {
    const { stepIndex } = get();
    if (stepIndex <= 0) {
      return;
    }
    set({
      stepIndex: stepIndex - 1,
    });
  },

  setStep: (step: number) => {
    const { scenarioId, isPlaying } = get();
    const scenario = getArenaScenario(scenarioId);
    const maxStep = scenario.totalSteps - 1;
    const clamped = Math.max(0, Math.min(maxStep, step));

    set({
      stepIndex: clamped,
      isPlaying: clamped >= maxStep ? false : isPlaying,
    });
  },

  togglePlay: () => {
    const { isPlaying, stepIndex, scenarioId } = get();
    const scenario = getArenaScenario(scenarioId);
    const maxStep = scenario.totalSteps - 1;

    if (isPlaying) {
      set({ isPlaying: false });
    } else {
      // Nếu đang ở bước cuối mà bấm Play thì bắt đầu lại từ bước 0
      if (stepIndex >= maxStep) {
        set({ stepIndex: 0, isPlaying: true });
      } else {
        set({ isPlaying: true });
      }
    }
  },

  pause: () => {
    set({ isPlaying: false });
  },

  reset: () => {
    set({
      stepIndex: 0,
      isPlaying: false,
    });
  },
}));
