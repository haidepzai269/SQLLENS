import { expect, test, type Locator, type Page } from "@playwright/test";

const SHOTS = "../_bmad-output/SP008/STR035/Task040";
const url = (l: string) => `/${l}/e2e-btree`;
const open = async (p: Page, l = "vi") => {
  await p.goto(url(l));
  await p.getByTestId("btree-svg").waitFor();
};
const node = (p: Page, page: number) => p.locator(`g[data-page="${page}"]`);
const box = async (l: Locator) => (await l.locator("rect").first().boundingBox())!;
const pick = (p: Page, name: string) => p.getByRole("button", { name, exact: true }).click();

test.describe("máy tính 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1 tầng, cạnh nối, đường đi", async ({ page }) => {
    await open(page);
    const [r, i, l] = [await box(node(page, 1)), await box(node(page, 2)), await box(node(page, 5))];
    expect(r.y).toBeLessThan(i.y);
    expect(i.y).toBeLessThan(l.y);
    const child = page.locator('path[data-edge="child"]');
    await expect(child.locator('xpath=self::*[@data-from="p1"][@data-to="p2"]')).toHaveCount(1);
    await expect(page.locator('path[data-edge="child"][data-from="p2"][data-to="p4"]')).toHaveCount(1);
    await expect(page.locator('path[data-edge="next"][data-from="p4"][data-to="p5"]')).toHaveCount(1);
    for (const p of [1, 2, 5]) await expect(node(page, p)).toHaveAttribute("data-lit", "true");
    await expect(node(page, 3)).not.toHaveAttribute("data-lit", "true");
    await expect(page.locator('path[data-lit="true"]')).toHaveCount(2);
    await expect(page.locator("g[data-page='3'] rect").first()).toHaveClass(/stroke-control/);
    await page.screenshot({ path: `${SHOTS}/vi-1440.png` });
  });

  test("AC2 khối +206 node và thời gian vẽ", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const w = window as unknown as { __render: number[]; __long: number[] };
      w.__render = [];
      w.__long = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ entryTypes: ["longtask"] });
    });
    const click = (name: string) =>
      page.evaluate(
        (n) =>
          new Promise<number>((res) => {
            const t0 = performance.now();
            [...document.querySelectorAll("button")].find((b) => b.textContent === n)!.click();
            requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t0)));
          }),
        name,
      );
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      await click("small");
      runs.push(await click("big"));
    }
    const frame = [...runs].sort((x, y) => x - y)[2]; // trung vị 5 lần
    console.log(`AC2 5 lần: ${runs.map((x) => x.toFixed(1))}`);
    await expect(page.locator("g[data-hidden-level='0']")).toContainText("+206 node");
    const render = await page.evaluate(() => (window as unknown as { __render: number[] }).__render);
    const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
    console.log(`AC2 nodes=${await page.locator("g[data-page]").count()} commit=${render.length ? render.map((x) => x.toFixed(1)) : "n/a (build prod không có Profiler)"}, click->paint=${frame.toFixed(1)} ms, longtasks=${long.map((x) => x.toFixed(0))}`);
    expect(frame).toBeLessThan(100);
    expect(frame).toBeLessThan(200);
    expect(Math.max(0, ...long)).toBeLessThan(200);
    // path trỏ trang 500 bị ẩn: khối hidden được tô, không sập
    await expect(page.locator("g[data-hidden-level='0']")).toHaveAttribute("data-lit", "true");
    await page.screenshot({ path: `${SHOTS}/vi-1440-500k.png` });
  });

  test("AC2 en: số nhiều", async ({ page }) => {
    await open(page, "en");
    await page.screenshot({ path: `${SHOTS}/en-1440.png` });
    await pick(page, "big");
    await expect(page.locator("g[data-hidden-level='0']")).toContainText("+206 nodes");
    await page.screenshot({ path: `${SHOTS}/en-1440-500k.png` });
  });

  test("AC3 khóa bị cắt có title và số khóa thật", async ({ page }) => {
    await open(page);
    const n = node(page, 4);
    await expect(n).toContainText("119 khóa");
    await expect(n.locator("title")).toContainText("1, 2, 3, 4, 5, 6");
    await expect(n.locator("text").nth(2)).toHaveText("…");
    await expect(node(page, 1)).toContainText("−∞");
  });

  test("AC4 mặc định cố định, kéo tự do, không chồng, Xếp lại", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("btree-view")).toHaveAttribute("data-mode", "fixed");
    expect(await node(page, 4).getAttribute("role")).toBeNull();
    const before = await box(node(page, 4));
    await page.mouse.move(before.x + 20, before.y + 10);
    await page.mouse.down();
    await page.mouse.move(before.x + 60, before.y + 60, { steps: 4 });
    await page.mouse.up();
    expect(await box(node(page, 4))).toEqual(before);

    await pick(page, "Kéo tự do");
    await expect(page.getByText("Vị trí kéo chỉ để dễ nhìn")).toBeVisible();
    const a = await box(node(page, 4));
    const b = await box(node(page, 5));
    // kéo node 4 đè lên node 5
    await page.mouse.move(a.x + 20, a.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + 30, b.y + 12, { steps: 8 });
    await page.screenshot({ path: `${SHOTS}/vi-1440-keo-dang-keo.png` });
    await page.mouse.up();
    const a2 = await box(node(page, 4));
    const b2 = await box(node(page, 5));
    const gapX = Math.max(a2.x - (b2.x + b2.width), b2.x - (a2.x + a2.width));
    const gapY = Math.max(a2.y - (b2.y + 46), b2.y - (a2.y + 46));
    expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(8);
    await page.screenshot({ path: `${SHOTS}/vi-1440-keo-sau-tha.png` });

    // lưu và đọc lại
    await page.reload();
    await page.getByTestId("btree-svg").waitFor();
    await expect(page.getByTestId("btree-view")).toHaveAttribute("data-mode", "free");
    expect(await box(node(page, 4))).toEqual(a2);

    // bàn phím
    await node(page, 2).focus();
    const k0 = await box(node(page, 2));
    await page.keyboard.press("ArrowUp"); // lên hẳn ra khỏi hàng: dời đúng 8 px
    await page.keyboard.press("ArrowUp");
    expect(k0.y - (await box(node(page, 2))).y).toBe(16);

    await page.getByRole("button", { name: "Xếp lại" }).click();
    expect(Math.abs((await box(node(page, 4))).x - before.x)).toBeLessThan(1);
    await pick(page, "Cố định");
    await expect(page.getByTestId("btree-view")).toHaveAttribute("data-mode", "fixed");
  });

  test("AC4 thả đúng lên node khác ở nhiều vị trí vẫn không chồng", async ({ page }) => {
    await open(page);
    await pick(page, "Kéo tự do");
    for (const [from, to] of [[2, 3], [5, 4], [1, 2]]) {
      const a = await box(node(page, from));
      const b = await box(node(page, to));
      await page.mouse.move(a.x + 20, a.y + 10);
      await page.mouse.down();
      await page.mouse.move(b.x + 10, b.y + 10, { steps: 6 });
      await page.mouse.up();
      const x = await box(node(page, from));
      const y = await box(node(page, to));
      const g = Math.max(x.x - (y.x + y.width), y.x - (x.x + x.width), x.y - (y.y + 46), y.y - (x.y + 46));
      expect(g, JSON.stringify({ from, to, x, y })).toBeGreaterThanOrEqual(8);
    }
  });

  test("AC6 nhãn và bản tóm tắt", async ({ page }) => {
    await open(page);
    const label = page.getByTestId("btree-label");
    await expect(label).toHaveText("Thật");
    await pick(page, "simulated");
    await expect(label).toHaveText("Mô phỏng");
    await pick(page, "estimated");
    await expect(label).toHaveText("Ước lượng");
    await expect(label).toHaveAttribute("data-label", "estimated");
    await expect(page.getByTestId("btree-summary")).toHaveText("Cây B-Tree có 3 tầng, 5 trang, đã đọc 5 trang. Đường đi của khóa 121: trang 1 → 2 → 5.");
  });

  test("ca biên: không có path vẫn vẽ cây, không tô đường đi", async ({ page }) => {
    await open(page);
    await pick(page, "path"); // tắt path
    await expect(page.locator("g[data-page]")).toHaveCount(5);
    await expect(page.locator("[data-lit='true']")).toHaveCount(0);
    await expect(page.getByTestId("btree-summary")).toHaveText("Cây B-Tree có 3 tầng, 5 trang, đã đọc 5 trang.");
  });

  test("ca biên: một node, localStorage bị chặn", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error("blocked");
      };
      Storage.prototype.setItem = () => {
        throw new Error("blocked");
      };
    });
    await open(page);
    await pick(page, "single");
    await expect(page.locator("g[data-page]")).toHaveCount(1);
    await expect(page.getByText("Root, leaf")).toBeVisible();
    await pick(page, "Kéo tự do");
    await expect(page.getByTestId("btree-view")).toHaveAttribute("data-mode", "free");
    await pick(page, "small");
    const a = await box(node(page, 4));
    await page.mouse.move(a.x + 20, a.y + 10);
    await page.mouse.down();
    await page.mouse.move(a.x + 80, a.y + 40, { steps: 3 });
    await page.mouse.up();
    expect((await box(node(page, 4))).x).toBeGreaterThan(a.x + 40);
  });
});

for (const locale of ["vi", "en"]) {
  test.describe(`điện thoại 390 ${locale}`, () => {
    test.use({ viewport: { width: 390, height: 800 }, hasTouch: true });

    test("AC5 không cuộn ngang trang, chữ 12,5 px, cây cuộn trong khung", async ({ page }) => {
      await open(page, locale);
      await pick(page, "big");
      const m = await page.evaluate(() => {
        const sc = document.querySelector("[data-testid=btree-scroll]")!;
        return {
          doc: document.documentElement.scrollWidth,
          win: window.innerWidth,
          inner: sc.scrollWidth,
          outer: sc.clientWidth,
          font: getComputedStyle(document.querySelector("g[data-page] text")!).fontSize,
        };
      });
      expect(m.doc).toBeLessThanOrEqual(m.win);
      expect(m.inner).toBeGreaterThan(m.outer);
      expect(m.font).toBe("12.5px");
      await page.screenshot({ path: `${SHOTS}/${locale}-390.png` });
      await pick(page, "small");
      await pick(page, locale === "vi" ? "Kéo tự do" : "Free drag");
      await page.screenshot({ path: `${SHOTS}/${locale}-390-keo.png` });
    });

    test("kéo nền để cuộn ở Kéo tự do", async ({ page }) => {
      await open(page, locale);
      await pick(page, "big");
      await pick(page, locale === "vi" ? "Kéo tự do" : "Free drag");
      const sc = page.getByTestId("btree-scroll");
      const b = (await sc.boundingBox())!;
      await page.mouse.move(b.x + 200, b.y + b.height - 10);
      await page.mouse.down();
      await page.mouse.move(b.x + 50, b.y + b.height - 10, { steps: 5 });
      await page.mouse.up();
      expect(await sc.evaluate((e) => e.scrollLeft)).toBeGreaterThan(100);
    });

    test("kéo bằng cảm ứng", async ({ page, context }) => {
      await open(page, locale);
      await pick(page, locale === "vi" ? "Kéo tự do" : "Free drag");
      const a = await box(node(page, 5));
      const cdp = await context.newCDPSession(page);
      const pt = (x: number, y: number) => [{ x, y, id: 1 }];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(a.x + 20, a.y + 10) });
      for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(a.x + 20, a.y + 10 + i * 8) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const b = await box(node(page, 5));
      expect(b.y).toBeGreaterThan(a.y + 40); // kéo 80 px, trừ ngưỡng chạm của Chrome
    });
  });
}
