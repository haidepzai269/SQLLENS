import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import arenaEn from "../../../../messages/en/arena.json";
import arenaVi from "../../../../messages/vi/arena.json";
import { SCENARIOS } from "../../conflict-sim/engine/scenarios";
import { useArenaStore } from "../arena-store";
import { ScenarioPicker } from "./scenario-picker";

afterEach(cleanup);

const EXPECTED_SCENARIO_IDS = [
  "deadlock_reverse_order",
  "lost_update",
  "write_skew",
  "double_booking",
  "non_repeatable_read",
] as const;

function renderWithLocale(locale: "vi" | "en") {
  const messages = { arena: locale === "vi" ? arenaVi : arenaEn };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ScenarioPicker />
    </NextIntlClientProvider>
  );
}

describe("ScenarioPicker", () => {
  beforeEach(() => {
    useArenaStore.setState({
      scenarioId: "deadlock_reverse_order",
      stepIndex: 0,
      isPlaying: false,
      autoPlaySpeedMs: 500,
    });
  });

  it("AC4: liệt kê đúng 5 kịch bản chuẩn từ conflict-sim engine", () => {
    renderWithLocale("vi");

    const select = screen.getByTestId("arena-scenario-select") as HTMLSelectElement;
    expect(select).toBeTruthy();

    const options = Array.from(select.options).map((opt) => opt.value);

    // Khẳng định đúng 5 id
    expect(options).toHaveLength(5);
    for (const expectedId of EXPECTED_SCENARIO_IDS) {
      expect(options).toContain(expectedId);
      // Khẳng định kịch bản tồn tại trong SCENARIOS
      expect(SCENARIOS[expectedId]).toBeDefined();
    }
  });

  it("hiển thị tên kịch bản và mô tả bằng tiếng Việt", () => {
    renderWithLocale("vi");

    const select = screen.getByTestId("arena-scenario-select") as HTMLSelectElement;
    expect(select.value).toBe("deadlock_reverse_order");

    // Tên hiển thị từ i18n
    expect(screen.getByText(arenaVi.scenarios.deadlock_reverse_order)).toBeTruthy();

    // Mô tả ngắn
    const about = screen.getByTestId("arena-scenario-about");
    expect(about.textContent).toContain(arenaVi.scenarios.about.deadlock_reverse_order);
  });

  it("hiển thị tên kịch bản và mô tả bằng tiếng Anh", () => {
    renderWithLocale("en");

    const select = screen.getByTestId("arena-scenario-select") as HTMLSelectElement;
    expect(select.value).toBe("deadlock_reverse_order");

    expect(screen.getByText(arenaEn.scenarios.deadlock_reverse_order)).toBeTruthy();

    const about = screen.getByTestId("arena-scenario-about");
    expect(about.textContent).toContain(arenaEn.scenarios.about.deadlock_reverse_order);
  });

  it("chọn kịch bản khác cập nhật store và reset bước về 0", () => {
    useArenaStore.setState({
      stepIndex: 3,
      isPlaying: true,
    });

    renderWithLocale("vi");

    const select = screen.getByTestId("arena-scenario-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "lost_update" } });

    const state = useArenaStore.getState();
    expect(state.scenarioId).toBe("lost_update");
    expect(state.stepIndex).toBe(0);
    expect(state.isPlaying).toBe(false);
  });
});
