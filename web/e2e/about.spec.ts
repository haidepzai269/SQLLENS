import { expect, test, type Page } from "@playwright/test";

type L = "vi" | "en";
const T = {
  vi: { h1: "Thấy database hỏng", open: "Mở SQLLens", login: "Đăng nhập", title: /SQLLens.*database hỏng/, pause: "Dừng video", play: "Phát video", seq: "4.167" },
  en: { h1: "See where it breaks", open: "Open SQLLens", login: "Sign in", title: /SQLLens.*database breaks/, pause: "Pause video", play: "Play video", seq: "4,167" },
} as const;
const BAD = /thiết kế (của bạn |này )?(đã )?ổn|design is (fine|ok|good)|good design/i;

test.beforeEach(({ page }) => page.route("**/api/me", (r) => r.fulfill({ status: 503, body: "{}" })));

const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
// Vị trí cuộn ứng với tỉ lệ f của đoạn giữ màn hình của một cảnh.
const sectionY = (p: Page, id: string, f: number) =>
  p.evaluate(
    ([id, f]) => {
      const s = document.getElementById(id as string)!.closest("section")!;
      return s.getBoundingClientRect().top + scrollY + (s.offsetHeight - innerHeight) * (f as number);
    },
    [id, f] as const,
  );
const scrollToY = async (p: Page, y: number) => {
  await p.evaluate((y) => scrollTo(0, y), y);
  await p.waitForTimeout(350);
};
const goto = async (p: Page, l: L) => {
  await p.goto(`/${l}/about`);
  await expect(p.getByRole("heading", { level: 1 })).toContainText(T[l].h1);
};

for (const l of ["vi", "en"] as const) {
  for (const [name, w, h] of [["1440", 1440, 900], ["390", 390, 844]] as const) {
    test.describe(`${l} ${name}`, () => {
      test.use({ viewport: { width: w, height: h } });

      test("AC1/AC7 hero, tiêu đề, không cuộn ngang, nút dẫn đúng đường", async ({ page }) => {
        await goto(page, l);
        await expect(page).toHaveTitle(T[l].title);
        await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{40,}/);
        expect(await noHScroll(page)).toBe(true);
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); // cuộn nhanh hết trang
        expect(await noHScroll(page)).toBe(true);
        await page.evaluate(() => scrollTo(0, 0)); // rồi quay lại
        await page.getByRole("link", { name: T[l].open }).first().click();
        await expect(page).toHaveURL(new RegExp(`/${l}$`));
        await goto(page, l);
        await page.getByRole("link", { name: T[l].login }).last().click();
        await expect(page).toHaveURL(new RegExp(`/${l}\\?engine=mysql$`));
      });

      test("AC2 bốn cảnh cuộn chạy theo vị trí cuộn", async ({ page }) => {
        const errs: string[] = [];
        page.on("pageerror", (e) => errs.push(String(e)));
        await goto(page, l);
        await page.waitForLoadState("networkidle");
        // cảnh 1: đường đi của key sáng dần theo cuộn
        const lit = () => page.locator("#descent-h").locator("xpath=ancestor::section").locator("[data-lit-e]").evaluateAll((els) => els.map((e) => +getComputedStyle(e).opacity));
        await scrollToY(page, await sectionY(page, "descent-h", 0.05));
        const early = (await lit()).reduce((a, b) => a + b, 0);
        await scrollToY(page, await sectionY(page, "descent-h", 0.95));
        const late = (await lit()).reduce((a, b) => a + b, 0);
        expect(early).toBeLessThan(late);
        expect(late).toBeGreaterThan(2.5); // root-b, b-l2, l2-heap
        // cảnh 2: đầu cảnh là số đã đo ở 10.000 dòng, cuối cảnh là ở 500.000 dòng
        await scrollToY(page, await sectionY(page, "race-h", 0.02));
        await expect(page.locator("[data-seq-n]")).toContainText("84");
        await scrollToY(page, await sectionY(page, "race-h", 0.98));
        await expect(page.locator("[data-seq-n]")).toContainText(T[l].seq);
        await expect(page.locator("[data-idx-n]")).toContainText("16");
        // cảnh 3: cuối cảnh có nhãn một bên bị hủy
        await scrollToY(page, await sectionY(page, "lock-h", 0.98));
        expect(+(await page.locator("[data-abort]").evaluate((e) => getComputedStyle(e).opacity))).toBeGreaterThan(0.9);
        // cảnh 4: cuối cảnh là mốc không chạy thật, nhãn Ước lượng
        await scrollToY(page, await sectionY(page, "scale-h", 0.98));
        await expect(page.locator("[data-tag=est]")).toBeVisible();
        expect(errs).toEqual([]);
      });

      test("AC3/AC4 video có poster và tải lười, chữ không hàm ý thiết kế ổn, đủ ba nhãn", async ({ page }) => {
        const media: string[] = [];
        page.on("request", (r) => /demo-.*\.webm/.test(r.url()) && media.push(r.url()));
        await goto(page, l);
        await page.waitForLoadState("networkidle");
        expect(media).toEqual([]); // chưa cuộn tới thì chưa tải video
        const video = page.locator("video");
        await expect(video).toHaveAttribute("poster", new RegExp(`demo-${l}\\.jpg`));
        await expect(video).toHaveAttribute("preload", "none");
        expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
        const head = await page.request.head(`/about/demo-${l}.webm`);
        expect(Number(head.headers()["content-length"])).toBeLessThan(8 * 1024 * 1024);
        await video.scrollIntoViewIfNeeded();
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused), { timeout: 15_000 }).toBe(true);
        await page.getByRole("button", { name: T[l].pause }).click();
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
        await expect(page.getByRole("button", { name: T[l].play })).toBeVisible();
        const text = await page.locator("main").innerText();
        // Mục "Điều SQLLens không nói" nêu câu cấm đó dưới dạng phủ định, nên bỏ mục này khi tìm câu hàm ý thiết kế ổn.
        const rest = await page.locator("main").evaluate((m) => {
          const c = m.cloneNode(true) as HTMLElement;
          c.querySelector("#limits-h")!.closest("section")!.remove();
          return c.textContent ?? "";
        });
        expect(rest).not.toMatch(BAD);
        expect(text).toMatch(BAD); // mục bị loại đúng là mục chứa câu phủ định, kiểm để test này không trượt im lặng
        for (const tag of l === "vi" ? ["Thật", "Mô phỏng", "Ước lượng"] : ["Real", "Simulated", "Estimated"]) expect(text).toContain(tag);
        expect(text).toContain(T[l].seq);
      });

      test("AC5 giảm chuyển động: không tự chạy, video không tự phát, nội dung vẫn đọc được", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await goto(page, l);
        await page.waitForLoadState("networkidle");
        const video = page.locator("video");
        await video.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1500);
        expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
        for (const id of ["descent-h", "lock-h", "scale-h"]) {
          const li = page.locator(`#${id}`).locator("xpath=ancestor::section").locator("ol > li");
          const n = await li.count();
          for (let i = 0; i < n; i++) expect(+(await li.nth(i).evaluate((e) => getComputedStyle(e).opacity))).toBe(1);
          const tops = await li.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
          expect(new Set(tops).size).toBe(n); // các bước không chồng lên nhau
        }
        // hero: key đứng yên
        const chip = page.locator("[data-chip]").first();
        const a = await chip.evaluate((e) => getComputedStyle(e).opacity + e.getAttribute("transform"));
        await page.waitForTimeout(1200);
        expect(await chip.evaluate((e) => getComputedStyle(e).opacity + e.getAttribute("transform"))).toBe(a);
        expect(await noHScroll(page)).toBe(true);
      });
    });
  }

  test(`${l}: không tải WASM của PGlite khi mở trang`, async ({ page }) => {
    const wasm: string[] = [];
    page.on("request", (r) => /\.wasm/.test(r.url()) && wasm.push(r.url()));
    await goto(page, l);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);
    expect(wasm).toEqual([]);
  });

  test(`${l}: video lỗi thì vẫn thấy poster`, async ({ page }) => {
    await page.route("**/about/*.webm", (r) => r.abort());
    await goto(page, l);
    await page.locator("video").scrollIntoViewIfNeeded();
    const poster = page.locator(`img[src$="demo-${l}.jpg"]`);
    await expect(poster).toBeVisible({ timeout: 15_000 });
    expect(await poster.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  });

  test(`${l}: bàn phím, focus thấy rõ`, async ({ page }) => {
    await goto(page, l);
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      return { tag: e.tagName, w: parseFloat(getComputedStyle(e).outlineWidth), s: getComputedStyle(e).outlineStyle };
    });
    expect(["A", "BUTTON"]).toContain(f.tag);
    expect(f.s).not.toBe("none");
    expect(f.w).toBeGreaterThanOrEqual(2);
  });
}

test("đổi ngôn ngữ giữa trang vẫn ở /about và cảnh vẫn chạy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, "vi");
  await scrollToY(page, await sectionY(page, "race-h", 0.5));
  await page.getByRole("button", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/about$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("See where it breaks");
  await scrollToY(page, await sectionY(page, "race-h", 0.98));
  await expect(page.locator("[data-seq-n]:visible")).toContainText("4,167");
});

test("cửa sổ rất rộng 2560 không cuộn ngang", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1300 });
  await goto(page, "en");
  expect(await noHScroll(page)).toBe(true);
});
