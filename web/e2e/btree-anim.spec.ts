import { expect, test, type Page } from "@playwright/test";

const LIFT = 4; // key nằm cao hơn mép trên node 4 px
const SHOTS = "../_bmad-output/SP008/STR036/Task045";
const open = async (p: Page, l = "vi") => {
  await p.goto(`/${l}/e2e-btree-anim`);
  await p.getByTestId("btree-svg").waitFor();
  await p.getByTestId("btree-drop-layer").waitFor({ state: "attached" });
};
const btn = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
const pick = (p: Page, name: string) => p.getByRole("button", { name, exact: true }).first().click();
const step = (p: Page) => p.getByTestId("btree-drop").getAttribute("data-step");
const keyBox = async (p: Page) => (await p.locator("[data-key] rect").boundingBox())!;
const nodeBox = async (p: Page, page: number) => (await p.locator(`g[data-page="${page}"] rect`).first().boundingBox())!;
const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const litLayer = (p: Page) => p.locator('[data-testid="btree-drop-layer"] [data-lit="true"]');
const timelines = (p: Page) => p.evaluate(() => (window as unknown as { timelineCount: () => number }).timelineCount());
const goTo = async (p: Page, n: number, next = "Bước tới") => {
  while (Number(await step(p)) < n) {
    const k = Number(await step(p));
    await btn(p, next).click();
    await expect(p.getByTestId("btree-drop")).toHaveAttribute("data-step", String(k + 1));
  }
};
// chờ key đứng yên (bước lùi chạy ngược timeline mất tới 1,4 giây)
const settle = async (p: Page) => {
  let last = "";
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(100);
    const now = JSON.stringify(await keyBox(p));
    if (now === last) return;
    last = now;
  }
};
const noHorizontalScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("máy tính 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1 trạng thái đầu tĩnh; đổi kiểu và kéo node không tự chạy", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("drop-explain")).toContainText("Chưa chạy");
    await expect(page.locator("[data-key]")).toHaveCSS("opacity", "0");
    await expect(litLayer(page)).toHaveCount(0);
    await expect(page.getByTestId("drop-counter")).toHaveText("Đã đọc 0 / 4 trang");
    await pick(page, "Kéo tự do");
    const b = await nodeBox(page, 4);
    await page.mouse.move(b.x + 20, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + 80, { steps: 5 });
    await page.mouse.up();
    await pick(page, "Cố định");
    await page.waitForTimeout(1600);
    expect(await step(page)).toBe("0");
    await expect(page.locator("[data-key]")).toHaveCSS("opacity", "0");
    await expect(page.getByTestId("btree-drop")).not.toHaveAttribute("data-playing", "true");
    await page.screenshot({ path: `${SHOTS}/vi-1440-b0.png` });
  });

  test("AC2 chạy hết đi đúng thứ tự trang, sang heap ở bước cuối", async ({ page }) => {
    await open(page);
    const seen: string[] = [];
    await page.exposeFunction("seen", (s: string) => seen.push(s));
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="btree-drop"]')!;
      new MutationObserver(() => (window as unknown as { seen: (s: string) => void }).seen(el.getAttribute("data-step")!)).observe(el, { attributes: true, attributeFilter: ["data-step"] });
    });
    await btn(page, "Chạy").click();
    await expect(page.getByTestId("btree-drop")).toHaveAttribute("data-playing", "true");
    await expect(page.getByTestId("drop-counter")).toHaveText("Đã đọc 4 / 4 trang", { timeout: 12_000 });
    expect(seen).toEqual(["1", "2", "3", "4"]);
    await settle(page);
    expect(await litLayer(page).count()).toBe(3 + 3 + 1); // 3 node, 3 cạnh (2 cây + 1 heap), heap
    await expect(page.getByTestId("drop-explain")).toContainText("heap");
    const k = centre(await keyBox(page));
    const h = (await page.locator("[data-heap-lit]").boundingBox())!;
    expect(Math.abs(k.x - (h.x + h.width / 2))).toBeLessThan(2);
    expect(Math.abs(k.y - (h.y - LIFT))).toBeLessThan(2); // key đứng ở mép trên của khối, như với node
    await expect(btn(page, "Chạy lại")).toBeEnabled();
    await expect(page.getByTestId("btree-drop")).not.toHaveAttribute("data-playing", "true");
  });

  test("AC3 AC4 từng bước: ảnh, câu giải thích, bộ đếm; lùi trả đúng trạng thái", async ({ page }) => {
    await open(page);
    const snap: { text: string; key: { x: number; y: number }; lit: number }[] = [];
    for (let n = 1; n <= 4; n++) {
      await goTo(page, n);
      await settle(page);
      const text = (await page.getByTestId("drop-explain").textContent())!;
      expect(text).not.toMatch(/ổn|\bms\b|giây/);
      snap[n] = { text, key: centre(await keyBox(page)), lit: await litLayer(page).count() };
      await expect(page.getByTestId("drop-counter")).toHaveText(`Đã đọc ${n} / 4 trang`);
      await page.screenshot({ path: `${SHOTS}/vi-1440-b${n}.png` });
    }
    expect(snap[1].text).toContain("Khóa 121 thuộc nhánh từ −∞ đến trước 500, nên đi xuống trang 2");
    expect(snap[2].text).toContain("từ 120 đến trước 300, nên đi xuống trang 5");
    expect(snap[3].text).toContain("Khóa 121 có trong trang này, trang có tất cả 180 khóa");
    expect(snap[4].text).toContain("trang 77");
    // key đứng đúng trên từng trang theo thứ tự 1, 2, 5
    for (const [n, pg] of [[1, 1], [2, 2], [3, 5]] as const) {
      const nb = await nodeBox(page, pg);
      expect(Math.abs(snap[n].key.x - (nb.x + nb.width / 2))).toBeLessThan(2);
      expect(Math.abs(snap[n].key.y - (nb.y - LIFT))).toBeLessThan(2);
    }
    // lùi từng bước: câu, bộ đếm, đèn, vị trí key trả về đúng bước đó
    for (let n = 3; n >= 0; n--) {
      await btn(page, "Bước lùi").click();
      await settle(page);
      await expect(page.getByTestId("btree-drop")).toHaveAttribute("data-step", String(n));
      await expect(page.getByTestId("drop-counter")).toHaveText(`Đã đọc ${n} / 4 trang`);
      await page.screenshot({ path: `${SHOTS}/vi-1440-lui-b${n}.png` });
      if (n > 0) {
        expect(await page.getByTestId("drop-explain").textContent()).toBe(snap[n].text);
        expect(await litLayer(page).count()).toBe(snap[n].lit);
        const k = centre(await keyBox(page));
        expect(Math.abs(k.x - snap[n].key.x)).toBeLessThan(1.5);
        expect(Math.abs(k.y - snap[n].key.y)).toBeLessThan(1.5);
      } else {
        await expect(page.getByTestId("drop-explain")).toContainText("Chưa chạy");
        await expect(litLayer(page)).toHaveCount(0);
        await expect(page.locator("[data-key]")).toHaveCSS("opacity", "0");
      }
    }
    // Về đầu và thanh tua
    await goTo(page, 3);
    await btn(page, "Về đầu").click();
    await expect(page.getByTestId("btree-drop")).toHaveAttribute("data-step", "0");
    await expect(litLayer(page)).toHaveCount(0);
    await page.getByTestId("drop-scrub").focus();
    await page.keyboard.press("End");
    await expect(page.getByTestId("btree-drop")).toHaveAttribute("data-step", "4");
    await page.keyboard.press("Home");
    await expect(page.getByTestId("btree-drop")).toHaveAttribute("data-step", "0");
  });

  test("Tạm dừng giữa chừng rồi chạy tiếp", async ({ page }) => {
    await open(page);
    await btn(page, "Chạy").click();
    await page.waitForTimeout(700);
    await btn(page, "Tạm dừng").click();
    await expect(page.getByTestId("btree-drop")).not.toHaveAttribute("data-playing", "true");
    const k1 = await keyBox(page);
    await page.waitForTimeout(500);
    expect(await keyBox(page)).toEqual(k1);
    await btn(page, "Chạy").click();
    await expect(page.getByTestId("drop-counter")).toHaveText("Đã đọc 4 / 4 trang", { timeout: 12_000 });
  });

  test("AC5 Kéo tự do: kéo node giữa lúc chạy, key đi theo node và cảnh chạy tiếp", async ({ page }) => {
    await open(page);
    await pick(page, "Kéo tự do");
    await goTo(page, 2);
    await settle(page);
    const k0 = centre(await keyBox(page));
    const n2 = await nodeBox(page, 2);
    expect(Math.abs(k0.y - (n2.y - LIFT))).toBeLessThan(2);
    // kéo trang 2 xuống và sang phải
    await page.mouse.move(n2.x + 20, n2.y + 10);
    await page.mouse.down();
    await page.mouse.move(n2.x + 60, n2.y + 70, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const n2b = await nodeBox(page, 2);
    expect(Math.abs(n2b.y - n2.y)).toBeGreaterThan(20);
    const k1 = centre(await keyBox(page));
    expect(Math.abs(k1.x - (n2b.x + n2b.width / 2))).toBeLessThan(2);
    expect(Math.abs(k1.y - (n2b.y - LIFT))).toBeLessThan(2);
    expect(await step(page)).toBe("2");
    await page.screenshot({ path: `${SHOTS}/vi-1440-keo-giua-chay.png` });
    // kéo ngay trong lúc đang chạy: chạy tiếp từ bước hiện tại, không về 0
    await btn(page, "Chạy").click();
    await page.waitForTimeout(300);
    const n5 = await nodeBox(page, 5);
    const heap0 = (await page.locator("[data-heap] rect").first().boundingBox())!;
    await page.mouse.move(n5.x + 20, n5.y + 10);
    await page.mouse.down();
    await page.mouse.move(n5.x + 320, n5.y + 10, { steps: 6 });
    await page.mouse.up();
    expect(Number(await step(page))).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("drop-counter")).toHaveText("Đã đọc 4 / 4 trang", { timeout: 12_000 });
    await settle(page);
    const n5b = await nodeBox(page, 5);
    const heap = centre((await page.locator("[data-heap-lit]").boundingBox())!);
    expect(n5b.x - n5.x).toBeGreaterThan(200);
    expect(heap.x - (heap0.x + heap0.width / 2)).toBeGreaterThan(200); // heap bám theo vị trí mới của leaf
    expect(heap.y).toBeGreaterThan(n5b.y + n5b.height + 16);
    await page.screenshot({ path: `${SHOTS}/vi-1440-keo-xong.png` });
  });

  test("AC6 giảm chuyển động: đổi ngay, có dòng báo, bàn phím, tóm tắt cho trình đọc màn hình", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await expect(page.getByTestId("drop-reduced")).toContainText("Giảm chuyển động đang bật");
    await expect(page.getByTestId("drop-summary")).toHaveText("Đường đi của khóa 121: trang 1 → 2 → 5, rồi nhảy sang trang heap 77.");
    await btn(page, "Bước tới").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("btree-drop")).toHaveAttribute("data-step", "1", { timeout: 400 });
    const nb = await nodeBox(page, 1);
    const k = centre(await keyBox(page));
    expect(Math.abs(k.y - (nb.y - LIFT))).toBeLessThan(2); // tới ngay, không nằm giữa đường
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("btree-drop")).toHaveAttribute("data-step", "2", { timeout: 400 });
    await page.screenshot({ path: `${SHOTS}/vi-1440-giam-chuyen-dong.png` });
    await btn(page, "Về đầu").click();
    await btn(page, "Chạy").click();
    await expect(page.getByTestId("drop-counter")).toHaveText("Đã đọc 4 / 4 trang", { timeout: 8000 });
  });

  test("path trỏ trang bị ẩn: key đi vào khối hidden; en đủ câu", async ({ page }) => {
    await open(page, "en");
    await pick(page, "big");
    await pick(page, "plain");
    await expect(page.getByTestId("drop-counter")).toHaveText("0 / 3 pages read");
    await goTo(page, 3, "Step forward");
    await settle(page);
    const hb = (await page.locator("g[data-hidden-level='0']").boundingBox())!;
    const k = centre(await keyBox(page));
    expect(k.x).toBeGreaterThan(hb.x);
    expect(k.x).toBeLessThan(hb.x + hb.width);
    await expect(page.getByTestId("drop-explain")).toContainText("block of nodes not drawn");
    const sb = (await page.getByTestId("btree-scroll").boundingBox())!;
    expect(k.x).toBeGreaterThan(sb.x);
    expect(k.x).toBeLessThan(sb.x + sb.width);
    await expect(btn(page, "Run again")).toBeEnabled();
    await page.screenshot({ path: `${SHOTS}/en-1440-hidden.png` });
  });

  test("cây một tầng và không có path", async ({ page }) => {
    await open(page);
    await pick(page, "single");
    await pick(page, "plain");
    await btn(page, "Chạy").click();
    await expect(page.getByTestId("drop-counter")).toHaveText("Đã đọc 1 / 1 trang", { timeout: 6000 });
    await expect(page.getByTestId("drop-explain")).toContainText("root, cũng là leaf");
    await pick(page, "none");
    await expect(page.getByTestId("drop-no-path")).toContainText("Chưa có đường đi");
    await expect(btn(page, "Chạy")).toHaveCount(0);
    await expect(page.locator("g[data-page]")).toHaveCount(1);
    await expect(page.getByTestId("btree-drop-layer")).toHaveCount(0);
  });

  test("rời cảnh giữa lúc chạy: timeline được dọn, không lỗi", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page);
    const base = await timelines(page); // gồm timeline của cảnh
    expect(base).toBeGreaterThan(0);
    await btn(page, "Chạy").click();
    await page.waitForTimeout(500);
    await pick(page, "none"); // gỡ cảnh khi đang chạy
    await page.waitForTimeout(300);
    expect(await timelines(page)).toBe(base - 1);
    await page.goto("/vi");
    expect(errors).toEqual([]);
  });
});

test.describe("điện thoại 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("AC7 không cuộn ngang, câu giải thích luôn thấy, ảnh từng bước vi và en", async ({ page }) => {
    for (const l of ["vi", "en"]) {
      await open(page, l);
      for (let n = 0; n <= 4; n++) {
        if (n > 0) {
          await btn(page, l === "vi" ? "Bước tới" : "Step forward").click();
          await expect(page.getByTestId("btree-drop")).toHaveAttribute("data-step", String(n));
          await settle(page);
        }
        expect(await noHorizontalScroll(page)).toBe(true);
        const ex = (await page.getByTestId("drop-explain").boundingBox())!;
        expect(ex.y).toBeGreaterThanOrEqual(0);
        expect(ex.y + ex.height).toBeLessThanOrEqual(844);
        expect(ex.x + ex.width).toBeLessThanOrEqual(390);
        if (n > 0) {
          const sb = (await page.getByTestId("btree-scroll").boundingBox())!;
          const k = centre(await keyBox(page));
          expect(k.x).toBeGreaterThan(sb.x);
          expect(k.x).toBeLessThan(sb.x + sb.width);
          expect(k.y).toBeGreaterThan(sb.y);
          expect(k.y).toBeLessThan(sb.y + sb.height);
        }
        await page.screenshot({ path: `${SHOTS}/${l}-390-b${n}.png` });
      }
    }
  });

  test("390: cây 500k, Chạy hết, vùng cuộn đi theo key", async ({ page }) => {
    await open(page);
    await pick(page, "big");
    await pick(page, "plain");
    await btn(page, "Chạy").click();
    await expect(page.getByTestId("drop-counter")).toHaveText("Đã đọc 3 / 3 trang", { timeout: 12_000 });
    await settle(page);
    const sb = (await page.getByTestId("btree-scroll").boundingBox())!;
    const k = centre(await keyBox(page));
    expect(k.x).toBeGreaterThan(sb.x);
    expect(k.x).toBeLessThan(sb.x + sb.width);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/vi-390-500k.png` });
  });
});
