import { expect, test, type Page } from "@playwright/test";

const SHOTS = "../_bmad-output/SP007/STR031/Task048";
const open = async (p: Page, l = "vi", plan = "five", label?: string) => {
  await p.goto(`/${l}/e2e-plan`);
  await p.getByRole("button", { name: plan, exact: true }).click();
  if (label) await p.getByRole("button", { name: label, exact: true }).click();
  await p.getByTestId("plan-step").first().waitFor();
};
const step = (p: Page, id: string) => p.locator(`[data-step="${id}"]`);
const box = async (p: Page, id: string) => (await step(p, id).boundingBox())!;
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("máy tính 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1 cấu trúc cây, thẻ hiện số, không có thì hiện không có", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("plan-step")).toHaveCount(5);
    for (const e of ["1>2", "2>3", "3>4", "3>5"]) await expect(page.getByTestId(`rf__edge-${e}`)).toHaveCount(1);
    const [b1, b2, b3, b4, b5] = await Promise.all(["1", "2", "3", "4", "5"].map((i) => box(page, i)));
    expect(b1.x).toBeLessThan(b2.x);
    expect(b2.x).toBeLessThan(b3.x);
    expect(b3.x).toBeLessThan(b4.x);
    expect(b4.x).toBeCloseTo(b5.x, 0);
    expect(b4.y).toBeLessThan(b5.y); // bảng ngoài ở trên, bảng trong ở dưới
    const seq = step(page, "4");
    await expect(seq).toContainText("Seq Scan");
    await expect(seq).toContainText("orders");
    await expect(seq).toContainText("834");
    await expect(seq).toContainText("5.000");
    await expect(seq.locator("dd").nth(1)).toHaveText("không có"); // index
    await expect(step(page, "1").locator("dd").nth(0)).toHaveText("không có"); // bảng
    await expect(step(page, "1").locator("dd").nth(4)).toHaveText("0"); // 0 thật vẫn hiện 0
    await expect(step(page, "5")).toContainText("customers_pkey");
    await page.screenshot({ path: `${SHOTS}/vi-1440.png` });
  });

  test("AC2 mở chi tiết, Esc đóng, focus quay lại thẻ", async ({ page }) => {
    await open(page);
    await step(page, "5").focus();
    await page.keyboard.press("Enter");
    const d = page.getByTestId("plan-detail");
    await expect(d).toBeVisible();
    await expect(d).toContainText("(id = o.customer_id)");
    await expect(d).toContainText("Dòng ước tính (mỗi lần chạy)");
    await expect(d).toContainText("Số lần chạy");
    await expect(d).toContainText("100");
    await expect(d).toContainText("300");
    await expect(d).toContainText("Index Scan đi theo index");
    await page.screenshot({ path: `${SHOTS}/vi-1440-detail.png` });
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
    await expect(step(page, "5")).toBeFocused();
    await step(page, "4").click();
    await expect(page.getByTestId("plan-detail")).toContainText("Seq Scan là đọc cả bảng từ đầu đến cuối");
  });

  test("AC3 analyzed false nói rõ, nhãn đúng nhãn truyền vào", async ({ page }) => {
    await open(page, "vi", "mysql", "estimated");
    await expect(page.getByTestId("plan-notanalyzed")).toContainText("ước tính của engine, chưa chạy thật");
    await expect(page.getByTestId("plan-label")).toHaveAttribute("data-label", "estimated");
    await expect(page.getByTestId("plan-label")).toHaveText("Ước lượng");
    await expect(step(page, "2").locator("dd").nth(3)).toHaveText("không có"); // dòng thật
    await step(page, "2").click();
    await expect(page.getByTestId("plan-detail-notanalyzed")).toBeVisible();
    await page.keyboard.press("Escape");
    for (const [k, vi] of [["real", "Thật"], ["simulated", "Mô phỏng"]] as const) {
      await page.getByRole("button", { name: k, exact: true }).click();
      await expect(page.getByTestId("plan-label")).toHaveAttribute("data-label", k);
      await expect(page.getByTestId("plan-label")).toHaveText(vi);
    }
    await page.getByRole("button", { name: "five", exact: true }).click();
    await expect(page.getByTestId("plan-notanalyzed")).toHaveCount(0);
  });

  test("AC4 không có thời gian, không có câu hàm ý ổn", async ({ page }) => {
    for (const plan of ["five", "mysql", "other"]) {
      await open(page, "vi", plan);
      await step(page, "1").click();
      const text = (await page.getByTestId("plan-tree").innerText()) + (await page.getByTestId("plan-detail").innerText());
      expect(text).not.toMatch(/\bms\b|mili|giây|second|thời gian|time/i);
      expect(text).not.toMatch(/\bổn\b|an toàn|tốt|good|fine|\bok\b/i);
      await page.keyboard.press("Escape");
    }
  });

  test("AC5 chênh lệch lớn đánh dấu bằng chữ, tính loops", async ({ page }) => {
    await open(page);
    await expect(step(page, "4").getByTestId("plan-skew")).toHaveText(/Lệch lớn: thật nhiều hơn ước tính/);
    await expect(step(page, "2").getByTestId("plan-skew")).toHaveAttribute("data-skew", "more");
    await expect(step(page, "5").getByTestId("plan-skew")).toHaveCount(0); // 1 x 100 lần = 100, khớp
    await expect(step(page, "1").getByTestId("plan-skew")).toHaveCount(0);
    await step(page, "4").click();
    await expect(page.getByTestId("plan-detail-skew")).toContainText("ước tính 10 dòng cho cả các lần chạy, nhưng thật là 5.000");
    await page.keyboard.press("Escape");
    await open(page, "vi", "mysql");
    await expect(page.getByTestId("plan-skew")).toHaveCount(0); // không có số thật thì không so
  });

  test("AC6 kéo thẻ, lưu, xếp lại, di chuyển canvas, zoom, vừa màn hình", async ({ page }) => {
    await open(page);
    const before = await box(page, "4");
    const before1 = await box(page, "1");
    await page.mouse.move(before.x + 30, before.y + 20);
    await page.mouse.down();
    await page.mouse.move(before.x + 90, before.y + 70, { steps: 6 });
    await page.mouse.up();
    const moved = await box(page, "4");
    expect(Math.round(moved.x - before.x)).toBeGreaterThan(40);
    await expect(page.getByRole("dialog")).toHaveCount(0); // kéo không mở chi tiết
    expect(await page.evaluate(() => localStorage.getItem("sqllens.plan.wide"))).toContain('"4"');
    await page.reload();
    await page.getByRole("button", { name: "five", exact: true }).click();
    await step(page, "4").waitFor();
    const [r1, r4] = [await box(page, "1"), await box(page, "4")]; // fitView tính lại nên so vị trí tương đối
    expect(Math.abs((r4.x - r1.x) / r4.width - (moved.x - before1.x) / moved.width)).toBeLessThan(0.02);
    // kéo khoảng trống = di chuyển canvas
    const b1 = await box(page, "1");
    const c = (await page.getByTestId("plan-canvas").boundingBox())!;
    await page.mouse.move(c.x + 10, c.y + 10);
    await page.mouse.down();
    await page.mouse.move(c.x + 60, c.y + 50, { steps: 4 });
    await page.mouse.up();
    const b1b = await box(page, "1");
    expect(Math.round(b1b.x - b1.x)).toBe(50);
    expect(Math.round(b1b.y - b1.y)).toBe(40);
    // zoom
    const w0 = (await box(page, "1")).width;
    await page.getByRole("button", { name: "Phóng to" }).click();
    expect((await box(page, "1")).width).toBeGreaterThan(w0);
    await page.getByRole("button", { name: "Thu nhỏ" }).click();
    await page.getByRole("button", { name: "Thu nhỏ" }).click();
    expect((await box(page, "1")).width).toBeLessThan(w0);
    await page.getByRole("button", { name: "Vừa màn hình" }).click();
    expect((await box(page, "1")).width).toBeLessThanOrEqual(248 + 1);
    // xếp lại: xóa bản lưu
    await page.getByRole("button", { name: "Xếp lại" }).click();
    await step(page, "4").waitFor();
    expect(await page.evaluate(() => localStorage.getItem("sqllens.plan.wide"))).toBeNull();
    expect(Math.abs((await box(page, "4")).x - before.x)).toBeLessThan(2);
  });

  test("AC7 bàn phím: Tab đi theo thứ tự, mũi tên dời thẻ, tóm tắt văn bản", async ({ page }) => {
    await open(page);
    await step(page, "1").focus();
    for (const id of ["2", "3", "4", "5"]) {
      await page.keyboard.press("Tab");
      await expect(step(page, id)).toBeFocused();
    }
    const z = (await box(page, "5")).width / 248;
    const b = await box(page, "5");
    await page.keyboard.press("ArrowRight");
    expect(Math.round(((await box(page, "5")).x - b.x) / z)).toBe(16);
    await page.keyboard.press("Shift+ArrowDown");
    expect(Math.round(((await box(page, "5")).y - b.y) / z)).toBe(64);
    await page.getByTestId("plan-summary").locator("summary").click();
    await expect(page.getByTestId("plan-summary").locator("li")).toHaveCount(5);
    await expect(page.getByTestId("plan-summary").locator("li").nth(3)).toContainText("Seq Scan trên orders: dòng ước tính 10, dòng thật 5.000, trang đã đọc 834");
  });

  test("ca biên: một bước, sâu 20 tầng, kind other với HTML", async ({ page }) => {
    await open(page, "vi", "single");
    await expect(page.getByTestId("plan-step")).toHaveCount(1);
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);
    await open(page, "vi", "deep");
    await expect(page.getByTestId("plan-step").first()).toBeVisible();
    await page.getByRole("button", { name: "Vừa màn hình" }).click();
    await page.getByTestId("plan-summary").locator("summary").click();
    await expect(page.getByTestId("plan-summary").locator("li")).toHaveCount(20);
    await expect(page.locator(".react-flow__edge")).toHaveCount(19);
    await page.screenshot({ path: `${SHOTS}/vi-1440-deep.png` });
    await open(page, "vi", "other");
    await step(page, "1").click();
    const d = page.getByTestId("plan-detail");
    await expect(d).toContainText("chưa có lời giải thích riêng");
    await expect(d).toContainText(`<img src=x onerror="window.__xss=1">`); // hiện thành chữ
    await expect(page.locator("img[src='x']")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("tiếng Anh đủ chữ", async ({ page }) => {
    await open(page, "en");
    await expect(page.getByTestId("plan-label")).toHaveText("Real");
    await expect(step(page, "4")).toContainText("Pages read");
    await expect(step(page, "1").locator("dd").nth(0)).toHaveText("not available");
    await step(page, "4").click();
    await expect(page.getByTestId("plan-detail")).toContainText("Seq Scan reads the whole table");
    await page.screenshot({ path: `${SHOTS}/en-1440-detail.png` });
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `${SHOTS}/en-1440.png` });
  });
});

test.describe("điện thoại 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const l of ["vi", "en"]) {
    test(`AC6/AC7 ${l}: bản hẹp đi theo rail, không cuộn ngang, nút không che thẻ`, async ({ page }) => {
      await open(page, l);
      await expect(page.getByTestId("plan-tree")).toHaveAttribute("data-narrow", "true");
      expect(await noHScroll(page)).toBe(true);
      const ids = ["1", "2", "3", "4", "5"];
      const ys = await Promise.all(ids.map(async (i) => (await box(page, i)).y));
      expect(ys).toEqual([...ys].sort((a, b) => a - b)); // một cột, đi xuống
      const c = (await page.getByTestId("plan-canvas").boundingBox())!;
      const bar = (await page.getByRole("toolbar").boundingBox())!;
      expect(bar.y).toBeGreaterThanOrEqual(c.y + c.height - 1); // cụm nút nằm ngoài canvas
      for (const i of ids) {
        const b = await box(page, i);
        if (b.y >= c.y + c.height || b.y + b.height <= c.y) continue; // thẻ ngoài khung nhìn bị canvas cắt, không che gì
        const bottom = Math.min(b.y + b.height, c.y + c.height); // phần thẻ ngoài canvas bị cắt
        expect(bottom <= bar.y || b.y >= bar.y + bar.height || b.x + b.width <= bar.x || b.x >= bar.x + bar.width).toBe(true);
      }
      await page.screenshot({ path: `${SHOTS}/${l}-390.png`, fullPage: true });
      await step(page, "4").click();
      await expect(page.getByTestId("plan-detail")).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
      const d = (await page.getByTestId("plan-detail").boundingBox())!;
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + d.width).toBeLessThanOrEqual(390);
      await page.screenshot({ path: `${SHOTS}/${l}-390-detail.png` });
    });
  }

  test("sâu 20 tầng và HTML ở 390 không cuộn ngang", async ({ page }) => {
    for (const plan of ["deep", "other", "mysql"]) {
      await open(page, "vi", plan);
      expect(await noHScroll(page)).toBe(true);
    }
  });
});
