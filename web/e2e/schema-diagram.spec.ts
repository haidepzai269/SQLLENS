import { expect, test, type Page } from "@playwright/test";

const SHOTS = "../_bmad-output/SP007/STR030/Task047";
const open = async (p: Page, s = "basic", l = "vi") => {
  await p.goto(`/${l}/e2e-schema?s=${s}`);
  await p.getByTestId("schema-canvas").locator(".react-flow__node").first().waitFor({ timeout: 3000 }).catch(() => {});
};
const node = (p: Page, name: string) => p.locator(".react-flow__node").filter({ hasText: name }).first();
const box = async (p: Page, name: string) => (await node(p, name).boundingBox())!;
// khoảng cách dọc orders so với users theo đơn vị sơ đồ (không phụ thuộc zoom của fitView)
const relY = async (p: Page) => ((await box(p, "orders")).y - (await box(p, "users")).y) / (await scale(p));
const scale = (p: Page) => p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")!).transform).a);
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const edgeD = (p: Page) => p.locator(".react-flow__edge path.react-flow__edge-path").evaluateAll((l) => l.map((e) => e.getAttribute("d")));
const drag = async (p: Page, name: string, dx: number, dy: number) => {
  const b = await box(p, name);
  const [x, y] = [b.x + b.width / 2, b.y + 14];
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await p.mouse.move(x + dx, y + dy, { steps: 5 });
  await p.mouse.up();
};
const gapBetween = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));

test.describe("máy tính 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1 thẻ hiện cột, kiểu, PK, FK; đường nối đúng cột; không chồng", async ({ page }) => {
    await open(page);
    const orders = node(page, "orders");
    await expect(orders).toContainText("user_id");
    await expect(orders).toContainText("numeric(10,2)");
    await expect(orders.getByText("PK")).toHaveCount(1);
    await expect(orders.getByText("FK")).toHaveCount(1);
    expect(await page.locator(".react-flow__edge").count()).toBe(2);
    // đầu nguồn của đường orders.user_id -> users.id nằm đúng hàng user_id
    const row = (await orders.locator("li", { hasText: "user_id" }).boundingBox())!;
    const handle = (await orders.locator('.react-flow__handle.source[data-handleid="user_id"]').boundingBox())!;
    expect(Math.abs(handle.y + handle.height / 2 - (row.y + row.height / 2))).toBeLessThan(2);
    const names = ["users", "orders", "order_items"];
    const boxes = await Promise.all(names.map((n) => box(page, n)));
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(gapBetween(boxes[i], boxes[j])).toBeGreaterThan(0);
  });

  test("AC2 kéo thẻ thì đường nối chạy theo; Xếp lại về bố cục chuẩn; nút zoom, vừa màn hình", async ({ page }) => {
    await open(page);
    const [d0, b0, r0] = [await edgeD(page), await box(page, "orders"), await relY(page)];
    await drag(page, "orders", 0, 150);
    const b1 = await box(page, "orders");
    expect(b1.y).toBeGreaterThan(b0.y + 100);
    expect(await edgeD(page)).not.toEqual(d0);
    // kéo khoảng trống để di chuyển canvas
    await page.mouse.move(700, 800);
    await page.mouse.down();
    await page.mouse.move(760, 820, { steps: 5 });
    await page.mouse.up();
    expect((await box(page, "users")).x).toBeGreaterThan(b0.x - 100); // canvas đã dời, thẻ dời theo
    const s0 = await scale(page);
    await page.getByRole("button", { name: "Phóng to", exact: true }).click();
    await expect.poll(() => scale(page)).toBeGreaterThan(s0);
    await page.getByRole("button", { name: "Thu nhỏ", exact: true }).click();
    // cuộn để zoom
    await page.mouse.move(700, 450);
    const s1 = await scale(page);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => scale(page)).toBeGreaterThan(s1);
    await page.getByRole("button", { name: "Xếp lại", exact: true }).click();
    await expect.poll(async () => Math.abs((await relY(page)) - r0)).toBeLessThan(1);
    await page.getByRole("button", { name: "Vừa màn hình", exact: true }).click();
    expect(await scale(page)).toBeLessThanOrEqual(1.001);
  });

  test("AC3 thả hai thẻ chồng nhau thì đẩy ra, cách tối thiểu 8 px", async ({ page }) => {
    await open(page);
    const u = await box(page, "users");
    const o = await box(page, "orders");
    await drag(page, "orders", u.x + 20 - o.x, u.y + 30 - o.y);
    await expect.poll(async () => gapBetween(await box(page, "users"), await box(page, "orders"))).toBeGreaterThanOrEqual(8 * (await scale(page)) - 0.5);
    await page.screenshot({ path: `${SHOTS}/ac3-keo-sat-1440.png` });
  });

  test("AC4 trên 30 bảng thì gom bớt, có giải thích, không treo", async ({ page }) => {
    const t0 = Date.now();
    await open(page, "many120");
    await expect(page.getByRole("note").filter({ hasText: "120" })).toBeVisible();
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    const ms = Date.now() - t0;
    console.log(`many120 collapsed: ${ms} ms to first node`);
    expect(ms).toBeLessThan(15_000);
    await expect(node(page, "t0").locator("li")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/ac4-120-bang-gon-1440.png` });
    const t1 = Date.now();
    await page.getByRole("button", { name: "Hiện đủ cột" }).click();
    await expect(page.locator(".react-flow__node li").first()).toBeVisible();
    console.log(`many120 expand columns: ${Date.now() - t1} ms`);
    await page.screenshot({ path: `${SHOTS}/ac4-120-bang-du-cot-1440.png` });
    await open(page, "many31");
    await expect(page.getByRole("note").filter({ hasText: "31" })).toBeVisible();
    await open(page, "basic");
    await expect(page.getByRole("button", { name: "Hiện đủ cột" })).toHaveCount(0);
  });

  test("AC6 nhớ vị trí sau khi tải lại; localStorage bị chặn vẫn chạy", async ({ page }) => {
    await open(page);
    await drag(page, "orders", 0, 200);
    const r1 = await relY(page);
    await page.reload();
    await node(page, "orders").waitFor();
    expect(Math.abs((await relY(page)) - r1)).toBeLessThan(3);
    await page.getByRole("button", { name: "Xếp lại", exact: true }).click();
    // Xếp lại gọi fitView ở khung hình sau, đo ngay sẽ ra số trước khi zoom xong (CI từng lệch 83,5 px).
    let prev = NaN;
    await expect
      .poll(async () => {
        const cur = await relY(page);
        const stable = Math.abs(cur - prev) < 0.5;
        prev = cur;
        return stable;
      })
      .toBe(true);
    const r2 = prev;
    expect(Math.abs(r2 - r1)).toBeGreaterThan(50);
    await page.reload();
    await node(page, "orders").waitFor();
    await expect.poll(async () => Math.abs((await relY(page)) - r2)).toBeLessThan(3);
  });

  test("AC7 bàn phím, tóm tắt cho trình đọc màn hình, tên bảng có HTML hiện thành chữ", async ({ page }) => {
    await open(page);
    const summary = page.getByTestId("schema-summary");
    await expect(summary).toContainText("orders.user_id tham chiếu users.id");
    await expect(summary).toContainText("Bảng order_items có 4 cột");
    await page.getByRole("button", { name: "Phóng to", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Thu nhỏ", exact: true })).toBeFocused();
    await node(page, "orders").focus();
    const b0 = await box(page, "orders");
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await box(page, "orders")).y).toBeGreaterThan(b0.y + 5);
    // XSS: tên bảng là chữ
    await open(page, "xss");
    await expect(page.locator(".react-flow__node").filter({ hasText: "<img src=x onerror=alert(1)>" })).toBeVisible();
    expect(await page.locator(".react-flow__node img").count()).toBe(0);
    expect(await page.locator(".react-flow__node b").count()).toBe(0);
  });

  test("ca biên: 0 bảng, bảng không cột, FK tự trỏ, FK tới bảng lạ, tên rất dài", async ({ page }) => {
    await open(page, "empty");
    await expect(page.getByText("Chưa có bảng nào")).toBeVisible();
    await open(page, "edge");
    await expect(node(page, "nocols")).toBeVisible();
    await expect(page.getByRole("note")).toContainText("1 khóa ngoại trỏ tới bảng không có trong danh sách");
    expect(await page.locator(".react-flow__edge").count()).toBe(1); // chỉ tree -> tree
    await open(page, "long");
    const n = node(page, "a_really_long");
    await expect(n.locator('[title^="a_really_long"]').first()).toBeVisible();
    expect((await n.boundingBox())!.width).toBeLessThan(300);
  });

  for (const l of ["vi", "en"] as const) {
    test(`AC8 ảnh chụp 1440 ${l}`, async ({ page }) => {
      await open(page, "basic", l);
      await page.screenshot({ path: `${SHOTS}/1440-${l}.png` });
    });
  }
});

test.describe("điện thoại 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("AC5 cụm nút không che thẻ, không cuộn ngang, một cột", async ({ page }) => {
    await open(page);
    expect(await noHScroll(page)).toBe(true);
    const bar = (await page.getByRole("toolbar").boundingBox())!;
    const canvas = (await page.getByTestId("schema-canvas").boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(canvas.y);
    const xs = await Promise.all(["users", "orders", "order_items"].map(async (n) => Math.round((await box(page, n)).x)));
    expect(new Set(xs).size).toBe(1);
    for (const b of await page.getByRole("toolbar").getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await open(page, "many120");
    expect(await noHScroll(page)).toBe(true);
  });

  for (const l of ["vi", "en"] as const) {
    test(`AC8 ảnh chụp 390 ${l}`, async ({ page }) => {
      await open(page, "basic", l);
      await page.screenshot({ path: `${SHOTS}/390-${l}.png` });
    });
  }
});

test("AC6 localStorage bị chặn vẫn chạy", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await expect(node(page, "orders")).toBeVisible();
  await drag(page, "orders", 0, 100);
  await page.getByRole("button", { name: "Xếp lại", exact: true }).click();
  await expect(node(page, "orders")).toBeVisible();
  expect(errors).toEqual([]);
});
