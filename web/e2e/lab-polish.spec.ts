import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated, throttleCpu } from "./helpers";

test.beforeEach(async ({ page }) => {
  await throttleCpu(page);
  // Mock /api/me để không làm che giao diện bởi popup
  await page.route("**/api/me", (r) => r.fulfill({ status: 503, body: "{}" }));
});

const T = {
  vi: {
    stage: "Mô phỏng",
    schemaTab: "Sơ đồ",
    planTab: "Plan",
    btreeTab: "B-Tree",
    whatifTab: "Thử sửa",
    capacityTab: "Capacity",
    mentorTab: "Mentor",
    conflictTab: "Tranh chấp",
    sqlTab: "SQL",
    run: "Chạy",
    loadSample: "Nạp mẫu SQL",
  },
  en: {
    stage: "Simulation",
    schemaTab: "Schema",
    planTab: "Plan",
    btreeTab: "B-Tree",
    whatifTab: "Try a fix",
    capacityTab: "Capacity",
    mentorTab: "Mentor",
    conflictTab: "Conflicts",
    sqlTab: "SQL",
    run: "Run",
    loadSample: "Try sample SQL",
  },
} as const;

type Lang = "vi" | "en";

const sqlBox = (p: Page) => p.locator(".cm-content:visible");
const runBtn = (p: Page, l: Lang) => p.getByRole("button", { name: T[l].run, exact: true });

for (const l of ["vi", "en"] as const) {
  const t = T[l];

  test.describe(`Lab Polish & Empty States (${l}) - Desktop 1440px`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("AC1 & AC2: Khi chưa chạy SQL (run === null), 7 tabs vẫn hiển thị; Empty states có nút Nạp mẫu; Conflict Sim chạy độc lập", async ({ page }) => {
      await gotoHydrated(page, `/${l}`);

      // Kiểm tra thanh 7 Tabs của Stage luôn hiển thị đầy đủ
      const tabs = ["schema", "plan", "btree", "whatif", "capacity", "mentor", "conflict"] as const;
      for (const tabKey of tabs) {
        const tabTrigger = page.getByRole("tab", { name: new RegExp(t[`${tabKey}Tab` as keyof typeof t], "i") });
        await expect(tabTrigger).toBeVisible();
      }

      // 1. Tab Schema: Mặc định mở, hiển thị Empty State
      await expect(page.getByTestId("stage-empty-schema")).toBeVisible();
      const loadBtn = page.getByTestId("stage-empty-schema").getByTestId("stage-empty-load-sample");
      await expect(loadBtn).toBeVisible();

      // Bấm nút Nạp mẫu SQL trong Empty State
      await loadBtn.click();
      // Kiểm tra SQL editor nhận được text mẫu
      await expect(sqlBox(page)).not.toBeEmpty();

      // 2. Tab Plan: Chuyển qua tab Plan, hiển thị Empty State của Plan
      await page.getByRole("tab", { name: new RegExp(t.planTab, "i") }).click();
      await expect(page.getByTestId("stage-empty-plan")).toBeVisible();

      // 3. Tab B-Tree: Chuyển qua tab B-Tree, hiển thị Empty State của BTree
      await page.getByRole("tab", { name: new RegExp(t.btreeTab, "i") }).click();
      await expect(page.getByTestId("stage-empty-btree")).toBeVisible();

      // 4. Tab WhatIf (Thử sửa): Hiển thị Empty State
      await page.getByRole("tab", { name: new RegExp(t.whatifTab, "i") }).click();
      await expect(page.getByTestId("stage-empty-whatif")).toBeVisible();

      // 5. Tab Capacity: Hiển thị Empty State
      await page.getByRole("tab", { name: new RegExp(t.capacityTab, "i") }).click();
      await expect(page.getByTestId("stage-empty-capacity")).toBeVisible();

      // 6. Tab Mentor: Hiển thị Empty State
      await page.getByRole("tab", { name: new RegExp(t.mentorTab, "i") }).click();
      await expect(page.getByTestId("stage-empty-mentor")).toBeVisible();

      // AC2: Tab Conflict (Tranh chấp): Mở được ngay cả khi run === null, chạy được mô phỏng độc lập
      await page.getByRole("tab", { name: new RegExp(t.conflictTab, "i") }).click();
      await expect(page.getByTestId("conflict-panel")).toBeVisible();
      // Chạy thử mô phỏng kịch bản mẫu
      const cfRun = page.getByTestId("cf-run");
      await expect(cfRun).toBeVisible();
      await cfRun.click();
      await expect(page.getByTestId("cf-pause")).toBeEnabled();
    });

    test("AC3: Phím tắt Ctrl+Enter / Cmd+Enter kích hoạt chạy SQL trong SqlEditor", async ({ page }) => {
      await gotoHydrated(page, `/${l}`);

      // Nạp mẫu SQL
      const sampleBtn = page.getByRole("button", { name: t.loadSample }).first();
      await sampleBtn.click();
      await expect(sqlBox(page)).not.toBeEmpty();

      // Focus vào editor và nhấn Control+Enter
      await sqlBox(page).click();
      await sqlBox(page).press("Control+Enter");

      // Nút chạy bị disabled hoặc chuyển sang running
      await expect(runBtn(page, l)).toBeDisabled();

      // Chờ hoàn thành và kết quả hiển thị (ResultGrid)
      await expect(page.locator('[data-testid="conclusion"]:visible')).toBeVisible({ timeout: 20000 });
    });

    test("AC8: Rà soát CSS cursor: pointer trên interactive elements và cursor: not-allowed khi disabled", async ({ page }) => {
      await gotoHydrated(page, `/${l}`);

      // Button hoạt động có cursor: pointer
      const sampleBtn = page.getByRole("button", { name: t.loadSample }).first();
      const cursorActive = await sampleBtn.evaluate((el) => window.getComputedStyle(el).cursor);
      expect(cursorActive).toBe("pointer");

      // Tabs có cursor: pointer
      const tabTrigger = page.getByRole("tab", { name: new RegExp(t.schemaTab, "i") });
      const tabCursor = await tabTrigger.evaluate((el) => window.getComputedStyle(el).cursor);
      expect(tabCursor).toBe("pointer");

      // Button disabled có cursor: not-allowed
      // Khi editor rỗng, nút Chạy bị disabled
      await sqlBox(page).fill("");
      const disabledRun = runBtn(page, l);
      await expect(disabledRun).toBeDisabled();
      const cursorDisabled = await disabledRun.evaluate((el) => window.getComputedStyle(el).cursor);
      expect(cursorDisabled).toBe("not-allowed");
    });
  });

  test.describe(`Lab Polish & Canvas Space Pan (${l}) - Desktop 1440px`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("AC4: Giữ phím Space trên canvas Sơ đồ và Plan kích hoạt class space-panning với cursor grab", async ({ page }) => {
      await gotoHydrated(page, `/${l}`);

      // Nạp SQL và chạy để có Sơ đồ và Plan
      const sampleBtn = page.getByRole("button", { name: t.loadSample }).first();
      await sampleBtn.click();
      await runBtn(page, l).click();
      await expect(page.locator('[data-testid="conclusion"]:visible')).toBeVisible({ timeout: 20000 });

      // Mở tab Sơ đồ (Schema)
      await page.getByRole("tab", { name: new RegExp(t.schemaTab, "i") }).click();
      const schemaCanvas = page.getByTestId("schema-canvas");
      await expect(schemaCanvas).toBeVisible();

      // Khi chưa giữ Space: không có class space-panning
      await expect(schemaCanvas).not.toHaveClass(/space-panning/);

      // Nhấn giữ phím Space
      await page.keyboard.down("Space");
      await expect(schemaCanvas).toHaveClass(/space-panning/);

      // Thả phím Space
      await page.keyboard.up("Space");
      await expect(schemaCanvas).not.toHaveClass(/space-panning/);

      // Mở tab Plan
      await page.getByRole("tab", { name: new RegExp(t.planTab, "i") }).click();
      const planCanvas = page.getByTestId("plan-canvas");
      await expect(planCanvas).toBeVisible();

      // Nhấn giữ phím Space trên Plan canvas
      await page.keyboard.down("Space");
      await expect(planCanvas).toHaveClass(/space-panning/);

      // Thả phím Space
      await page.keyboard.up("Space");
      await expect(planCanvas).not.toHaveClass(/space-panning/);
    });
  });

  test.describe(`Lab Polish - Mobile 390px (${l})`, () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("Màn hình mobile 390px: Thanh Tabs cuộn/xuống dòng êm ái, Empty State không tràn ngang", async ({ page }) => {
      await gotoHydrated(page, `/${l}`);

      // Trên mobile, mở tab Stage
      const stageTabBtn = page.getByRole("tab", { name: new RegExp(t.stage, "i") });
      if (await stageTabBtn.isVisible()) {
        await stageTabBtn.click();
      }

      // Kiểm tra Empty State của Schema hiển thị và không làm tràn ngang trang
      await expect(page.getByTestId("stage-empty-schema")).toBeVisible();

      const noHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(noHorizontalScroll).toBe(true);

      // Mở tab Tranh chấp trên mobile
      await page.getByRole("tab", { name: new RegExp(t.conflictTab, "i") }).click();
      await expect(page.getByTestId("conflict-panel")).toBeVisible();

      const noHScrollConflict = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(noHScrollConflict).toBe(true);
    });
  });
}
