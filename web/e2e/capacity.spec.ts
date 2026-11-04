import { expect, test, type Page } from "@playwright/test";

const SHOTS = "../_bmad-output/SP010/STR047/Task057";
type L = "vi" | "en";
const T = {
  vi: { real: "Thật", est: "Ước lượng", cancelled: /Đã hủy/, unmeasured: /chưa đo/, noIndex: /Chưa có index này/, bcp: "vi-VN" },
  en: { real: "Real", est: "Estimated", cancelled: /Cancelled/, unmeasured: /not measured yet/, noIndex: /does not exist on the table/, bcp: "en-US" },
} as const;

type Sample = { height: number; indexPages: number; pagesRead?: number; rows: number };
type Point = { rows: number; height: number; indexBytes: number; pagesRead?: number };
type Out<D> = { kind: "conclusion"; label: string; data: D } | { kind: "not_simulated"; reasonKey: string };
type Cap = {
  ref(n: number): Promise<Out<Sample>>;
  estimateCapacity(s: Sample, rows: number): Out<Point>;
  samplePoint(s: Sample): Point;
  count(): Promise<number>;
  leftovers(): Promise<number>;
};
declare global {
  interface Window {
    cap: Cap;
  }
}

// Máy bận thì mỗi lần khởi tạo PGlite có thể mất vài chục giây.
test.describe.configure({ timeout: 300_000 });

async function open(p: Page, l: L, query = "") {
  await p.goto(`/${l}/e2e-capacity${query}`);
  await expect(p.getByTestId("capacity-panel")).toBeVisible({ timeout: 120_000 });
  await p.waitForFunction(() => !!window.cap);
}
const fmtBytes = (b: number, l: L) => {
  let v = b;
  let i = 0;
  while (v >= 1024 && i < 4) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(T[l].bcp, { maximumFractionDigits: i ? 1 : 0 }).format(v)} ${["B", "KB", "MB", "GB", "TB"][i]}`;
};
const fmtN = (n: number, l: L) => new Intl.NumberFormat(T[l].bcp).format(n);
const label = (p: Page) => p.getByTestId("capacity-label");

// Đọc số đang hiện và so với điểm tính trực tiếp bằng hàm của Task055 (độc lập với giao diện).
async function expectShown(p: Page, l: L, pt: Point, estimated: boolean) {
  const a = (s: string) => (estimated ? (l === "vi" ? `≈ ${s}` : `≈ ${s}`) : s);
  await expect(p.getByTestId("capacity-height")).toHaveText(a(fmtN(pt.height, l)));
  await expect(p.getByTestId("capacity-size")).toHaveText(a(fmtBytes(pt.indexBytes, l)));
  await expect(p.getByTestId("capacity-size")).toHaveAttribute("data-raw", String(pt.indexBytes));
  if (pt.pagesRead !== undefined) await expect(p.getByTestId("capacity-pages")).toHaveText(a(fmtN(pt.pagesRead, l)));
  await expect(p.getByTestId("capacity-tiers")).toHaveAttribute("data-height", String(pt.height));
  await expect(label(p)).toHaveAttribute("data-label", estimated ? "estimated" : "real");
  await expect(label(p)).toHaveText(estimated ? T[l].est : T[l].real);
}
const measure = async (p: Page, n: number) => {
  await p.getByTestId(`level-measure-${n}`).click();
  await expect(p.getByTestId(`level-status-${n}`)).not.toHaveText(/Đang đo|Measuring/, { timeout: 280_000 });
  await expect(p.getByTestId("capacity-error")).toHaveCount(0);
};
const ref = async (p: Page, n: number) => {
  const r = await p.evaluate((x) => window.cap.ref(x), n);
  if (r.kind !== "conclusion") throw new Error(r.reasonKey);
  return r.data;
};
// Khung chính của ứng dụng có chiều cao cố định và tự cuộn, nên nới khung nhìn để cả thẻ nằm trong ảnh.
const shot = async (p: Page, path: string) => {
  const v = p.viewportSize()!;
  await p.setViewportSize({ width: v.width, height: 2400 });
  await p.getByTestId("capacity-panel").screenshot({ path });
  await p.setViewportSize(v);
};
const noTime = async (p: Page) => {
  // Các khối số và câu nguồn; vùng cây bị bỏ vì khóa sinh ra có thể chứa chữ số theo sau bởi chữ s.
  const text = (await p.locator("[data-testid^=capacity-]:not([data-testid=capacity-panel]):not([data-testid=capacity-tiers])").allInnerTexts()).join(" | ");
  expect(text).not.toMatch(/QPS/i);
  expect(text).not.toMatch(/\d\s?(ms|s|giây|seconds?)\b/i);
};

test.describe("máy tính 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1 AC2 AC3 hủy, đo 10k và 100k, kéo qua 500k, kéo về, vi", async ({ page }) => {
    await open(page, "vi");
    const sl = page.getByTestId("capacity-slider");
    // chưa đo: không có số nào, không phải số 0
    await expect(page.getByTestId("capacity-unmeasured")).toContainText(T.vi.unmeasured);
    await expect(page.getByTestId("capacity-height")).toHaveCount(0);

    // hủy giữa lúc nạp: bảng của người dùng giữ nguyên, bảng tạm bị xóa
    await page.getByTestId("level-measure-100000").click();
    await expect(page.getByTestId("capacity-progress")).toBeVisible();
    await page.getByTestId("level-cancel").click();
    await expect(page.getByTestId("capacity-cancelled")).toContainText(T.vi.cancelled, { timeout: 60_000 });
    expect(await page.evaluate(() => window.cap.count())).toBe(3);
    expect(await page.evaluate(() => window.cap.leftovers())).toBe(0);
    await expect(page.getByTestId("level-measure-100000")).toBeEnabled();

    // 10k
    await measure(page, 10_000);
    const r10 = await ref(page, 10_000);
    await expectShown(page, "vi", await page.evaluate((s) => window.cap.samplePoint(s), r10), false);

    // 100k
    await measure(page, 100_000);
    const r100 = await ref(page, 100_000);
    const p100 = await page.evaluate((s) => window.cap.samplePoint(s), r100);
    await expectShown(page, "vi", p100, false);
    await expect(page.getByTestId("btree-view")).toBeVisible();
    await expect(page.getByTestId("btree-label")).toHaveAttribute("data-label", "real");
    await noTime(page);
    await shot(page, `${SHOTS}/vi-1440-real.png`);

    // kéo qua 500k bằng bàn phím: 100k -> 500k (thật, chưa đo) -> 1M (ước lượng)
    await sl.focus();
    await page.keyboard.press("ArrowRight");
    await expect(label(page)).toHaveCount(0); // mốc chưa đo thì không gắn nhãn kết luận
    await expect(page.getByTestId("capacity-warn500k")).toBeVisible();
    await expect(page.getByTestId("capacity-height")).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("capacity-rows")).toHaveAttribute("data-raw", "1000000");
    const est = await page.evaluate((s) => window.cap.estimateCapacity(s, 1_000_000), r100);
    if (est.kind !== "conclusion") throw new Error(est.reasonKey);
    await expectShown(page, "vi", est.data, true);
    await expect(page.getByTestId("btree-view")).toHaveCount(0);
    await expect(page.getByTestId("capacity-estimated-tree")).toBeVisible();
    await noTime(page);
    await shot(page, `${SHOTS}/vi-1440-est.png`);

    // số tầng tăng khi kéo xa hơn: đọc từ màn hình và so với công thức ở 1 tỷ dòng
    await sl.press("End");
    const big = await page.evaluate((s) => window.cap.estimateCapacity(s, 1_000_000_000), r100);
    if (big.kind !== "conclusion") throw new Error(big.reasonKey);
    expect(big.data.height).toBeGreaterThan(est.data.height);
    await expectShown(page, "vi", big.data, true);

    // kéo nhanh liên tục rồi về đúng mốc
    for (let i = 0; i < 12; i++) await sl.press("ArrowLeft");
    await expect(page.getByTestId("capacity-rows")).toHaveAttribute("data-raw", "10000");
    for (let i = 0; i < 3; i++) await sl.press("ArrowRight");
    await expect(page.getByTestId("capacity-rows")).toHaveAttribute("data-raw", "1000000");
    for (let i = 0; i < 2; i++) await sl.press("ArrowLeft");
    await expect(page.getByTestId("capacity-rows")).toHaveAttribute("data-raw", "100000");
    await expectShown(page, "vi", p100, false);
    expect(await page.evaluate(() => window.cap.count())).toBe(3);
    expect(await page.evaluate(() => window.cap.leftovers())).toBe(0);
  });

  test("ca biên: chưa có index thì báo lý do và không cho đo", async ({ page }) => {
    await open(page, "en", "?case=noindex");
    await expect(page.getByTestId("capacity-blocked")).toContainText(T.en.noIndex);
    await expect(page.getByTestId("level-measure-10000")).toBeDisabled();
  });

  test("ảnh en 1440: đo 10k rồi kéo qua 500k", async ({ page }) => {
    await open(page, "en");
    await measure(page, 10_000);
    await shot(page, `${SHOTS}/en-1440-real.png`);
    await page.getByTestId("capacity-slider").focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await expect(label(page)).toHaveAttribute("data-label", "estimated");
    await shot(page, `${SHOTS}/en-1440-est.png`);
  });

  test("AC1 mốc 500k thật, có cảnh báo RAM, so với đo trực tiếp (nặng)", async ({ page }) => {
    test.setTimeout(900_000);
    await open(page, "en");
    await page.getByRole("button", { name: /^500,000 rows$/ }).click();
    await expect(page.getByTestId("capacity-warn500k")).toContainText("600 MB");
    await measure(page, 500_000);
    const r = await ref(page, 500_000);
    await expectShown(page, "en", await page.evaluate((s) => window.cap.samplePoint(s), r), false);
    await page.getByTestId("capacity-slider").focus();
    await page.keyboard.press("ArrowRight");
    const est = await page.evaluate((s) => window.cap.estimateCapacity(s, 1_000_000), r);
    if (est.kind !== "conclusion") throw new Error(est.reasonKey);
    await expectShown(page, "en", est.data, true);
    await page.keyboard.press("ArrowLeft");
    await expectShown(page, "en", await page.evaluate((s) => window.cap.samplePoint(s), r), false);
    expect(await page.evaluate(() => window.cap.count())).toBe(3);
  });
});

test.describe("điện thoại 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const l of ["vi", "en"] as const) {
    test(`${l}: dùng được bằng bàn phím, không tràn ngang`, async ({ page }) => {
      await open(page, l);
      await measure(page, 10_000);
      const sl = page.getByTestId("capacity-slider");
      expect((await sl.boundingBox())!.width).toBeGreaterThan(250);
      await shot(page, `${SHOTS}/${l}-390-real.png`);
      await sl.focus();
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
      await expect(label(page)).toHaveAttribute("data-label", "estimated");
      await expect(page.getByTestId("capacity-height")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await shot(page, `${SHOTS}/${l}-390-est.png`);
    });
  }
});
