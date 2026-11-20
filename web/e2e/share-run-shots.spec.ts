import { expect, test } from "@playwright/test";
import { encodeSnapshot } from "../src/modules/share/codec";
import type { SnapshotV1 } from "../src/modules/share/snapshot";

/**
 * Chụp ảnh bằng chứng cho bàn giao Task148 và đo số thật trên Chromium:
 * thời gian chạy, kích thước vùng kết quả, độ tràn ngang ở 390px.
 * Chạy một lần bằng `npx playwright test e2e/share-run-shots.spec.ts`.
 */

const OUT = "../../_bmad-output/SP022/STR101/Task148";

const SNAPSHOT: SnapshotV1 = {
  v: 1,
  project: { name: "E-Commerce Deadlock Test", engine: "postgres" },
  tabs: [
    { name: "01_schema.sql", sql: "CREATE TABLE accounts (id int primary key, owner_name text, balance numeric);" },
    {
      name: "02_seed.sql",
      sql: "INSERT INTO accounts VALUES (1, 'an', 100), (2, 'bình', 250), (3, 'chi', 0);",
    },
    { name: "03_query.sql", sql: "SELECT id, owner_name, balance FROM accounts ORDER BY id;" },
  ],
};

test.describe("Ảnh bằng chứng Task148", () => {
  test("1440px: trước khi chạy, đang chạy, kết quả Thật, lỗi timeout", async ({ page }) => {
    test.setTimeout(180_000);
    const payload = await encodeSnapshot(SNAPSHOT);
    await page.goto(`/vi/share#d=${payload}`);
    await expect(page.getByTestId("readonly-workspace")).toBeVisible();
    await page.getByTestId("share-tab-2").click();
    await page.screenshot({ path: `${OUT}/run-before.png` });

    const t0 = Date.now();
    await page.getByTestId("share-run-btn").click();
    // Bắt trạng thái đang chạy (nút Hủy) nếu kịp.
    await page.getByTestId("share-run-cancel").isVisible().catch(() => false);
    await page.screenshot({ path: `${OUT}/run-busy.png` }).catch(() => {});
    await expect(page.getByTestId("share-run-result")).toBeVisible({ timeout: 90_000 });
    const elapsed = Date.now() - t0;
    await page.screenshot({ path: `${OUT}/run-done.png` });

    const box = await page.getByTestId("share-run-panel").boundingBox();
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    console.log(
      `SHOT1440 ${JSON.stringify({
        elapsedMs: elapsed,
        panel: box && { w: Math.round(box.width), h: Math.round(box.height) },
        overflow,
        label: await page.getByTestId("share-run-label").innerText(),
      })}`,
    );
  });

  test("1440px: câu treo quá 1.500 ms", async ({ page }) => {
    test.setTimeout(180_000);
    const payload = await encodeSnapshot({
      v: 1,
      project: { name: "Treo 1.500 ms", engine: "postgres" },
      tabs: [{ name: "slow.sql", sql: "SELECT count(*) FROM generate_series(1, 20000000);" }],
    });
    await page.goto(`/vi/share#d=${payload}`);
    await expect(page.getByTestId("readonly-workspace")).toBeVisible();

    const t0 = Date.now();
    await page.getByTestId("share-run-btn").click();
    await expect(page.getByTestId("share-run-error")).toBeVisible({ timeout: 90_000 });
    const elapsed = Date.now() - t0;
    await page.screenshot({ path: `${OUT}/run-timeout.png` });
    console.log(`SHOT_TIMEOUT ${JSON.stringify({ elapsedMs: elapsed })}`);
  });

  test("1440px: snapshot MySQL báo cần sandbox", async ({ page }) => {
    const payload = await encodeSnapshot({
      v: 1,
      project: { name: "Shop MySQL", engine: "mysql" },
      tabs: [{ name: "01_query.sql", sql: "SELECT 1;" }],
    });
    await page.goto(`/vi/share#d=${payload}`);
    await expect(page.getByTestId("readonly-workspace")).toBeVisible();
    await page.getByTestId("share-run-btn").click();
    await expect(page.getByTestId("share-run-sandbox")).toBeVisible();
    await page.screenshot({ path: `${OUT}/run-mysql-sandbox.png` });
  });

  test("390px: kết quả không tràn ngang", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const payload = await encodeSnapshot(SNAPSHOT);
    await page.goto(`/en/share#d=${payload}`);
    await expect(page.getByTestId("readonly-workspace")).toBeVisible();
    await page.getByTestId("share-tab-2").click();
    await page.getByTestId("share-run-btn").click();
    await expect(page.getByTestId("share-run-result")).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: `${OUT}/run-390-en.png` });

    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
      panelScroll: document.querySelector('[data-testid="share-run-result"]')?.scrollWidth,
      panelClient: document.querySelector('[data-testid="share-run-result"]')?.clientWidth,
    }));
    console.log(`SHOT390 ${JSON.stringify(overflow)}`);
    expect(overflow.doc).toBeLessThanOrEqual(overflow.win);
  });
});
