import { expect, test, type Page } from "@playwright/test";

const SHOTS = "../_bmad-output/SP010/STR045/Task056";
type W = { checksum(): Promise<string>; indexCount(): Promise<number>; calls: string[] };
const w = (p: Page) => p.evaluate(async () => {
  const x = (window as unknown as { whatif: W }).whatif;
  return { sum: await x.checksum(), idx: await x.indexCount(), calls: x.calls.length };
});
const open = async (p: Page, l = "en") => {
  await p.goto(`/${l}/e2e-whatif`);
  await p.getByTestId("whatif").waitFor({ timeout: 90_000 });
  await p.waitForFunction(() => (window as unknown as { whatif?: unknown }).whatif !== undefined);
  await p.locator(".cm-content").waitFor();
};
const type = async (p: Page, sql: string) => {
  await p.locator(".cm-content").click();
  await p.keyboard.press("ControlOrMeta+a");
  await p.keyboard.type(sql);
};
const run = (p: Page) => p.getByTestId("whatif-run").click();
const INDEX = "CREATE INDEX ON orders(customer_id)";
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("Task056: so sánh trước và sau", () => {
  test.setTimeout(120_000);

  test("AC1, AC3, AC4, AC5: CREATE INDEX, hai cột nhãn Thật, trang giảm, không thời gian, dữ liệu không đổi", async ({ page }) => {
    await open(page);
    const before = await w(page);
    await type(page, INDEX);
    await run(page);
    await expect(page.getByTestId("whatif-result")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("whatif-column")).toHaveCount(2);
    await expect(page.getByTestId("plan-label")).toHaveText(["Real", "Real"]);
    await expect(page.getByTestId("whatif-delta")).toHaveAttribute("data-change", "fewer");
    const [b, a] = (await page.getByTestId("whatif-pages").allTextContents()).map(Number);
    expect(b).toBeGreaterThan(a * 2);
    expect(await page.getByTestId("whatif-rows").allTextContents()).toEqual(["20", "20"]);
    await expect(page.getByTestId("plan-tree")).toHaveCount(2);
    await expect(page.getByTestId("whatif-rows-changed")).toHaveCount(0);
    const text = await page.getByTestId("whatif").innerText();
    expect(text).not.toMatch(/\d\s?ms\b|\bseconds?\b|\bgiây\b|execution time|planning time/i);
    expect(text).not.toMatch(/\b(good|ok|safe|fine|optimal)\b|\bổn\b|tốt/i);
    expect(await w(page)).toMatchObject({ sum: before.sum, idx: before.idx });
  });

  test("AC2: sửa rồi chạy lại thay kết quả cũ, câu trả về muộn không ghi đè câu mới", async ({ page }) => {
    await open(page);
    await type(page, `${INDEX} -- slow`);
    await run(page);
    await expect(page.getByTestId("whatif-running")).toBeVisible();
    await type(page, "SELECT 1");
    await run(page);
    await run(page); // bấm liên tục
    await expect(page.getByTestId("whatif-delta")).toHaveAttribute("data-change", "same", { timeout: 60_000 });
    await page.waitForTimeout(4500); // quá thời gian trả muộn của lần chạy đầu
    await expect(page.getByTestId("whatif-delta")).toHaveAttribute("data-change", "same");
    await expect(page.getByTestId("whatif-result")).toHaveCount(1);
    await expect(page.getByTestId("whatif-column")).toHaveCount(2);
    await type(page, INDEX);
    await run(page);
    await expect(page.getByTestId("whatif-delta")).toHaveAttribute("data-change", "fewer", { timeout: 60_000 });
    await expect(page.getByTestId("whatif-column")).toHaveCount(2); // thay, không chồng
  });

  test("AC3: rowsChanged hiện cảnh báo không còn tương đương; dữ liệu không đổi; chạy lại cách khác thì cảnh báo mất", async ({ page }) => {
    await open(page);
    const before = await w(page);
    await type(page, "DELETE FROM orders WHERE customer_id = 42");
    await run(page);
    const warn = page.getByTestId("whatif-rows-changed");
    await expect(warn).toBeVisible({ timeout: 60_000 });
    await expect(warn).toContainText("no longer equivalent");
    await expect(page.getByTestId("whatif-rows")).toHaveText(["20", "0"]);
    expect(await w(page)).toMatchObject({ sum: before.sum });
    await type(page, INDEX);
    await run(page);
    await expect(page.getByTestId("whatif-delta")).toHaveAttribute("data-change", "fewer", { timeout: 60_000 });
    await expect(warn).toHaveCount(0);
  });

  test("Probe không phải SELECT: không tin rowsChanged, dữ liệu vẫn không đổi", async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as unknown as { setProbe(s: string): void }).setProbe("UPDATE orders SET note = 'x' WHERE customer_id = 42"));
    const before = await w(page);
    await type(page, INDEX);
    await run(page);
    await expect(page.getByTestId("whatif-result")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("whatif-rows-skipped")).toBeVisible();
    await expect(page.getByTestId("whatif-rows-changed")).toHaveCount(0);
    await expect(page.getByTestId("whatif-rows")).toHaveCount(0);
    expect(await w(page)).toMatchObject({ sum: before.sum, idx: before.idx });
  });

  test("Ô sửa rỗng: báo, không gọi engine", async ({ page }) => {
    await open(page);
    await run(page);
    await expect(page.getByTestId("whatif-empty")).toBeVisible();
    expect((await w(page)).calls).toBe(0);
    await type(page, "   ");
    await run(page);
    await expect(page.getByTestId("whatif-empty")).toBeVisible();
    expect((await w(page)).calls).toBe(0);
  });

  test("Lỗi SQL chỉ đúng dòng; dữ liệu không đổi", async ({ page }) => {
    await open(page);
    const before = await w(page);
    await type(page, "-- ghi chú\nCREAT INDEX ON orders(id)");
    await run(page);
    const err = page.getByTestId("whatif-error");
    await expect(err).toBeVisible({ timeout: 60_000 });
    await expect(err).toContainText("Line 2");
    await expect(page.locator(".cm-content")).toHaveAttribute("aria-invalid", "true");
    expect(await w(page)).toMatchObject({ sum: before.sum, idx: before.idx });
  });

  test("NotSimulated có lý do", async ({ page }) => {
    await open(page);
    await type(page, "CREATE INDEX CONCURRENTLY ON orders(customer_id)");
    await run(page);
    const ns = page.getByTestId("whatif-notsimulated");
    await expect(ns).toBeVisible({ timeout: 60_000 });
    await expect(ns).toContainText("Not simulated");
    await expect(ns).toContainText("CONCURRENTLY");
    await expect(page.getByTestId("whatif-column")).toHaveCount(0);
  });

  test("Bàn phím: Tab tới nút Chạy, Ctrl+Enter trong ô soạn chạy được", async ({ page }) => {
    await open(page);
    await type(page, INDEX);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByTestId("whatif-result")).toBeVisible({ timeout: 60_000 });
    await type(page, "SELECT 1");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("whatif-run")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("whatif-delta")).toHaveAttribute("data-change", "same", { timeout: 60_000 });
  });

  for (const l of ["vi", "en"]) {
    for (const [name, width, height] of [["1440", 1440, 1500], ["390", 390, 2800]] as const) {
      test(`Ảnh chụp ${l}-${name}, không cuộn ngang`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await open(page, l);
        await page.screenshot({ path: `${SHOTS}/${l}-${name}-idle.png` });
        await type(page, INDEX);
        await run(page);
        await expect(page.getByTestId("whatif-result")).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId("plan-step").first()).toBeVisible();
        expect(await noHScroll(page)).toBe(true);
        const [c1, c2] = [await page.getByTestId("whatif-column").nth(0).boundingBox(), await page.getByTestId("whatif-column").nth(1).boundingBox()];
        if (width < 600) expect(c2!.y).toBeGreaterThan(c1!.y + c1!.height - 1);
        else expect(Math.abs(c2!.y - c1!.y)).toBeLessThan(2);
        await page.getByTestId("whatif").screenshot({ path: `${SHOTS}/${l}-${name}.png` });
        await type(page, "DELETE FROM orders WHERE customer_id = 42");
        await run(page);
        await expect(page.getByTestId("whatif-rows-changed")).toBeVisible({ timeout: 60_000 });
        expect(await noHScroll(page)).toBe(true);
        await page.getByTestId("whatif").screenshot({ path: `${SHOTS}/${l}-${name}-rows.png` });
        await type(page, "CREAT INDEX ON orders(id)");
        await run(page);
        await expect(page.getByTestId("whatif-error")).toBeVisible({ timeout: 60_000 });
        expect(await noHScroll(page)).toBe(true);
        await page.screenshot({ path: `${SHOTS}/${l}-${name}-error.png` });
      });
    }
  }
});
