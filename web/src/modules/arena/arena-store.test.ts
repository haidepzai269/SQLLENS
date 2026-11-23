import { beforeEach, describe, expect, it } from "vitest";
import { useArenaStore } from "./arena-store";
import { getArenaScenario } from "./scenarios-data";

describe("ArenaStore (Zustand)", () => {
  beforeEach(() => {
    // Reset store về trạng thái mặc định trước mỗi test
    useArenaStore.setState({
      scenarioId: "deadlock_reverse_order",
      stepIndex: 0,
      isPlaying: false,
      autoPlaySpeedMs: 500,
    });
  });

  it("khởi tạo với kịch bản mặc định deadlock_reverse_order và bước 0", () => {
    const state = useArenaStore.getState();
    expect(state.scenarioId).toBe("deadlock_reverse_order");
    expect(state.stepIndex).toBe(0);
    expect(state.isPlaying).toBe(false);
    expect(state.autoPlaySpeedMs).toBe(500);
  });

  it("nextStep tăng bước và không vượt quá bước cuối cùng", () => {
    const { nextStep } = useArenaStore.getState();
    const config = getArenaScenario("deadlock_reverse_order");
    const maxStep = config.totalSteps - 1;

    // Bước 0 -> Bước 1
    nextStep();
    expect(useArenaStore.getState().stepIndex).toBe(1);

    // Chạy đến bước cuối
    for (let i = 0; i < maxStep + 5; i++) {
      useArenaStore.getState().nextStep();
    }
    expect(useArenaStore.getState().stepIndex).toBe(maxStep);
  });

  it("prevStep giảm bước và không xuống dưới 0 khi ở bước 0", () => {
    const { prevStep, setStep } = useArenaStore.getState();

    // Đang ở 0, bấm prev -> giữ nguyên 0
    prevStep();
    expect(useArenaStore.getState().stepIndex).toBe(0);

    // Đi tới bước 2 rồi lùi
    setStep(2);
    expect(useArenaStore.getState().stepIndex).toBe(2);

    prevStep();
    expect(useArenaStore.getState().stepIndex).toBe(1);

    prevStep();
    expect(useArenaStore.getState().stepIndex).toBe(0);

    prevStep();
    expect(useArenaStore.getState().stepIndex).toBe(0);
  });

  it("setScenario chuyển kịch bản, reset stepIndex về 0 và dừng auto-play", () => {
    // Giả sử đang ở bước 3 và đang auto-play
    useArenaStore.setState({
      stepIndex: 3,
      isPlaying: true,
    });

    useArenaStore.getState().setScenario("lost_update");

    const state = useArenaStore.getState();
    expect(state.scenarioId).toBe("lost_update");
    expect(state.stepIndex).toBe(0);
    expect(state.isPlaying).toBe(false);
  });

  it("setStep giới hạn clamp trong khoảng hợp lệ [0, totalSteps - 1]", () => {
    const { setStep } = useArenaStore.getState();
    const config = getArenaScenario("deadlock_reverse_order");
    const maxStep = config.totalSteps - 1;

    setStep(-5);
    expect(useArenaStore.getState().stepIndex).toBe(0);

    setStep(maxStep + 10);
    expect(useArenaStore.getState().stepIndex).toBe(maxStep);

    setStep(2);
    expect(useArenaStore.getState().stepIndex).toBe(2);
  });

  it("togglePlay bật tắt trạng thái isPlaying", () => {
    const { togglePlay } = useArenaStore.getState();

    expect(useArenaStore.getState().isPlaying).toBe(false);

    togglePlay();
    expect(useArenaStore.getState().isPlaying).toBe(true);

    togglePlay();
    expect(useArenaStore.getState().isPlaying).toBe(false);
  });

  it("đang ở bước cuối bấm togglePlay sẽ reset về 0 và bật play", () => {
    const config = getArenaScenario("deadlock_reverse_order");
    const maxStep = config.totalSteps - 1;

    useArenaStore.setState({
      stepIndex: maxStep,
      isPlaying: false,
    });

    useArenaStore.getState().togglePlay();

    const state = useArenaStore.getState();
    expect(state.stepIndex).toBe(0);
    expect(state.isPlaying).toBe(true);
  });

  it("nextStep tự động tắt isPlaying khi chạm tới bước cuối", () => {
    const config = getArenaScenario("deadlock_reverse_order");
    const penultimateStep = config.totalSteps - 2;

    useArenaStore.setState({
      stepIndex: penultimateStep,
      isPlaying: true,
    });

    useArenaStore.getState().nextStep();

    const state = useArenaStore.getState();
    expect(state.stepIndex).toBe(config.totalSteps - 1);
    expect(state.isPlaying).toBe(false);
  });

  it("pause dừng phát và reset đưa về bước 0", () => {
    useArenaStore.setState({
      stepIndex: 3,
      isPlaying: true,
    });

    useArenaStore.getState().pause();
    expect(useArenaStore.getState().isPlaying).toBe(false);
    expect(useArenaStore.getState().stepIndex).toBe(3);

    useArenaStore.getState().reset();
    expect(useArenaStore.getState().stepIndex).toBe(0);
    expect(useArenaStore.getState().isPlaying).toBe(false);
  });
});
