import { expect, test, type Page } from "@playwright/test";

const SHOTS = "../_bmad-output/SP007/STR032/Task049";
const TOTAL = { nl: 4, nlIndex: 4, hash: 10, merge: 9 } as const;
const MERGE_PTRS = [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3], [1, 4], [2, 4], [3, 4], [3, 5]];

const open = async (p: Page, which = "nl", l = "vi", engine = "postgres") => {
  await p.goto(`/${l}/e2e-join`);
  await p.getByRole("button", { name: which, exact: true }).click();
  if (engine !== "postgres") await p.getByRole("button", { name: engine, exact: true }).click();
};
const root = (p: Page) => p.getByTestId("join-anim");
const step = async (p: Page) => Number(await root(p).getAttribute("data-step"));
const btn = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
const box = async (p: Page, id: string) => ((await p.getByTestId(id).count()) ? await p.getByTestId(id).boundingBox() : null);
const cy = (b: { y: number; height: number } | null) => (b ? b.y + b.height / 2 : NaN);
const chipY = async (p: Page, chip: string) => cy(await p.locator(`[data-chip="${chip}"] rect`).boundingBox());
// chờ tween dừng hẳn: hai lần đo cách nhau 150 ms phải giống nhau và timeline không còn chạy
const settle = async (p: Page) => {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify([await box(p, "join-ptr-a"), await box(p, "join-ptr-b"), await root(p).getAttribute("data-playing")]);
      const same = now === last;
      last = now;
      await p.waitForTimeout(150);
      return same;
    })
    .toBe(true);
};
const forward = async (p: Page, to: number, next = "Bước tới") => {
  while ((await step(p)) < to) {
    const k = await step(p);
    await btn(p, next).click();
    await expect(root(p)).toHaveAttribute("data-step", String(k + 1));
  }
  await settle(p);
};
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const timelines = (p: Page) => p.evaluate(() => (window as unknown as { timelineCount: () => number }).timelineCount());

test.beforeEach(() => test.setTimeout(120_000)); // mỗi bước tween mất gần 1 giây

test.describe("máy tính 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC3 trạng thái đầu tĩnh, không tự chạy", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("join-label")).toHaveText("Mô phỏng");
    await expect(page.getByTestId("join-explain")).toContainText("Chưa chạy");
    await expect(page.getByTestId("join-counter")).toHaveText("Bước 0 / 4");
    await page.waitForTimeout(1800);
    expect(await step(page)).toBe(0);
    await expect(root(page)).not.toHaveAttribute("data-playing", "true");
    await expect(page.getByTestId("join-ptr-a")).toHaveCount(0);
  });

  test("AC1 Nested Loop: con trỏ ngoài đứng đúng dòng, đếm 24 lần so khóa, chụp từng bước", async ({ page }) => {
    await open(page, "nl");
    for (let n = 1; n <= TOTAL.nl; n++) {
      await forward(page, n);
      expect(Math.abs(cy(await box(page, "join-ptr-a")) - (await chipY(page, `a${n - 1}`)))).toBeLessThan(1.5);
      await expect(page.locator('[data-chip^="b"][data-state="probed"], [data-chip^="b"][data-state="hit"]')).toHaveCount(6);
      await page.screenshot({ path: `${SHOTS}/vi-1440-nl-b${n}.png` });
    }
    await expect(page.getByTestId("join-stats")).toHaveText("Đã so khóa 24 lần, ra 4 cặp khớp.");
    await expect(page.getByTestId("join-explain")).toContainText("dò cả 6 dòng bảng trong");
  });

  test("AC1 Nested Loop có index ở bảng trong: chỉ tra một lần mỗi dòng ngoài", async ({ page }) => {
    await open(page, "nlIndex");
    await forward(page, 4);
    await expect(page.getByTestId("join-stats")).toHaveText("Đã so khóa 4 lần, ra 4 cặp khớp.");
    await expect(page.getByTestId("join-explain")).toContainText("tra index");
  });

  test("AC1 Hash Join: dựng 6 dòng vào ô băm rồi dò 4 dòng, chụp từng bước", async ({ page }) => {
    await open(page, "hash");
    for (let n = 1; n <= TOTAL.hash; n++) {
      await forward(page, n);
      if (n <= 6) {
        expect(Math.abs(cy(await box(page, "join-ptr-b")) - (await chipY(page, `b${n - 1}`)))).toBeLessThan(1.5);
        await expect(page.locator('[data-chip^="b"][data-state="built"], [data-chip^="b"][data-state="active"]')).toHaveCount(n);
        await expect(page.getByTestId("join-explain")).toContainText("băm vào ô");
      } else await expect(page.getByTestId("join-explain")).toContainText("băm ra ô");
      await expect(page.locator("[data-bucket][data-lit]")).toHaveCount(1);
      await page.screenshot({ path: `${SHOTS}/vi-1440-hash-b${n}.png` });
    }
    await expect(page.getByTestId("join-stats")).toHaveText("Đã so khóa 8 lần, ra 4 cặp khớp.");
    await expect(page.locator('[data-bucket="0"]')).toContainText("3  3  6");
  });

  test("AC1 Merge Join: hai con trỏ chỉ tiến, đứng đúng dòng, chụp từng bước", async ({ page }) => {
    await open(page, "merge");
    let lastA = -Infinity;
    let lastB = -Infinity;
    for (let n = 1; n <= TOTAL.merge; n++) {
      await forward(page, n);
      const [a, b] = MERGE_PTRS[n - 1];
      const ya = cy(await box(page, "join-ptr-a"));
      const yb = cy(await box(page, "join-ptr-b"));
      expect(Math.abs(ya - (await chipY(page, `a${a}`)))).toBeLessThan(1.5);
      expect(Math.abs(yb - (await chipY(page, `b${b}`)))).toBeLessThan(1.5);
      expect(ya).toBeGreaterThanOrEqual(lastA);
      expect(yb).toBeGreaterThanOrEqual(lastB);
      [lastA, lastB] = [ya, yb];
      await page.screenshot({ path: `${SHOTS}/vi-1440-merge-b${n}.png` });
    }
    await expect(page.getByTestId("join-stats")).toHaveText("Đã so khóa 9 lần, ra 4 cặp khớp.");
  });

  test("AC3 Bước lùi và Về đầu trả đúng trạng thái; thanh tua nhảy thẳng", async ({ page }) => {
    await open(page, "hash");
    await forward(page, 8);
    const at8 = await page.getByTestId("join-stats").textContent();
    await forward(page, 9);
    await btn(page, "Bước lùi").click();
    await expect(root(page)).toHaveAttribute("data-step", "8");
    await settle(page);
    await expect(page.getByTestId("join-stats")).toHaveText(at8!);
    await expect(page.locator("[data-bucket][data-lit]")).toHaveCount(1);
    await btn(page, "Về đầu").click();
    await expect(root(page)).toHaveAttribute("data-step", "0");
    await expect(page.locator('[data-chip][data-state]:not([data-state="idle"])')).toHaveCount(0);
    await expect(page.getByTestId("join-ptr-b")).toHaveCount(0);
    await page.getByTestId("join-scrub").evaluate((el: HTMLInputElement) => {
      el.value = el.max;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(root(page)).toHaveAttribute("data-step", "10");
    await expect(btn(page, "Bước tới")).toBeDisabled();
  });

  test("AC3 Chạy tự đi hết, Tạm dừng dừng lại, Chạy lại sau khi xong", async ({ page }) => {
    await open(page, "nl");
    await btn(page, "Chạy").click();
    await expect(root(page)).toHaveAttribute("data-playing", "true");
    await expect(btn(page, "Tạm dừng")).toBeEnabled();
    await btn(page, "Tạm dừng").click();
    await expect(root(page)).not.toHaveAttribute("data-playing", "true");
    const frozen = await page.getByTestId("join-ptr-a").getAttribute("data-y");
    await page.waitForTimeout(700);
    expect(await page.getByTestId("join-ptr-a").getAttribute("data-y")).toBe(frozen);
    await btn(page, "Chạy").click();
    await expect(page.getByTestId("join-counter")).toHaveText("Bước 4 / 4", { timeout: 12_000 });
    await expect(btn(page, "Chạy lại")).toBeEnabled();
    await btn(page, "Chạy lại").click();
    await expect(root(page)).toHaveAttribute("data-playing", "true");
  });

  test("AC4 dòng 'mẫu minh họa' lấy N từ node; 0, thiếu và ước tính", async ({ page }) => {
    await open(page, "nl");
    await expect(page.getByTestId("join-sample")).toContainText("mẫu minh họa nhỏ");
    await expect(page.getByTestId("join-rows")).toHaveText("Plan thật có 100 dòng.");
    await page.getByRole("button", { name: "hash", exact: true }).click();
    await expect(page.getByTestId("join-rows")).toHaveText("Plan thật có 5.000 dòng.");
    await page.getByRole("button", { name: "zero", exact: true }).click();
    await expect(page.getByTestId("join-rows")).toHaveText("Plan thật có 0 dòng.");
    await page.getByRole("button", { name: "noRows", exact: true }).click();
    await expect(page.getByTestId("join-rows")).toHaveText("Plan không cho biết số dòng.");
    await page.getByRole("button", { name: "est", exact: true }).click();
    await expect(page.getByTestId("join-rows")).toHaveText("Plan thật ước tính 40 dòng (chưa chạy thật).");
    await forward(page, 4);
    await expect(root(page)).not.toContainText(/\b\d+(,\d+)? ?(ms|giây|s)\b/);
  });

  test("AC2 Merge Join trên MySQL và node không phải join: chưa mô phỏng được, không có điều khiển", async ({ page }) => {
    await open(page, "merge", "vi", "mysql");
    await expect(page.getByTestId("join-unsupported")).toHaveAttribute("data-reason", "noMerge");
    await expect(page.getByTestId("join-unsupported")).toContainText("Chưa mô phỏng được: MySQL không có Merge Join");
    await expect(root(page)).toHaveCount(0);
    await expect(btn(page, "Chạy")).toHaveCount(0);
    await page.getByRole("button", { name: "scan", exact: true }).click();
    await expect(page.getByTestId("join-unsupported")).toHaveAttribute("data-reason", "notJoin");
    await page.getByRole("button", { name: "hash", exact: true }).click();
    await expect(root(page)).toHaveCount(1); // MySQL vẫn có hash join
    await page.screenshot({ path: `${SHOTS}/vi-1440-mysql-hash.png` });
  });

  test("AC5 giảm chuyển động: không có chuyển tiếp, vẫn đi từng bước, có tóm tắt văn bản", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "merge");
    await expect(page.getByTestId("join-reduced")).toContainText("Giảm chuyển động đang bật");
    await expect(page.getByTestId("join-summary")).toHaveText("Merge Join trên mẫu: 9 bước, 9 lần so khóa, 4 cặp khớp.");
    await btn(page, "Bước tới").click();
    await expect(root(page)).toHaveAttribute("data-step", "1");
    // nhảy ngay: khoảng 100 ms sau đã đứng đúng chỗ, không cần đợi tween
    const y1 = await box(page, "join-ptr-b");
    await btn(page, "Bước tới").click();
    await expect(root(page)).toHaveAttribute("data-step", "2");
    const y2 = await box(page, "join-ptr-b");
    await page.waitForTimeout(100);
    expect(await box(page, "join-ptr-b")).toEqual(y2);
    expect(y2!.y).toBeGreaterThan(y1!.y);
    await page.screenshot({ path: `${SHOTS}/vi-1440-giam-chuyen-dong.png` });
  });

  test("AC5 dùng bằng bàn phím: Tab tới nút, Enter bước tới, mũi tên trên thanh tua", async ({ page }) => {
    await open(page, "nl");
    await btn(page, "Về đầu").focus();
    await page.keyboard.press("Tab"); // sang thanh tua
    await expect(page.getByTestId("join-scrub")).toBeFocused();
    await btn(page, "Bước tới").focus();
    await page.keyboard.press("Enter");
    await expect(root(page)).toHaveAttribute("data-step", "1");
    await btn(page, "Về đầu").focus();
    await page.keyboard.press("Space");
    await expect(root(page)).toHaveAttribute("data-step", "0");
    await expect(page.getByRole("img", { name: /Nested Loop/ })).toBeVisible();
    await expect(page.getByTestId("join-explain")).toHaveAttribute("aria-live", "polite");
  });

  test("ca biên: rời trang giữa lúc chạy thì dọn timeline", async ({ page }) => {
    await open(page, "hash");
    const base = await timelines(page);
    await btn(page, "Chạy").click();
    await expect(root(page)).toHaveAttribute("data-playing", "true");
    await page.getByRole("button", { name: "unmount", exact: true }).click();
    await expect(root(page)).toHaveCount(0);
    await expect.poll(() => timelines(page)).toBeLessThan(base); // timeline của Scene đã bị kill
    await page.waitForTimeout(1200);
    await expect(page.locator("pre")).toHaveCount(0); // không lỗi đỏ của Next sau khi dọn
  });

  test("đổi node giữa lúc chạy dựng lại từ bước 0", async ({ page }) => {
    await open(page, "nl");
    await forward(page, 2);
    await page.getByRole("button", { name: "hash", exact: true }).click();
    await expect(root(page)).toHaveAttribute("data-step", "0");
    await expect(page.getByTestId("join-counter")).toHaveText("Bước 0 / 10");
  });
});

test.describe("tiếng Anh 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  for (const [which, label] of [["nl", "Nested Loop"], ["hash", "Hash Join"], ["merge", "Merge Join"]] as const) {
    test(`en ${which}`, async ({ page }) => {
      await open(page, which, "en");
      await expect(page.getByTestId("join-label")).toHaveText("Simulated");
      await expect(page.getByTestId("join-sample")).toContainText("small illustrative sample");
      await expect(page.getByTestId("join-explain")).toContainText("Not run yet");
      await forward(page, 3, "Step forward");
      await expect(page.getByTestId("join-explain")).toContainText("Step 3:");
      await expect(page.getByTestId("join-counter")).toContainText("Step 3 /");
      await expect(page.getByRole("img", { name: new RegExp(label) })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/en-1440-${which}-b3.png` });
    });
  }
  test("en: chưa mô phỏng được", async ({ page }) => {
    await open(page, "merge", "en", "mysql");
    await expect(page.getByTestId("join-unsupported")).toContainText("Not simulated: MySQL has no Merge Join");
  });
});

test.describe("điện thoại 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  for (const [which, total] of [["nl", 4], ["hash", 10], ["merge", 9]] as const) {
    test(`390: ${which} không cuộn ngang, chụp từng bước (vi)`, async ({ page }) => {
      await open(page, which);
      expect(await noHScroll(page)).toBe(true);
      for (let n = 1; n <= total; n++) {
        await forward(page, n);
        expect(await noHScroll(page)).toBe(true);
        const svg = (await page.getByTestId("join-svg").boundingBox())!;
        expect(svg.x).toBeGreaterThanOrEqual(0);
        expect(svg.x + svg.width).toBeLessThanOrEqual(390);
        const ex = (await page.getByTestId("join-explain").boundingBox())!;
        expect(ex.x + ex.width).toBeLessThanOrEqual(390);
        await page.screenshot({ path: `${SHOTS}/vi-390-${which}-b${n}.png`, fullPage: true });
      }
    });
  }
  test("390: tiếng Anh và trường hợp chưa mô phỏng không cuộn ngang", async ({ page }) => {
    await open(page, "hash", "en");
    await forward(page, 7, "Step forward");
    expect(await noHScroll(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/en-390-hash-b7.png`, fullPage: true });
    await page.getByRole("button", { name: "mysql", exact: true }).click();
    await page.getByRole("button", { name: "merge", exact: true }).click();
    await expect(page.getByTestId("join-unsupported")).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/en-390-mysql-merge.png`, fullPage: true });
  });
});
