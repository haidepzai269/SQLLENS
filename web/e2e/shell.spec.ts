import { expect, test, type Page } from "@playwright/test";

// DOM có thể giữ bản cũ đã ẩn sau khi đổi ngôn ngữ, nên chỉ chọn phần tử đang hiển thị (xem bàn giao Task007).
const width = async (p: Page, sel: string) => (await p.locator(`${sel}:visible`).boundingBox())!.width;
const toggle = (p: Page, name: RegExp) => p.getByRole("button", { name }).filter({ visible: true });
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.describe("máy tính 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1 đổi ngôn ngữ giữ trang và tham số engine", async ({ page }) => {
    await page.goto("/vi?engine=mysql");
    await expect(page.getByRole("tab", { name: "MySQL" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Cột SQL" })).toBeVisible();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en\?engine=mysql$/);
    await expect(page.getByRole("button", { name: "SQL column" }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "MySQL" }).filter({ visible: true })).toHaveAttribute("aria-selected", "true");
  });

  test("ca biên engine=abc về PostgreSQL, chọn MySQL ghi lên URL", async ({ page }) => {
    await page.goto("/en?engine=abc");
    const pg = page.getByRole("tab", { name: "PostgreSQL" });
    await expect(pg).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "MySQL" }).click();
    await expect(page).toHaveURL(/engine=mysql/);
  });

  test("AC2 tab khóa không đổi engine và có giải thích (chuột, bàn phím)", async ({ page }) => {
    await page.goto("/en?engine=postgres");
    const status = page.getByRole("status").filter({ visible: true });
    await page.getByRole("tab", { name: "NoSQL" }).click({ force: true });
    await expect(page).toHaveURL(/engine=postgres/);
    await expect(status).toContainText("NoSQL is not available");
    await expect(page.getByRole("tab", { name: "PostgreSQL" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "PostgreSQL" }).focus();
    for (const k of ["ArrowRight", "ArrowRight", "ArrowRight"]) await page.keyboard.press(k);
    await expect(page.getByRole("tab", { name: "LSM-Tree" })).toBeFocused();
    await expect(status).toContainText("LSM-Tree is not available");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/engine=postgres/);
  });

  test("AC4/AC7/AC9 tắt vùng thì vùng còn lại giãn, nhớ sau khi tải lại, không tắt vùng cuối", async ({ page }) => {
    await page.goto("/en");
    const before = await width(page, "#stage");
    await toggle(page, /SQL column/).click();
    await expect(page.locator("#sql")).toHaveCount(0);
    expect(await width(page, "#stage")).toBeGreaterThan(before + 200);
    await page.reload();
    await expect(page.locator("#sql")).toHaveCount(0);
    expect(await noHScroll(page)).toBe(true);
    for (const n of [/Simulation area/, /Risk column/]) await toggle(page, n).click();
    await expect(page.locator("#terminal")).toBeVisible();
    await expect(toggle(page, /Terminal/)).toHaveAttribute("aria-disabled", "true");
    await toggle(page, /Terminal/).click({ force: true });
    await expect(page.locator("#terminal")).toBeVisible();
    await toggle(page, /SQL column/).click();
    await expect(page.locator("#sql")).toBeVisible();
  });

  test("AC8 đổi kích thước bằng phím mũi tên và chuột, nhớ sau khi tải lại", async ({ page }) => {
    await page.goto("/en");
    const sep = page.getByRole("separator").first();
    const w0 = await width(page, "#sql");
    await sep.focus();
    await page.keyboard.press("ArrowRight");
    const w1 = await width(page, "#sql");
    expect(w1).toBeGreaterThan(w0);
    const box = (await sep.boundingBox())!;
    await page.mouse.move(box.x + 0.5, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 100.5, box.y + 200, { steps: 5 });
    await page.mouse.up();
    const w2 = await width(page, "#sql");
    expect(w2).toBeGreaterThan(w1 + 50);
    await page.reload();
    await expect(page.locator("#sql")).toBeVisible();
    expect(Math.abs((await width(page, "#sql")) - w2)).toBeLessThan(3);
  });

  test("localStorage hỏng hoặc bị chặn thì trang vẫn chạy", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error("blocked");
      };
      Storage.prototype.setItem = () => {
        throw new Error("blocked");
      };
    });
    await page.goto("/vi");
    await expect(page.locator("#sql")).toBeVisible();
    await toggle(page, /Cột SQL/).click();
    await expect(page.locator("#sql")).toHaveCount(0);
  });

  test("localStorage chứa rác thì dùng mặc định", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sqllens.layout", '{"open":{"sql":false,"stage":false,"findings":false,"terminal":false},"size":{"sql":-5}}'));
    await page.goto("/vi");
    for (const z of ["#sql", "#stage", "#findings", "#terminal"]) await expect(page.locator(z)).toBeVisible();
  });

  for (const l of ["vi", "en"]) {
    test(`AC4 ${l}: không cuộn ngang ở 1440, /lab vẫn chạy trong khung`, async ({ page }) => {
      await page.goto(`/${l}`);
      await expect(page.locator("#sql")).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
      await page.goto(`/${l}/lab`);
      await expect(page.getByRole("tab", { name: "MySQL" })).toBeVisible();
      await expect(page.locator("textarea:visible")).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
    });
  }
});

test.describe("điện thoại 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const l of ["vi", "en"]) {
    test(`AC3/AC4 ${l}: bốn tab ở đáy dùng đúng role, bàn phím, không cuộn ngang`, async ({ page }) => {
      await page.goto(`/${l}`);
      const tabs = page.getByRole("tablist").last().getByRole("tab");
      await expect(tabs).toHaveCount(4);
      await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
      await tabs.nth(1).focus();
      await page.keyboard.press("ArrowLeft");
      await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#sql")).toBeVisible();
      await expect(page.locator("#stage")).toBeHidden();
      await tabs.nth(3).click();
      await expect(page.locator("#terminal")).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
      await expect(page.getByRole("separator")).toHaveCount(0);
    });
  }
});
