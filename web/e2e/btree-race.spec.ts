import { expect, test, type Page } from "@playwright/test";

const open = async (p: Page, l = "vi") => {
  await p.goto(`/${l}/e2e-btree-race`);
  await p.getByTestId("btree-race").waitFor();
  await p.getByTestId("btree-svg").waitFor();
};

const noHorizontalScroll = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("Màn hình máy tính 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC2 & AC3 & AC4: Ca bình thường hiển thị thanh cuộc đua đúng tỉ lệ, số dòng, nhãn Thật và không có ms", async ({
    page,
  }) => {
    await open(page);

    // Kiểm tra BTreeRace
    const race = page.getByTestId("btree-race");
    await expect(race).toBeVisible();

    // Nhãn Thật
    const label = page.getByTestId("race-label");
    await expect(label).toHaveAttribute("data-label", "real");
    await expect(label).toContainText("Thật");

    // Số trang & số dòng
    await expect(page.getByTestId("race-idx-pages")).toContainText("4 trang");
    await expect(page.getByTestId("race-seq-pages")).toContainText("180 trang");
    await expect(page.getByTestId("race-idx-rows")).toContainText("1 dòng");
    await expect(page.getByTestId("race-seq-rows")).toContainText("5.000 dòng");

    // Thanh đo
    const idxBar = page.getByTestId("race-bar-idx");
    const seqBar = page.getByTestId("race-bar-seq");

    // 4 / 180 ≈ 2.22%
    const idxWidth = await idxBar.evaluate((el) => el.style.width);
    expect(Number.parseFloat(idxWidth)).toBeCloseTo((4 / 180) * 100, 1);
    expect(await seqBar.evaluate((el) => el.style.width)).toBe("100%");

    // Dòng chú thích bắt buộc
    const note = page.getByTestId("race-note");
    await expect(note).toContainText("So bằng số trang đọc, không phải thời gian. Thanh theo đúng tỷ lệ.");

    // AC3: Tuyệt đối không hiển thị millisecond / microsecond / giây
    const textContent = await race.innerText();
    expect(textContent).not.toMatch(/\b\d+(\.\d+)?\s*(ms|µs|us|s|giây|second)\b/i);
    expect(textContent).not.toContain("mili-giây");
    expect(textContent).not.toContain("miligiây");

    // Cây bình thường sáng rõ
    await expect(page.getByTestId("btree-drop")).not.toHaveAttribute("data-dimmed", "true");
    await expect(page.getByTestId("btree-view")).not.toHaveAttribute("data-dimmed", "true");
  });

  test("AC1 & AC2: Ca noindex / bọc biểu thức làm cây B-Tree tối và thanh Index Scan hiển thị 'Không dùng được'", async ({
    page,
  }) => {
    await open(page);

    // Chuyển sang ca noindex
    await page.getByTestId("case-noindex").click();

    // Thanh Index Scan hiển thị 'Không dùng được'
    const race = page.getByTestId("btree-race");
    await expect(race).toHaveAttribute("data-no-index", "true");
    await expect(page.getByTestId("race-no-index")).toContainText("Không dùng được");
    await expect(page.getByTestId("race-idx-pages")).toContainText("0 trang");

    const idxBar = page.getByTestId("race-bar-idx");
    expect(await idxBar.evaluate((el) => el.style.width)).toBe("0%");

    // Thanh Seq Scan vẫn 180 trang
    await expect(page.getByTestId("race-seq-pages")).toContainText("180 trang");
    const seqBar = page.getByTestId("race-bar-seq");
    expect(await seqBar.evaluate((el) => el.style.width)).toBe("100%");

    // AC1: Cây B-Tree tối mờ
    const btreeDrop = page.getByTestId("btree-drop");
    await expect(btreeDrop).toHaveAttribute("data-dimmed", "true");

    const btreeView = page.getByTestId("btree-view");
    await expect(btreeView).toHaveAttribute("data-dimmed", "true");

    const btreeSvg = page.getByTestId("btree-svg");
    await expect(btreeSvg).toHaveAttribute("data-dimmed", "true");

    // Các node và cạnh đều có thuộc tính data-dimmed="true"
    const dimmedNodes = page.locator('g[data-dimmed="true"]');
    expect(await dimmedNodes.count()).toBeGreaterThan(0);

    // Key marker không rơi / không có trong DOM layer
    const keyMarker = page.locator("[data-key]");
    await expect(keyMarker).toHaveCount(0);

    // Khung giải thích hiện lý do cây tối
    const explain = page.getByTestId("drop-dimmed-explain");
    await expect(explain).toBeVisible();
    await expect(explain).toContainText("Planner không dùng được index này");
    await expect(explain).toContainText("quét toàn bảng bằng Seq Scan");

    // Các nút điều khiển bị disabled
    await expect(page.getByRole("button", { name: "Chạy", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Bước tới", exact: true })).toBeDisabled();
    await expect(page.getByTestId("drop-scrub")).toBeDisabled();
  });

  test("Ca biên: Bảng rỗng (0 trang) và chênh lệch cực lớn (2 vs 60.000)", async ({ page }) => {
    await open(page);

    // Ca bảng rỗng 0 trang
    await page.getByTestId("case-zero").click();
    await expect(page.getByTestId("race-idx-pages")).toContainText("0 trang");
    await expect(page.getByTestId("race-seq-pages")).toContainText("0 trang");
    expect(await page.getByTestId("race-bar-idx").evaluate((el) => el.style.width)).toBe("0%");
    expect(await page.getByTestId("race-bar-seq").evaluate((el) => el.style.width)).toBe("0%");

    // Ca chênh lệch cực lớn
    await page.getByTestId("case-huge").click();
    await expect(page.getByTestId("race-idx-pages")).toContainText("2 trang");
    await expect(page.getByTestId("race-seq-pages")).toContainText("60.000 trang");

    const idxBar = page.getByTestId("race-bar-idx");
    const minWidth = await idxBar.evaluate((el) => el.style.minWidth);
    expect(minWidth).toBe("4px");
  });

  test("AC6: Đầy đủ song ngữ tiếng Anh trên /en/e2e-btree-race", async ({ page }) => {
    await open(page, "en");

    const race = page.getByTestId("btree-race");
    await expect(race).toBeVisible();

    // Tiêu đề & nhãn tiếng Anh
    await expect(race).toContainText("The Race: pages read");
    await expect(race).toContainText("Index Scan");
    await expect(race).toContainText("Seq Scan (Full table scan)");

    const label = page.getByTestId("race-label");
    await expect(label).toContainText("Real");

    // Chú thích tiếng Anh
    const note = page.getByTestId("race-note");
    await expect(note).toContainText("Compared by pages read, not time. Bars are true to scale.");

    // Chuyển sang ca noindex
    await page.getByTestId("case-noindex").click();
    await expect(page.getByTestId("race-no-index")).toContainText("Not usable");

    const explain = page.getByTestId("drop-dimmed-explain");
    await expect(explain).toContainText("Planner could not use this index");
  });
});

test.describe("Màn hình điện thoại 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("AC5: Giao diện co giãn tốt trên 390px, không tràn ngang", async ({ page }) => {
    await open(page);

    // Kiểm tra không tràn ngang
    expect(await noHorizontalScroll(page)).toBe(true);

    const race = page.getByTestId("btree-race");
    await expect(race).toBeVisible();

    // Thanh đo hiển thị đầy đủ
    await expect(page.getByTestId("race-bar-idx")).toBeVisible();
    await expect(page.getByTestId("race-bar-seq")).toBeVisible();

    // Ca noindex trên mobile
    await page.getByTestId("case-noindex").click();
    expect(await noHorizontalScroll(page)).toBe(true);
    await expect(page.getByTestId("drop-dimmed-explain")).toBeVisible();
  });
});

test.describe("Chế độ giảm chuyển động prefers-reduced-motion", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });

  test("AC5: Hỗ trợ giảm chuyển động (reduced motion)", async ({ page }) => {
    await open(page);

    // Thanh Index bar có lớp motion-reduce:transition-none
    const idxBar = page.getByTestId("race-bar-idx");
    const classList = await idxBar.getAttribute("class");
    expect(classList).toContain("motion-reduce:transition-none");

    const seqBar = page.getByTestId("race-bar-seq");
    expect(await seqBar.getAttribute("class")).toContain("motion-reduce:transition-none");
  });
});
