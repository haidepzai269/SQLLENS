import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import arenaEn from "../../../../messages/en/arena.json";
import arenaVi from "../../../../messages/vi/arena.json";
import { useArenaStore } from "../arena-store";
import { getArenaScenario } from "../scenarios-data";
import { StepController } from "./step-controller";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderWithLocale(locale: "vi" | "en" = "vi") {
  const messages = { arena: locale === "vi" ? arenaVi : arenaEn };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <StepController />
    </NextIntlClientProvider>
  );
}

describe("StepController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useArenaStore.setState({
      scenarioId: "deadlock_reverse_order",
      stepIndex: 0,
      isPlaying: false,
      autoPlaySpeedMs: 500,
    });
  });

  it("AC5: nút Bước trước disabled khi ở bước 0", () => {
    renderWithLocale("vi");

    const prevBtn = screen.getByTestId("arena-btn-prev");
    const nextBtn = screen.getByTestId("arena-btn-next");
    const resetBtn = screen.getByTestId("arena-btn-reset");

    expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);
    expect((resetBtn as HTMLButtonElement).disabled).toBe(true);

    // Tiến độ hiển thị: Bước 1 / 5
    expect(screen.getByTestId("arena-step-progress").textContent).toContain("Bước 1 / 5");
  });

  it("AC5: nút Bước sau disabled khi ở bước cuối", () => {
    const config = getArenaScenario("deadlock_reverse_order");
    const lastStep = config.totalSteps - 1;

    useArenaStore.setState({
      stepIndex: lastStep,
      isPlaying: false,
    });

    renderWithLocale("vi");

    const prevBtn = screen.getByTestId("arena-btn-prev");
    const nextBtn = screen.getByTestId("arena-btn-next");
    const resetBtn = screen.getByTestId("arena-btn-reset");

    expect((prevBtn as HTMLButtonElement).disabled).toBe(false);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
    expect((resetBtn as HTMLButtonElement).disabled).toBe(false);

    expect(screen.getByTestId("arena-step-progress").textContent).toContain(`Bước ${config.totalSteps} / ${config.totalSteps}`);
  });

  it("bấm nút Bước sau và Bước trước điều hướng đúng", () => {
    renderWithLocale("vi");

    const prevBtn = screen.getByTestId("arena-btn-prev");
    const nextBtn = screen.getByTestId("arena-btn-next");

    // Click Next -> lên bước 1 (index 1, hiển thị Bước 2)
    fireEvent.click(nextBtn);
    expect(useArenaStore.getState().stepIndex).toBe(1);
    expect(screen.getByTestId("arena-step-progress").textContent).toContain("Bước 2 / 5");

    // Click Prev -> về bước 0 (index 0, hiển thị Bước 1)
    fireEvent.click(prevBtn);
    expect(useArenaStore.getState().stepIndex).toBe(0);
    expect(screen.getByTestId("arena-step-progress").textContent).toContain("Bước 1 / 5");
  });

  it("bấm nút Về đầu reset bước về 0", () => {
    useArenaStore.setState({ stepIndex: 3 });

    renderWithLocale("vi");

    const resetBtn = screen.getByTestId("arena-btn-reset");
    fireEvent.click(resetBtn);

    expect(useArenaStore.getState().stepIndex).toBe(0);
  });

  it("AC5: Auto-play tự động tăng bước mỗi 500ms và tự dừng ở bước cuối", () => {
    renderWithLocale("vi");

    const playBtn = screen.getByTestId("arena-btn-play");
    const config = getArenaScenario("deadlock_reverse_order");
    const totalSteps = config.totalSteps;

    expect(useArenaStore.getState().stepIndex).toBe(0);
    expect(useArenaStore.getState().isPlaying).toBe(false);

    // Bấm Play
    fireEvent.click(playBtn);
    expect(useArenaStore.getState().isPlaying).toBe(true);

    // Sau 500ms -> lên bước 1
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useArenaStore.getState().stepIndex).toBe(1);

    // Sau 500ms nữa -> lên bước 2
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useArenaStore.getState().stepIndex).toBe(2);

    // Sau 500ms nữa -> lên bước 3
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useArenaStore.getState().stepIndex).toBe(3);

    // Sau 500ms nữa -> lên bước 4 (bước cuối cùng)
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useArenaStore.getState().stepIndex).toBe(totalSteps - 1);
    // Tự động dừng
    expect(useArenaStore.getState().isPlaying).toBe(false);

    // Thời gian trôi tiếp không làm tăng thêm
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(useArenaStore.getState().stepIndex).toBe(totalSteps - 1);
  });

  it("hiển thị nhãn nút song ngữ tiếng Anh", () => {
    renderWithLocale("en");

    expect(screen.getByText(arenaEn.controls.prev)).toBeTruthy();
    expect(screen.getByText(arenaEn.controls.play)).toBeTruthy();
    expect(screen.getByText(arenaEn.controls.next)).toBeTruthy();
    expect(screen.getByText(arenaEn.controls.reset)).toBeTruthy();
  });
});
