import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import arenaEn from "../../../../messages/en/arena.json";
import arenaVi from "../../../../messages/vi/arena.json";
import commonEn from "../../../../messages/en/common.json";
import commonVi from "../../../../messages/vi/common.json";
import { useArenaStore } from "../arena-store";
import { ArenaView } from "./arena-view";

afterEach(cleanup);

function renderArenaView(locale: "vi" | "en" = "vi") {
  const messages = {
    arena: locale === "vi" ? arenaVi : arenaEn,
    common: locale === "vi" ? commonVi : commonEn,
  };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ArenaView />
    </NextIntlClientProvider>
  );
}

describe("ArenaView", () => {
  beforeEach(() => {
    useArenaStore.setState({
      scenarioId: "deadlock_reverse_order",
      stepIndex: 0,
      isPlaying: false,
      autoPlaySpeedMs: 500,
    });
  });

  it("AC2: Nhãn Mô phỏng (Simulation) luôn hiển thị ở header giao diện Arena, không thể ẩn", () => {
    renderArenaView("vi");

    const badge = screen.getByTestId("arena-header-simulation-badge");
    expect(badge).toBeTruthy();
    // Bắt buộc hiển thị nhãn "Mô phỏng" (hoặc label="simulated")
    expect(badge.getAttribute("data-label")).toBe("simulated");
    expect(badge.textContent).toContain("Mô phỏng");
  });

  it("AC2: Nhãn Simulation hiển thị chính xác ở locale tiếng Anh", () => {
    renderArenaView("en");

    const badge = screen.getByTestId("arena-header-simulation-badge");
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("data-label")).toBe("simulated");
    expect(badge.textContent).toContain("Simulated");
  });

  it("AC1: deadlock_reverse_order -> thấy bước 1 với 2 transaction; bước 3 hiện deadlock detected", () => {
    renderArenaView("vi");

    // Chọn kịch bản deadlock_reverse_order (đã là mặc định)
    expect(useArenaStore.getState().scenarioId).toBe("deadlock_reverse_order");

    // Chuyển sang Bước 1 (index 1)
    const nextBtn = screen.getByTestId("arena-btn-next");
    fireEvent.click(nextBtn);
    expect(useArenaStore.getState().stepIndex).toBe(1);

    // Ở Bước 1: Có 2 transaction hiển thị (Giao dịch A và Giao dịch B)
    const txA = screen.getByTestId("arena-tx-A");
    const txB = screen.getByTestId("arena-tx-B");
    expect(txA).toBeTruthy();
    expect(txB).toBeTruthy();

    const sqlA = screen.getByTestId("arena-tx-sql-A");
    const sqlB = screen.getByTestId("arena-tx-sql-B");
    expect(sqlA.textContent).toContain("BEGIN");
    expect(sqlB.textContent).toContain("BEGIN");

    const statusA = screen.getByTestId("arena-tx-status-A");
    const statusB = screen.getByTestId("arena-tx-status-B");
    expect(statusA.textContent).toContain("Đang chạy");
    expect(statusB.textContent).toContain("Đang chạy");

    // Ở Bước 1: Chưa có deadlock alert
    expect(screen.queryByTestId("arena-deadlock-alert")).toBeNull();

    // Đi tiếp tới Bước 2
    fireEvent.click(nextBtn);
    expect(useArenaStore.getState().stepIndex).toBe(2);
    expect(screen.queryByTestId("arena-deadlock-alert")).toBeNull();

    // Đi tiếp tới Bước 3
    fireEvent.click(nextBtn);
    expect(useArenaStore.getState().stepIndex).toBe(3);

    // Ở Bước 3: Hiện thông báo deadlock detected!
    const alert = screen.getByTestId("arena-deadlock-alert");
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain("deadlock detected");
    expect(alert.textContent).toContain("40P01");

    // Kiểm tra badge deadlock ở header card
    const deadlockBadge = screen.getByTestId("arena-deadlock-badge");
    expect(deadlockBadge.textContent).toContain("deadlock detected");
  });

  it("AC6: Container có class overflow-x-hidden và layout responsive cho mobile", () => {
    renderArenaView("vi");

    const view = screen.getByTestId("arena-view");
    expect(view.className).toContain("overflow-x-hidden");
    expect(view.className).toContain("w-full");

    // Kiểm tra grid transactions có class grid-cols-1 cho mobile
    const txGrid = screen.getByTestId("arena-transactions-grid");
    expect(txGrid.className).toContain("grid-cols-1");
  });
});
