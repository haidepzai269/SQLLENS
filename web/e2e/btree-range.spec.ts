import { expect, test, type Page } from "@playwright/test";

const LIFT = 4;
const SHOTS = "../_bmad-output/SP008/STR037/Task072/anh";
// Cây thử "chain": 3 tầng, leaf 4..9 nối bằng next. Khóa 5 nằm ở leaf 5, đường đi 1 → 2 → 5, heap 90.
const PAGES = [1, 2, 5, 6, 7, 8];

const open = async (p: Page, l = "vi", which = "chain", path = "heap", to = "14") => {
  await p.goto(`/${l}/e2e-btree-anim`);
  await p.getByTestId("btree-svg").waitFor();
  if (which !== "small") await p.getByRole("button", { name: which, exact: true }).click();
  await p.getByRole("button", { name: path, exact: true }).first().click();
  await p.getByLabel("to", { exact: true }).fill(to);
  await p.getByTestId("btree-svg").waitFor();
};
const btn = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
const root = (p: Page) => p.getByTestId("btree-drop");
const keyBox = async (p: Page) => (await p.locator("[data-key] rect").boundingBox())!;
const target = (p: Page, page: number | "heap") => (page === "heap" ? p.locator("[data-heap-lit]") : p.locator(`g[data-page="${page}"] rect`).first());
const settle = async (p: Page) => {
  await expect.poll(() => p.evaluate(() => (window as unknown as { activeTweens: () => number }).activeTweens()), { timeout: 8000 }).toBe(0);
  let last = "";
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(100);
    const now = JSON.stringify(await keyBox(p));
    if (now === last) return;
    last = now;
  }
};
const next = async (p: Page, n: number) => {
  await btn(p, T(p).next).click();
  await expect(root(p)).toHaveAttribute("data-step", String(n));
  await settle(p);
};
const T = (p: Page) => (p.url().includes("/en/") ? EN : VI);
const VI = { next: "Bước tới", back: "Bước lùi", run: "Chạy" };
const EN = { next: "Step forward", back: "Step back", run: "Run" };
async function keyOn(p: Page, page: number | "heap") {
  const k = await keyBox(p);
  const nb = (await target(p, page).boundingBox())!;
  expect(Math.abs(k.x + k.width / 2 - (nb.x + nb.width / 2)), `key lệch trang ${page}`).toBeLessThan(2);
  expect(Math.abs(k.y + k.height / 2 - (nb.y - LIFT)), `key lệch trang ${page}`).toBeLessThan(2);
}
const nodesLit = (p: Page) => p.locator('[data-node][data-lit="true"]').count();
const inFrame = async (p: Page) => {
  const f = (await p.getByTestId("btree-scroll").boundingBox())!;
  const k = await keyBox(p);
  expect(k.x).toBeGreaterThanOrEqual(f.x - 1);
  expect(k.x + k.width).toBeLessThanOrEqual(f.x + f.width + 1);
};

for (const [w, h, l] of [[1440, 900, "vi"], [1440, 900, "en"], [390, 844, "vi"], [390, 844, "en"]] as const) {
  test.describe(`${l} ${w}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test("AC1 AC3 AC5 khoảng 5 đến 14: rơi tới leaf đầu, trượt qua leaf 6, 7, 8, rồi sang heap; ảnh từng bước", async ({ page }) => {
      await open(page, l);
      const t = T(page);
      await expect(page.getByTestId("drop-counter")).toContainText("7");
      await expect(page.getByTestId("drop-range-end")).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/${l}-${w}-b0.png` });
      const texts: string[] = [];
      for (let n = 1; n <= 7; n++) {
        await next(page, n);
        texts.push((await page.getByTestId("drop-explain").textContent())!);
        await keyOn(page, n === 7 ? "heap" : (PAGES[n - 1] as number));
        await inFrame(page); // khung tự cuộn theo vị trí đang đọc
        if (n <= 6) expect(await nodesLit(page)).toBe(n);
        await page.screenshot({ path: `${SHOTS}/${l}-${w}-b${n}.png` });
      }
      // bước 3 là leaf đầu, 4 đến 6 là trượt, 7 là heap; không có thời gian chạy, không nói "ổn"
      const slide = l === "vi" ? /trượt sang leaf bên phải, trang 6/ : /slide to the right-hand leaf, page 6/;
      expect(texts[3]).toMatch(slide);
      expect(texts[5]).toMatch(l === "vi" ? /Đã đọc 4 leaf/ : /4 leaves read/);
      expect(texts[6]).toContain("90");
      for (const x of texts) expect(x).not.toMatch(/\bms\b|giây|seconds|ổn|\bfine\b/);
      const end = page.getByTestId("drop-range-end");
      await expect(end).toHaveAttribute("data-end", "done");
      await expect(end).toContainText(l === "vi" ? "14" : "14");
      await expect(btn(page, t.next)).toBeDisabled();
      // PostgreSQL: bước cuối là heap
      expect(await page.locator("[data-heap-lit]").getAttribute("data-lit")).toBe("true");
      if (w === 390) expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      // lùi: leaf đã đi qua tối lại theo đúng thứ tự, câu và key trả về bước đó
      for (let n = 6; n >= 3; n--) {
        await btn(page, t.back).click();
        await expect(root(page)).toHaveAttribute("data-step", String(n));
        await settle(page);
        expect(await page.getByTestId("drop-explain").textContent()).toBe(texts[n - 1]);
        await keyOn(page, PAGES[n - 1]);
        expect(await nodesLit(page)).toBe(n);
      }
      await expect(page.getByTestId("drop-range-end")).toHaveCount(0);
    });
  });
}

test.describe("ca biên 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC2 thiếu leaf ở giữa: dừng đúng chỗ, nói phần còn lại chưa đọc, không vẽ leaf giả", async ({ page }) => {
    await open(page, "vi", "gap", "plain", "20");
    await expect(page.locator('g[data-page="8"]')).toHaveCount(0);
    await expect(page.getByTestId("drop-counter")).toHaveText("Đã đọc 0 / 5 trang"); // 1, 2, 5, 6, 7; không có heap vì plain
    for (let n = 1; n <= 5; n++) await next(page, n);
    const end = page.getByTestId("drop-range-end");
    await expect(end).toHaveAttribute("data-end", "unread");
    await expect(end).toContainText("chưa được đọc");
    await expect(end).toContainText("không đoán");
    await expect(page.locator("[data-heap]")).toHaveCount(0); // AC3: không có heapPage thì không vẽ heap
    expect(await nodesLit(page)).toBe(5);
    await page.screenshot({ path: `${SHOTS}/vi-1440-thieu-leaf.png` });
  });

  test("AC6 từ lớn hơn đến, sai kiểu, không có đường đi: báo rõ, không có nút chạy", async ({ page }) => {
    await open(page, "vi", "chain", "heap", "3");
    await expect(page.getByTestId("drop-no-path")).toContainText("Khóa từ lớn hơn khóa đến");
    await expect(btn(page, "Chạy")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/vi-1440-tu-lon-hon-den.png` });
    await page.getByLabel("to", { exact: true }).fill("abc");
    await expect(page.getByTestId("drop-no-path")).toContainText("không cùng kiểu");
    await page.screenshot({ path: `${SHOTS}/vi-1440-sai-kieu.png` });
    await page.getByRole("button", { name: "none", exact: true }).click();
    await page.getByLabel("to", { exact: true }).fill("14");
    await expect(page.getByTestId("drop-no-path")).toContainText("Chưa có đường đi tới leaf đầu của khoảng");
    await page.screenshot({ path: `${SHOTS}/vi-1440-khong-duong-di.png` });
    // khoảng chỉ một khóa vẫn chạy, không trượt
    await open(page, "vi", "chain", "plain", "5");
    await expect(page.getByTestId("drop-counter")).toHaveText("Đã đọc 0 / 3 trang");
  });

  test("AC1 giảm chuyển động: nhảy thẳng, cùng số bước", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await btn(page, "Chạy").click();
    await expect(page.getByTestId("drop-counter")).toHaveText("Đã đọc 7 / 7 trang", { timeout: 15_000 });
    await expect(page.getByTestId("drop-reduced")).toBeVisible();
    await settle(page);
    await keyOn(page, "heap");
  });

  test("ca biên: kéo node ở Kéo tự do khi đang chạy; đổi index giữa lúc chạy", async ({ page }) => {
    await open(page);
    for (let n = 1; n <= 3; n++) await next(page, n);
    await page.getByRole("button", { name: "Kéo tự do", exact: true }).first().click();
    const b = (await target(page, 6).boundingBox())!;
    await page.mouse.move(b.x + 20, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + 50, b.y + 70, { steps: 5 });
    await page.mouse.up();
    await next(page, 4);
    await keyOn(page, 6); // key đi theo vị trí mới của node
    await page.screenshot({ path: `${SHOTS}/vi-1440-keo-node.png` });
    await page.getByRole("button", { name: "small", exact: true }).click(); // đổi cây giữa lúc chạy
    await expect(root(page)).toHaveAttribute("data-step", "0");
    await expect(page.getByTestId("drop-no-path")).toContainText("Khóa từ lớn hơn khóa đến"); // cây khác: khóa 121 > 14, báo rõ, không vỡ
  });
});

// Thật: PGlite trong trình duyệt, index int 3000 dòng, đối chiếu leaf animation đã đi với khóa thật trên các leaf.
const SETUP = "CREATE TABLE r(id int PRIMARY KEY); INSERT INTO r SELECT g FROM generate_series(1, 3000) g; SELECT 1";
for (const [w, h, l] of [[1440, 900, "vi"], [390, 844, "en"]] as const) {
  test.describe(`thật ${l} ${w}`, () => {
    test.use({ viewport: { width: w, height: h } });
    test("tab B-Tree: khóa từ 100 đến 1500 trượt qua đúng các leaf của index thật", async ({ page }) => {
      test.setTimeout(240_000);
      const L = { vi: { run: "Chạy", stage: "Mô phỏng", tab: "B-Tree", fwd: "Chạy", end: /([0-9]+) leaf/ }, en: { run: "Run", stage: "Simulation", tab: "B-Tree", fwd: "Run", end: /([0-9]+) leaves/ } }[l];
      await page.route("**/api/me", (r) => r.fulfill({ status: 503, body: "{}" }));
      await page.goto(`/${l}`);
      const tab = page.getByRole("tab", { name: "SQL", exact: true });
      await tab.or(page.locator(".cm-content:visible").first()).first().waitFor();
      if (await tab.isVisible()) await tab.click();
      await page.locator(".cm-content:visible").first().fill(SETUP);
      await page.getByRole("button", { name: L.run, exact: true }).first().click();
      await expect(page.locator("tbody:visible tr")).toHaveCount(1, { timeout: 200_000 });
      const st = page.getByRole("tab", { name: L.stage, exact: true });
      if (await st.isVisible()) await st.click();
      const stage = page.locator("#stage");
      await stage.getByRole("tab", { name: L.tab, exact: true }).click({ timeout: 200_000 });
      await stage.locator("#stage-index").selectOption("r_pkey");
      await stage.locator("#stage-key").fill("100");
      await stage.locator("#stage-key-to").fill("1500");
      await stage.getByTestId("stage-drop").click();
      await expect(stage.getByTestId("btree-drop")).toBeVisible({ timeout: 60_000 });
      const drop = stage.getByTestId("btree-drop");
      await expect(stage.getByTestId("drop-counter")).toContainText(/\/ \d+/);
      const total = Number(/\/\s*(\d+)/.exec(await stage.getByTestId("drop-counter").innerText())![1]);
      for (let n = 1; n <= total; n++) {
        await stage.getByRole("button", { name: l === "vi" ? "Bước tới" : "Step forward", exact: true }).click();
        await expect(drop).toHaveAttribute("data-step", String(n));
        await page.waitForTimeout(150);
        if (n === 1 || n === total) await page.screenshot({ path: `${SHOTS}/that-${l}-${w}-b${n}.png` });
      }
      const note = stage.getByTestId("drop-range-end");
      await expect(note).toHaveAttribute("data-end", "done");
      const leaves = Number(L.end.exec(await note.innerText())![1]);
      expect(leaves).toBeGreaterThan(2);
      // Heap không có ở khóa không tồn tại; ở đây có, nên total = tầng + leaf + 1
      const pages = (await stage.getByTestId("drop-summary").innerText()).replace(/^.*?:/, "").match(/\d+(?: → \d+)+/)![0].split(" → ").map(Number);
      const lp = pages.slice(-leaves);
      // Đối chiếu với các leaf thật trong cây: khóa đầu của mọi leaf, rồi tính leaf nào thuộc [100, 1500].
      const leafKeys = await stage.locator("[data-page]").evaluateAll((els) => {
        const rows = els.map((e) => ({
          page: Number(e.getAttribute("data-page")),
          y: e.getBoundingClientRect().y,
          first: Number(e.querySelector("text.fill-ink2")?.textContent?.trim().replace(/[^\d-]/g, "") ?? "NaN"),
        }));
        const low = Math.max(...rows.map((r) => r.y));
        return rows.filter((r) => Math.abs(r.y - low) < 2);
      });
      console.log("LK", JSON.stringify(leafKeys), JSON.stringify(pages));
      const startFirst = Math.max(...leafKeys.map((k) => k.first).filter((f) => f <= 100));
      const want = leafKeys.filter((k) => k.first >= startFirst && k.first <= 1500).sort((x, y) => x.first - y.first).map((k) => k.page);
      expect(lp).toEqual(want);
      expect(leafKeys.some((k) => k.first > 1500)).toBe(true); // có leaf sau khoảng mà animation không đọc
      expect(total).toBe(pages.length - leaves + leaves + 1);
      await page.screenshot({ path: `${SHOTS}/that-${l}-${w}-cuoi.png` });
    });
  });
}
