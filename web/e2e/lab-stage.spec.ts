import { expect, test, type Page } from "@playwright/test";

const SHOTS = "../_bmad-output/SP999/STR062/Task062/anh";
type L = "vi" | "en";
const T = {
  vi: { run: "Chạy", stage: "Mô phỏng", tabs: ["Sơ đồ", "Plan", "B-Tree", "Thử sửa"], hint: "Chưa có cảnh để hiện", cancel: "Hủy", rebuild: "Dựng lại" },
  en: { run: "Run", stage: "Simulation", tabs: ["Schema", "Plan", "B-Tree", "Try a fix"], hint: "Nothing to show yet", cancel: "Cancel", rebuild: "Rebuild" },
} as const;
const BAD = /thiết kế (này )?(đã )?ổn|design is (fine|ok|good)|good design/i;

const SETUP =
  "CREATE TABLE users(id int PRIMARY KEY, email text); " +
  "CREATE TABLE orders(id int PRIMARY KEY, user_id int REFERENCES users(id), total int); " +
  "CREATE INDEX orders_user_idx ON orders(user_id); " +
  "INSERT INTO users SELECT g, 'u' || g FROM generate_series(1, 2000) g; " +
  "INSERT INTO orders SELECT g, (g % 2000) + 1, g FROM generate_series(1, 5000) g; ";
const SUM = "SELECT md5(string_agg(id::text || ':' || total::text, ',' ORDER BY id)) AS m, count(*) AS n FROM orders";
const NOIDX = "SELECT count(*) AS n FROM pg_class WHERE relname = 'orders_total_idx'";
const JOIN = "SELECT u.email, o.total FROM users u JOIN orders o ON o.user_id = u.id WHERE o.total < 50";

test.beforeEach(({ page }) => page.route("**/api/me", (r) => r.fulfill({ status: 503, body: "{}" })));

const sqlBox = (p: Page) => p.locator(".cm-content:visible").first(); // ô SQL luôn đứng trước ô của Thử sửa
const stage = (p: Page) => p.locator("#stage");
async function run(p: Page, l: L, sql: string) {
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor();
  if (await tab.isVisible()) await tab.click();
  await sqlBox(p).fill(sql);
  await p.getByRole("button", { name: T[l].run, exact: true }).first().click(); // nút Chạy của cột SQL luôn đứng trước nút phát của animation join
}
// Điện thoại: vùng stage nằm sau tab "Mô phỏng"; máy tính luôn thấy.
async function openStage(p: Page, l: L) {
  const tab = p.getByRole("tab", { name: T[l].stage, exact: true });
  if (await tab.isVisible()) await tab.click();
  await expect(stage(p)).toBeVisible();
}
const stageTab = (p: Page, l: L, i: number) => stage(p).getByRole("tab", { name: T[l].tabs[i], exact: true });
async function pickTab(p: Page, l: L, i: number) {
  await stageTab(p, l, i).click();
}
// Đợi một lần chạy xong: lưới kết quả hiện ở terminal (điện thoại: tab terminal đang mở).
const grid = (p: Page) => p.locator("tbody:visible tr");
const gridText = async (p: Page) => (await grid(p).allInnerTexts()).join("|");
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const l of ["vi", "en"] as const) {
  test.describe(`${l} 1440`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("AC1 chưa chạy: có gợi ý, không tải WASM", async ({ page }) => {
      const wasm: string[] = [];
      page.on("request", (r) => /\.wasm/.test(r.url()) && wasm.push(r.url()));
      await page.goto(`/${l}`);
      await page.waitForLoadState("networkidle");
      await expect(stage(page)).toContainText(T[l].hint);
      expect(wasm).toEqual([]);
    });

    test("AC2 AC5 AC6 AC7 sơ đồ từ database thật, cây B-Tree, thử sửa, chạy lại không đổi dữ liệu", async ({ page }) => {
      await page.goto(`/${l}`);
      await run(page, l, SETUP + SUM);
      await expect(grid(page)).toHaveCount(1, { timeout: 90_000 });
      const before = await gridText(page);
      // AC2: đọc từ database, không từ chuỗi SQL. Bảng thứ ba chỉ có trong database nhờ một câu động mà chuỗi SQL không chứa tên của nó.
      await expect(stage(page).locator(".react-flow__node").filter({ hasText: "orders" })).toContainText("user_id");
      const orders = stage(page).locator(".react-flow__node").filter({ hasText: "orders" });
      await expect(orders.getByText("FK")).toHaveCount(1);
      await expect(orders.getByText("PK")).toHaveCount(1);
      await expect(stage(page).locator(".react-flow__edge")).toHaveCount(1);
      await expect(stage(page).getByTestId("stage-label")).toBeVisible();
      // AC3: SELECT cuối là md5, nên plan thuộc câu đó và có ghi câu thứ mấy
      await pickTab(page, l, 1);
      await expect(stage(page).getByTestId("plan-tree")).toBeVisible({ timeout: 30_000 });
      await expect(stage(page).getByTestId("plan-label")).toHaveAttribute("data-label", "real");
      await expect(stage(page).getByTestId("stage-viewing")).toContainText("md5");
      await expect(stage(page).getByTestId("stage-joins")).toHaveCount(0); // không có join thì không có khu animation join
      // AC5: B-Tree thật
      await pickTab(page, l, 2);
      await stage(page).locator("#stage-index").selectOption("orders_user_idx");
      await stage(page).locator("#stage-key").fill("5");
      await stage(page).getByTestId("stage-drop").click();
      await expect(stage(page).getByTestId("btree-drop")).toBeVisible({ timeout: 30_000 });
      await expect(stage(page).getByTestId("stage-evidence")).toBeVisible();
      // AC6: thử sửa với câu SELECT đang xem làm câu thăm dò
      await pickTab(page, l, 3);
      await expect(stage(page).getByTestId("whatif-probe")).toContainText("md5");
      await stage(page).getByTestId("whatif-editor").locator(".cm-content").fill("CREATE INDEX orders_total_idx ON orders(total)");
      await stage(page).getByTestId("whatif-run").click();
      await expect(stage(page).getByTestId("whatif-pages").first()).toBeVisible({ timeout: 60_000 });
      // AC7: chạy lại, dữ liệu và index của người dùng không đổi (checksum), không có index do thử sửa
      await run(page, l, SUM.replace("FROM orders", ", 'again' AS tag FROM orders")); // cột thêm để biết đây là lần chạy mới, không phải kết quả cũ
      await expect.poll(() => gridText(page), { timeout: 60_000 }).toBe(`${before}	again`);
      await expect(stage(page).getByTestId("whatif-pages")).toHaveCount(0); // kết quả so sánh cũ không còn
      await run(page, l, NOIDX); // index của phần thử sửa đã được hoàn tác
      await expect(grid(page)).toHaveText(/0/, { timeout: 60_000 });
    });

    test("AC3 AC4 AC7 plan có join: animation chỉ chạy khi bấm; chạy lại bỏ khu join", async ({ page }) => {
      await page.goto(`/${l}`);
      await run(page, l, SETUP + "SELECT 1; ");
      await expect(grid(page)).toHaveCount(1, { timeout: 90_000 });
      await run(page, l, `SELECT 1; ${JOIN}`);
      await pickTab(page, l, 1);
      await expect(stage(page).getByTestId("stage-viewing")).toContainText(l === "vi" ? "thứ 2" : "number 2");
      await expect(stage(page).getByTestId("stage-viewing")).toContainText("JOIN");
      await expect(stage(page).getByTestId("plan-label")).toHaveAttribute("data-label", "real", { timeout: 30_000 });
      const anim = stage(page).getByTestId("join-anim").first();
      await expect(anim).toBeVisible();
      await expect(stage(page).getByTestId("join-sample").first()).toBeVisible();
      await page.waitForTimeout(1500);
      await expect(anim).not.toHaveAttribute("data-playing", /.*/);
      await expect(anim).toHaveAttribute("data-step", "0");
      await run(page, l, "SELECT count(*) FROM orders");
      await expect(grid(page)).toHaveCount(1, { timeout: 60_000 });
      await expect(stage(page).getByTestId("stage-viewing")).toContainText("count");
      await expect(stage(page).getByTestId("stage-joins")).toHaveCount(0);
    });

    test("ca biên: không bảng, không SELECT, không index, transaction mở, hủy rồi dựng lại", async ({ page }) => {
      await page.goto(`/${l}`);
      await run(page, l, "SELECT 1");
      await expect(grid(page)).toHaveCount(1, { timeout: 90_000 });
      await expect(stage(page).getByRole("status").filter({ hasText: l === "vi" ? "không tạo bảng nào" : "created no tables" })).toBeVisible();
      await pickTab(page, l, 2);
      await expect(stage(page).getByRole("status").filter({ hasText: l === "vi" ? "chưa có index" : "no index" })).toBeVisible();
      await run(page, l, "CREATE TABLE z(id int primary key)");
      await expect(stage(page).getByRole("tab").first()).toBeVisible({ timeout: 60_000 });
      await pickTab(page, l, 1);
      await expect(stage(page).getByRole("status").filter({ hasText: l === "vi" ? "không có câu SELECT" : "no SELECT" })).toBeVisible();
      await pickTab(page, l, 3);
      await expect(stage(page).getByRole("status").filter({ hasText: l === "vi" ? "không có câu SELECT" : "no SELECT" })).toBeVisible();
      // index kiểu hash: không phải B-Tree, phải báo lý do, không vẽ cây giả
      await run(page, l, "CREATE INDEX z_hash ON z USING hash (id); SELECT 1");
      await pickTab(page, l, 2);
      await expect(stage(page).locator("#stage-index")).toBeVisible({ timeout: 60_000 });
      await stage(page).locator("#stage-index").selectOption("z_hash");
      await expect(stage(page).getByTestId("stage-not-simulated")).toBeVisible({ timeout: 30_000 });
      await expect(stage(page).getByTestId("btree-drop")).toHaveCount(0);
      // transaction của người dùng còn mở: explain trả NotSimulated, có lý do
      await run(page, l, "BEGIN; SELECT * FROM z");
      await pickTab(page, l, 1);
      await expect(stage(page).getByTestId("stage-not-simulated")).toBeVisible({ timeout: 30_000 });
      await expect(stage(page).getByTestId("plan-tree")).toHaveCount(0);
      // hủy giữa chừng: tab không còn hiện số của lần trước
      await run(page, l, "ROLLBACK; SELECT pg_sleep(60)");
      await page.getByRole("button", { name: T[l].cancel, exact: true }).click();
      await expect(stage(page).getByRole("tab")).toHaveCount(0);
      await expect(stage(page)).toContainText(T[l].hint);
      await page.getByRole("button", { name: T[l].rebuild, exact: true }).click();
      await expect(page.locator('[data-testid="stopped"]')).toHaveCount(0, { timeout: 60_000 });
      await expect(stage(page).getByRole("tab")).toHaveCount(0);
    });

    test("bàn phím đổi tab", async ({ page }) => {
      await page.goto(`/${l}`);
      await run(page, l, "SELECT 1");
      await expect(stageTab(page, l, 0)).toBeVisible({ timeout: 90_000 });
      await stageTab(page, l, 0).focus();
      await page.keyboard.press("ArrowRight");
      await expect(stageTab(page, l, 1)).toHaveAttribute("aria-selected", "true");
    });

    test("đổi sang MySQL rồi quay lại: không hiện cảnh PostgreSQL, quay lại thì cảnh về lại", async ({ page }) => {
      await page.goto(`/${l}`);
      await run(page, l, "SELECT 1");
      await expect(stageTab(page, l, 0)).toBeVisible({ timeout: 90_000 });
      await page.getByRole("tab", { name: "MySQL" }).click();
      await expect(stage(page).getByRole("tab")).toHaveCount(0);
      await page.getByRole("tab", { name: "PostgreSQL" }).click();
      await expect(stageTab(page, l, 0)).toBeVisible();
    });

    test("ảnh chụp từng tab", async ({ page }) => {
      await page.goto(`/${l}`);
      await run(page, l, SETUP + SUM);
      await expect(grid(page)).toHaveCount(1, { timeout: 90_000 });
      await run(page, l, JOIN);
      await expect(stage(page).locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/1440-${l}-schema.png` });
      await pickTab(page, l, 1);
      await expect(stage(page).getByTestId("join-anim").first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/1440-${l}-plan.png` });
      await pickTab(page, l, 2);
      await stage(page).locator("#stage-index").selectOption("orders_user_idx");
      await stage(page).locator("#stage-key").fill("5");
      await stage(page).getByTestId("stage-drop").click();
      await expect(stage(page).getByTestId("btree-drop")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/1440-${l}-btree.png` });
      await pickTab(page, l, 3);
      await stage(page).getByTestId("whatif-editor").locator(".cm-content").fill("CREATE INDEX orders_total_idx ON orders(total)");
      await stage(page).getByTestId("whatif-run").click();
      await expect(stage(page).getByTestId("whatif-pages").first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/1440-${l}-whatif.png` });
      expect(await stage(page).innerText()).not.toMatch(BAD);
    });
  });

  test.describe(`${l} 390`, () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("ảnh chụp từng tab, không cuộn ngang trang", async ({ page }) => {
      await page.goto(`/${l}`);
      await run(page, l, SETUP + SUM);
      await expect(grid(page)).toHaveCount(1, { timeout: 90_000 });
      await run(page, l, JOIN);
      await expect(grid(page).first()).toBeVisible({ timeout: 60_000 });
      await openStage(page, l);
      await expect(stage(page).locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(800);
      expect(await noHScroll(page)).toBe(true);
      // sơ đồ dựng lúc tab còn ẩn vẫn phải vừa khung khi hiện, không co nhỏ ở góc
      await expect.poll(async () => (await stage(page).locator(".react-flow__node").first().boundingBox())?.width ?? 0).toBeGreaterThan(150);
      await page.screenshot({ path: `${SHOTS}/390-${l}-schema.png` });
      await pickTab(page, l, 1);
      await expect(stage(page).getByTestId("join-anim").first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/390-${l}-plan.png` });
      await stage(page).getByTestId("join-anim").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/390-${l}-plan-join.png` });
      await pickTab(page, l, 2);
      await stage(page).locator("#stage-index").selectOption("orders_user_idx");
      await stage(page).locator("#stage-key").fill("5");
      await stage(page).getByTestId("stage-drop").click();
      await expect(stage(page).getByTestId("btree-drop")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/390-${l}-btree.png` });
      await pickTab(page, l, 3);
      await expect(stage(page).getByTestId("whatif")).toBeVisible();
      await page.waitForTimeout(500);
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/390-${l}-whatif.png` });
    });
  });
}

// AC8: ba điểm phiên chính thấy trên ảnh Task047, kiểm khi sơ đồ nằm trong stage thật.
test.describe("AC8 sơ đồ trong stage", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const MANY =
    "CREATE TABLE t0(id int PRIMARY KEY, v text); " +
    Array.from({ length: 119 }, (_, i) => `CREATE TABLE t${i + 1}(id int PRIMARY KEY, v text, p int REFERENCES t${Math.floor(i / 2)}(id));`).join(" ") +
    " SELECT 1";
  const inside = (b: { x: number; y: number; width: number; height: number }, f: typeof b) =>
    b.x >= f.x - 1 && b.y >= f.y - 1 && b.x + b.width <= f.x + f.width + 1 && b.y + b.height <= f.y + f.height + 1;

  test("120 bảng: Vừa màn hình đưa cả cây vào khung, kể cả khi hiện đủ cột; tìm được bảng", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/vi");
    await run(page, "vi", MANY);
    const canvas = stage(page).getByTestId("schema-canvas");
    await expect(canvas.locator(".react-flow__node").first()).toBeVisible({ timeout: 120_000 });
    await stage(page).getByRole("button", { name: "Hiện đủ cột" }).click();
    await stage(page).getByRole("button", { name: "Vừa màn hình" }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SHOTS}/ac8-120-du-cot.png` });
    await expect.poll(() => canvas.locator(".react-flow__node").count(), { timeout: 10_000 }).toBe(120);
    const frame = (await canvas.boundingBox())!;
    const boxes = await canvas.locator(".react-flow__node").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    expect(boxes.filter((b) => !inside(b, frame))).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/ac8-120-du-cot.png` });
    // tìm bảng: gõ tên, bảng đó vào khung và đủ lớn để đọc
    await stage(page).getByRole("searchbox", { name: "Tìm bảng" }).fill("t77");
    await page.keyboard.press("Enter");
    const hit = canvas.locator(".react-flow__node").filter({ has: page.locator('span[title="t77"]') }).first();
    await expect(hit).toBeVisible();
    await expect.poll(async () => (await hit.boundingBox())?.width ?? 0).toBeGreaterThan(150);
    expect(inside((await hit.boundingBox())!, (await canvas.boundingBox())!)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/ac8-120-tim-t77.png` });
    await stage(page).getByRole("searchbox", { name: "Tìm bảng" }).fill("khong_co");
    await page.keyboard.press("Enter");
    await expect(stage(page).getByText("Không có bảng nào tên")).toBeVisible();
  });
});

test.describe("AC8 ba bảng ở 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("đường nối không cắt qua chữ của thẻ", async ({ page }) => {
    await page.goto("/vi");
    await run(page, "vi", SETUP + "CREATE TABLE order_items(id int PRIMARY KEY, order_id int REFERENCES orders(id), sku text); SELECT 1");
    await expect(grid(page)).toHaveCount(1, { timeout: 90_000 });
    await openStage(page, "vi");
    const canvas = stage(page).getByTestId("schema-canvas");
    await expect(canvas.locator(".react-flow__node")).toHaveCount(3, { timeout: 30_000 });
    await page.waitForTimeout(800);
    expect(await canvas.locator(".react-flow__edge path.react-flow__edge-path").count()).toBe(2);
    // Mỗi đường nối là một path; lấy các điểm dọc đường và kiểm không điểm nào nằm trong vùng chữ của thẻ (phần giữa hai mép thẻ).
    const bad = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("#stage .react-flow__node")].map((n) => n.getBoundingClientRect());
      const paths = [...document.querySelectorAll("#stage .react-flow__edge path.react-flow__edge-path")] as SVGPathElement[];
      let n = 0;
      for (const p of paths) {
        const len = p.getTotalLength();
        const m = p.getScreenCTM()!;
        for (let i = 1; i < 60; i++) {
          const pt = p.getPointAtLength((len * i) / 60);
          const x = pt.x * m.a + pt.y * m.c + m.e;
          const y = pt.x * m.b + pt.y * m.d + m.f;
          // vùng chữ: bên trong thẻ, cách mép trái hơn 12 px
          if (cards.some((c) => x > c.x + 12 && x < c.right - 4 && y > c.y && y < c.bottom)) n++;
        }
      }
      return n;
    });
    expect(bad).toBe(0);
    await page.screenshot({ path: `${SHOTS}/ac8-390-3-bang.png` });
  });
});

// Cây 3 tầng thật (khóa text rộng, 100k dòng): root, internal, leaf trên đường đi phải cùng thấy được trong khung cuộn.
test.describe("tab B-Tree với cây 3 tầng", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const KEY = `${"k".repeat(50)}0050000`;
  test("root, internal, leaf của đường đi nằm trong khung", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/vi");
    await run(page, "vi", `CREATE TABLE big(k text); INSERT INTO big SELECT repeat('k', 50) || lpad(g::text, 7, '0') FROM generate_series(1, 100000) g; CREATE INDEX big_k ON big(k); SELECT 1`);
    await expect(stageTab(page, "vi", 2)).toBeVisible({ timeout: 200_000 });
    await pickTab(page, "vi", 2);
    await stage(page).locator("#stage-index").selectOption("big_k");
    await stage(page).locator("#stage-key").fill(KEY);
    await stage(page).getByTestId("stage-drop").click();
    await expect(stage(page).getByTestId("btree-drop")).toBeVisible({ timeout: 60_000 });
    await expect(stage(page).getByTestId("stage-evidence")).toContainText("3 tầng");
    await page.waitForTimeout(800);
    const frame = (await stage(page).getByTestId("btree-scroll").boundingBox())!;
    // Mỗi tầng (root, internal, leaf) phải có ít nhất một node nằm trọn trong khung ngay khi mở, không cần cuộn.
    const boxes = await stage(page).locator("[data-page]").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: Math.round(r.y), width: r.width, height: r.height };
      }),
    );
    await page.screenshot({ path: `${SHOTS}/1440-vi-btree-3-tang.png` });
    const inFrame = boxes.filter((b) => b.x >= frame.x - 1 && b.x + b.width <= frame.x + frame.width + 1 && b.y >= frame.y - 1 && b.y + b.height <= frame.y + frame.height + 1);
    expect(new Set(inFrame.map((b) => b.y)).size).toBe(3);
  });
});
