import { expect, test } from "@playwright/test";

test.describe("Task172 — Tích hợp UI cuối SP024 vào Lab & /arena", () => {
  test("AC1 & AC5: /vi/arena hiển thị SimulationBadge Mô phỏng, chạy kịch bản deadlock_reverse_order và không tràn ngang ở 390x844", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/vi/arena");

    const badge = page.getByTestId("arena-header-simulation-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Mô phỏng");

    await expect(page.getByTestId("arena-view")).toBeVisible();
    await expect(page.getByTestId("arena-back-to-lab")).toBeVisible();

    // Chọn trực tiếp kịch bản deadlock_reverse_order và kiểm tra bước
    const select = page.getByTestId("arena-scenario-select");
    await expect(select).toBeVisible();
    await select.selectOption("deadlock_reverse_order");
    await expect(select).toHaveValue("deadlock_reverse_order");

    await expect(page.getByTestId("arena-wait-graph")).toBeVisible();

    // Kiểm tra không tràn ngang trên mobile 390x844
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);

    // AC1: bản tiếng Anh cũng dựng đủ Arena và nhãn Mô phỏng
    await page.goto("/en/arena");
    await expect(page.getByTestId("arena-header-simulation-badge")).toContainText("Simulated");
    await expect(page.getByTestId("arena-scenario-select")).toBeVisible();
    await expect(page.getByTestId("arena-controller")).toBeVisible();
    await expect(page.getByTestId("arena-back-to-lab")).toBeVisible();
  });

  test("AC2 & AC5: từ /vi bấm nút Arena trên toolbar Stage điều hướng sang /vi/arena", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/vi");

    const openArenaBtn = page.getByTestId("stage-open-arena");
    await expect(openArenaBtn).toBeVisible();
    // Ca biên: dự án local thường (không có cloud.remoteId) không hiện nút Fork
    await expect(page.getByTestId("fork-open-button")).toHaveCount(0);
    await openArenaBtn.click();

    await expect(page).toHaveURL(/\/vi\/arena/);
    await expect(page.getByTestId("arena-header-simulation-badge")).toContainText("Mô phỏng");
  });
});
