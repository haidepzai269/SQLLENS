import { expect, test, type Page } from "@playwright/test";

const SHOTS = "../_bmad-output/SP999/STR062/Task062/anh";
type L = "vi" | "en";
const T = {
  vi: { run: "Chạy", stage: "Mô phỏng", tabs: ["Sơ đồ", "Plan", "B-Tree", "Thử sửa", "Capacity", "Mentor"], hint: "Chưa có cảnh để hiện", cancel: "Hủy", rebuild: "Dựng lại" },
  en: { run: "Run", stage: "Simulation", tabs: ["Schema", "Plan", "B-Tree", "Try a fix", "Capacity", "Mentor"], hint: "Nothing to show yet", cancel: "Cancel", rebuild: "Rebuild" },
} as const;
const SHOTS63 = "../_bmad-output/SP999/STR062/Task063/anh";
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
const panel = (p: Page) => stage(p).locator('[role="tabpanel"]:not([hidden])'); // panel giữ mounted, chỉ panel đang mở hiện
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
      await expect(panel(page).getByTestId("stage-evidence")).toBeVisible();
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
      // Phân biệt câu của tab Thử sửa với tab Plan, và kiểm chỉ một panel hiện để bắt lỗi thật nếu panel cũ không ẩn.
      await expect(stage(page).getByRole("status").filter({ hasText: l === "vi" ? "SELECT nào để đo" : "SELECT statement to measure" })).toBeVisible();
      await expect(stage(page).getByRole("tabpanel")).toHaveCount(1);
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

    test("đổi tab qua lại không chạy lại explain (nextval không nhảy thêm)", async ({ page }) => {
      await page.goto(`/${l}`);
      // s: mở Plan rồi đổi tab qua lại 2 lần; t: chỉ mở Plan một lần. Nếu đổi tab chạy lại explain thì s nhảy nhiều hơn t.
      await run(page, l, "CREATE SEQUENCE s; CREATE SEQUENCE t; SELECT nextval('s')");
      await expect(grid(page)).toHaveCount(1, { timeout: 90_000 });
      await pickTab(page, l, 1);
      await expect(stage(page).getByTestId("plan-tree")).toBeVisible({ timeout: 30_000 });
      for (let i = 0; i < 2; i++) {
        await pickTab(page, l, 0);
        await pickTab(page, l, 1);
        await expect(stage(page).getByTestId("plan-tree")).toBeVisible();
      }
      await run(page, l, "SELECT nextval('t') AS n");
      await expect(stage(page).getByTestId("stage-viewing")).toContainText("nextval('t')", { timeout: 30_000 });
      await expect(stage(page).getByTestId("plan-tree")).toBeVisible({ timeout: 30_000 });
      await run(page, l, "SELECT pg_sequence_last_value('s'::regclass) AS a, pg_sequence_last_value('t'::regclass) AS b, 'read' AS tag");
      await expect.poll(() => gridText(page), { timeout: 60_000 }).toMatch(/read$/);
      const [a, b] = (await gridText(page)).split("	");
      expect(a).toBe(b);
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
    await expect(panel(page).getByTestId("stage-evidence")).toContainText("3 tầng");
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

// Task063 AC4: mọi trang trên đường đi path.pages nằm trọn trong khung cuộn, ngay khi vẽ và ở mỗi bước, kể cả leaf đích.
const WIDE = (n: number) => `${"k".repeat(50)}${String(n).padStart(7, "0")}`;
async function pathOutsideFrame(p: Page): Promise<string[]> {
  return p.evaluate(() => {
    const txt = document.querySelector('[data-testid="drop-summary"]')?.textContent ?? "";
    const pages = (/((?:\d+ → )*\d+)/.exec(txt.replace(/^.*?:/, "")) ?? [])[1]?.split(" → ").map(Number) ?? [];
    const sc = document.querySelector<HTMLElement>('[data-testid="btree-scroll"]')!.getBoundingClientRect();
    const zone = document.getElementById("stage")!.getBoundingClientRect(); // vùng stage cắt nội dung của nó
    const f = { l: Math.max(sc.left, zone.left, 0), r: Math.min(sc.right, zone.right, innerWidth), t: Math.max(sc.top, zone.top, 0), b: Math.min(sc.bottom, zone.bottom, innerHeight) };
    const bad: string[] = [];
    if (!pages.length) bad.push("no-path");
    pages.forEach((pg, i) => {
      const el = document.querySelector(`g[data-page="${pg}"]`) ?? document.querySelector(`g[data-hidden-level="${pages.length - 1 - i}"]`);
      if (!el) return void bad.push(`${pg}:missing`);
      const r = el.getBoundingClientRect();
      if (r.left < f.l - 1 || r.right > f.r + 1 || r.top < f.t - 1 || r.bottom > f.b + 1) bad.push(`${pg}:${Math.round(r.left)}-${Math.round(r.right)}/${Math.round(r.top)}-${Math.round(r.bottom)} khung ${Math.round(f.l)}-${Math.round(f.r)}/${Math.round(f.t)}-${Math.round(f.b)}`);
    });
    return bad;
  });
}
for (const [rows, levels] of [[3000, 2], [100_000, 3]] as const) {
  for (const w of [1440, 390] as const) {
    test.describe(`AC4 cây ${levels} tầng ${w}px`, () => {
      test.use({ viewport: { width: w, height: w === 1440 ? 900 : 844 } });
      test(`đường đi nằm trong khung với khóa nhỏ nhất và lớn nhất`, async ({ page }) => {
        test.setTimeout(300_000);
        await page.goto("/vi");
        await run(page, "vi", `CREATE TABLE big(k text); INSERT INTO big SELECT repeat('k', 50) || lpad(g::text, 7, '0') FROM generate_series(1, ${rows}) g; CREATE INDEX big_k ON big(k); SELECT 1`);
        await expect(grid(page)).toHaveCount(1, { timeout: 200_000 });
        await openStage(page, "vi");
        await expect(stageTab(page, "vi", 2)).toBeVisible({ timeout: 200_000 });
        await pickTab(page, "vi", 2);
        await stage(page).locator("#stage-index").selectOption("big_k");
        for (const key of [WIDE(1), WIDE(rows)]) {
          await stage(page).locator("#stage-key").fill(key);
          await stage(page).getByTestId("stage-drop").click();
          await expect(stage(page).getByTestId("btree-drop")).toBeVisible({ timeout: 60_000 });
          await expect(panel(page).getByTestId("stage-evidence")).toContainText(`${levels} tầng`);
          await expect(stage(page).getByTestId("drop-summary")).toContainText(key);
          await page.waitForTimeout(600);
          expect(await pathOutsideFrame(page), `khóa ${key.slice(-7)} lúc vừa vẽ`).toEqual([]);
          const total = Number(/\/\s*(\d+)/.exec((await stage(page).getByTestId("drop-counter").innerText()))?.[1] ?? 0);
          expect(total).toBeGreaterThanOrEqual(levels);
          for (let s = 1; s <= levels; s++) {
            await stage(page).getByRole("button", { name: "Bước tới" }).click();
            await expect(stage(page).getByTestId("btree-drop")).toHaveAttribute("data-step", String(s));
            await page.waitForTimeout(250);
            expect(await pathOutsideFrame(page), `khóa ${key.slice(-7)} bước ${s}`).toEqual([]);
          }
          if (levels === 3 && w === 1440 && key === WIDE(rows)) await page.screenshot({ path: `${SHOTS63}/ac4-1440-vi-btree-3-tang-max.png` });
        }
      });
    });
  }
}

// ---- Task063: tab Capacity và Mentor ----
const ASK = "SELECT email FROM users WHERE id = 7"; // kết quả của câu này chứa chuỗi đánh dấu, chuỗi đó không được lên AI
const MARK = "SECRET_MARK_7f3a9c";
const SETUP63 = SETUP.replace("'u' || g", `'${MARK}' || g`);
const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const ME = { id: "u1", name: "Tester", provider: "google" };
const capTab = 4;
const mentorTab = 5;
// Không nhắc tên bảng nào: câu có tên bảng lạ sẽ mở hộp thoại suy schema.
const SCRATCH_GONE = "SELECT to_regclass('sqllens_capacity_scratch') IS NULL AS gone";

async function asUser(p: Page, onChat?: (body: string) => void) {
  await p.route("**/api/me", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ME) }));
  await p.route("**/api/ai/chat", (r) => {
    onChat?.(r.request().postData() ?? "");
    return r.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: sse({ type: "delta", text: "Thử tạo index: \n```sql\nCREATE INDEX o_total_idx ON orders(total)\n```\n" }) + sse({ type: "done" }),
    });
  });
}
async function measure(p: Page, n: number) {
  await stage(p).getByTestId(`level-measure-${n}`).click();
  await expect(stage(p).getByTestId(`level-status-${n}`)).not.toHaveText(/Đang đo|Measuring/, { timeout: 120_000 });
  await expect(stage(p).getByTestId("capacity-error")).toHaveCount(0);
}

for (const l of ["vi", "en"] as const) {
  test.describe(`Task063 ${l} 1440`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("AC1 AC6 Capacity: đo trên bảng tạm, dữ liệu không đổi, chạy lại bỏ số cũ", async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto(`/${l}`);
      await run(page, l, SETUP + SUM);
      await expect(grid(page)).toHaveCount(1, { timeout: 90_000 });
      const before = await gridText(page);
      await run(page, l, "SELECT count(*) AS c FROM orders WHERE user_id = 7");
      await expect(stageTab(page, l, capTab)).toBeVisible({ timeout: 60_000 });
      await pickTab(page, l, capTab);
      await stage(page).locator("#stage-cap-index").selectOption("orders_user_idx");
      await expect(stage(page).getByTestId("stage-cap-probe")).toContainText(l === "vi" ? "thứ 1" : "number 1");
      await measure(page, 10_000);
      await expect(stage(page).getByTestId("capacity-label").first()).toHaveAttribute("data-label", "real");
      expect(Number(await stage(page).getByTestId("capacity-height").getAttribute("data-raw"))).toBeGreaterThanOrEqual(1);
      expect(Number(await stage(page).getByTestId("capacity-size").getAttribute("data-raw"))).toBeGreaterThan(0);
      expect(Number(await stage(page).getByTestId("capacity-pages").getAttribute("data-raw"))).toBeGreaterThan(0); // có câu thăm dò
      // đổi tab qua lại không đo lại, số còn nguyên
      const size = await stage(page).getByTestId("capacity-size").getAttribute("data-raw");
      await pickTab(page, l, 0);
      await pickTab(page, l, capTab);
      await expect(stage(page).getByTestId("capacity-size")).toHaveAttribute("data-raw", size!);
      // AC6: chạy lại thì số cũ biến mất; dữ liệu của người dùng không đổi (checksum) và bảng tạm đã dọn
      await run(page, l, SUM.replace("FROM orders", ", 'again' AS tag FROM orders"));
      await expect.poll(() => gridText(page), { timeout: 60_000 }).toBe(`${before}	again`);
      await expect(stage(page).getByTestId("capacity-panel")).toHaveCount(0);
      await run(page, l, SCRATCH_GONE);
      await expect(grid(page)).toHaveText(/^t$/, { timeout: 60_000 });
    });

    test("ca biên Capacity: không index, không SELECT, SELECT không đọc bảng của index, chạy lại lúc đang đo", async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto(`/${l}`);
      await run(page, l, "SELECT 1");
      await expect(stageTab(page, l, capTab)).toBeVisible({ timeout: 90_000 });
      await pickTab(page, l, capTab);
      await expect(stage(page).getByRole("status").filter({ hasText: l === "vi" ? "chưa có index" : "no index" })).toBeVisible();
      await run(page, l, SETUP + "CREATE TABLE z(id int primary key)");
      await expect(stage(page).getByRole("tab").first()).toBeVisible({ timeout: 90_000 });
      await pickTab(page, l, capTab);
      await stage(page).locator("#stage-cap-index").selectOption("orders_user_idx");
      await expect(stage(page).getByTestId("stage-cap-probe")).toContainText(l === "vi" ? "không có câu SELECT" : "no SELECT");
      await run(page, l, "SELECT count(*) FROM users");
      await expect(stage(page).getByTestId("stage-viewing")).toHaveCount(0);
      await pickTab(page, l, capTab);
      await stage(page).locator("#stage-cap-index").selectOption("orders_user_idx");
      await expect(stage(page).getByTestId("stage-cap-probe")).toContainText(l === "vi" ? "không đọc bảng orders" : "does not read table orders");
      // bắt đầu đo 100k rồi chạy lại ngay: panel bị bỏ, đo dừng và bảng tạm được dọn
      await stage(page).getByTestId("level-measure-100000").click();
      await expect(stage(page).getByTestId("capacity-progress")).toBeVisible();
      await run(page, l, SCRATCH_GONE);
      await expect(stage(page).getByTestId("capacity-panel")).toHaveCount(0);
      await expect(grid(page)).toHaveText(/^[tf]$/, { timeout: 120_000 }); // câu này xếp hàng sau lô đang nạp, có thể thấy bảng tạm còn
      await run(page, l, SCRATCH_GONE + " /* lần 2 */"); // đo đã dừng và dọn: lần hỏi sau thấy bảng tạm đã mất
      await expect(grid(page)).toHaveText(/^t$/, { timeout: 120_000 });
    });

    test("AC2 Mentor chưa đăng nhập: tab khóa có lời mời, SQL còn sau khi đăng nhập xong (Task066)", async ({ page }) => {
      test.setTimeout(240_000);
      await page.route("**/api/me", (r) => r.fulfill({ status: 401, body: "{}" }));
      await page.route("**/api/auth/google/start**", (r) => r.fulfill({ status: 302, headers: { location: `/${l}` } }));
      await page.goto(`/${l}`);
      await run(page, l, "CREATE TABLE users(id int, email text); SELECT email FROM users"); // khách chỉ chạy được câu cơ bản
      await expect(stageTab(page, l, mentorTab)).toBeVisible({ timeout: 90_000 });
      await pickTab(page, l, mentorTab);
      const locked = stage(page).getByTestId("locked-tab").filter({ visible: true });
      await expect(locked).toBeVisible({ timeout: 30_000 });
      await expect(stage(page).getByTestId("mentor-question")).toHaveCount(0); // khách không có ô hỏi, nên không gọi AI
      await locked.getByRole("link").click();
      await expect(page).toHaveURL(new RegExp(`/${l}/login`));
      await page.getByRole("link", { name: /Google/ }).click();
      await expect(sqlBox(page)).toContainText("SELECT email FROM users", { timeout: 30_000 }); // SQL còn trong ô soạn
    });

    test("AC3 AC6 Mentor đã đăng nhập: gói gửi đi chỉ có SQL và plan, Áp dụng không commit, chạy lại bỏ câu trả lời", async ({ page }) => {
      test.setTimeout(240_000);
      const bodies: string[] = [];
      await asUser(page, (b) => bodies.push(b));
      await page.goto(`/${l}`);
      await run(page, l, SETUP63 + ASK);
      await expect(grid(page)).toHaveCount(1, { timeout: 90_000 });
      expect(await gridText(page)).toContain(MARK); // dữ liệu có thật trong kết quả
      await pickTab(page, l, mentorTab);
      await expect(stage(page).getByTestId("mentor-invite")).toHaveCount(0);
      await stage(page).getByTestId("mentor-question").fill("Index nào giúp?");
      await stage(page).getByTestId("mentor-send").click();
      await expect(stage(page).getByTestId("mentor-sql-ok")).toHaveCount(1, { timeout: 90_000 });
      expect(bodies).toHaveLength(1);
      const sent = JSON.parse(bodies[0]) as { question: string; evidence: { sql: string; engine: string; plan?: { root: unknown } }; locale: string };
      expect(sent.evidence.sql).toBe(ASK);
      expect(sent.evidence.engine).toBe("postgres");
      expect(sent.evidence.plan?.root).toBeTruthy();
      expect(bodies[0]).not.toContain(MARK);
      // Áp dụng: mở so sánh tại chỗ, chưa tạo gì
      await stage(page).getByTestId("mentor-apply").click();
      await expect(stage(page).getByTestId("mentor-applied")).toBeVisible();
      await run(page, l, "SELECT to_regclass('o_total_idx') IS NULL AS gone");
      await expect(grid(page)).toHaveText(/^t$/, { timeout: 60_000 });
      // AC6: chạy lại thì câu trả lời cũ và ô hỏi không còn
      await expect(stage(page).getByTestId("mentor-answer")).toHaveCount(0);
      await expect(stage(page).getByTestId("mentor-turn")).toHaveCount(0);
      await expect(stage(page).getByTestId("mentor-question")).toHaveValue(""); // tab dựng mới cho lần chạy mới
    });

    test("ca biên Mentor: không SELECT; đang gửi thì chạy lại SQL", async ({ page }) => {
      test.setTimeout(240_000);
      await asUser(page);
      await page.route("**/api/ai/chat", () => new Promise(() => {})); // route đăng ký sau được ưu tiên: không bao giờ trả lời
      await page.goto(`/${l}`);
      await run(page, l, "CREATE TABLE z(id int)");
      await expect(stageTab(page, l, mentorTab)).toBeVisible({ timeout: 90_000 });
      await pickTab(page, l, mentorTab);
      await expect(stage(page).getByRole("status").filter({ hasText: l === "vi" ? "không có câu SELECT" : "no SELECT" })).toBeVisible();
      await run(page, l, "SELECT 1 AS a");
      await expect(stageTab(page, l, mentorTab)).toBeVisible({ timeout: 60_000 });
      await pickTab(page, l, mentorTab);
      await stage(page).getByTestId("mentor-question").fill("hỏi");
      await stage(page).getByTestId("mentor-send").click();
      await expect(stage(page).getByTestId("mentor-turn")).toHaveAttribute("data-phase", "sending");
      await run(page, l, "SELECT 2 AS b");
      await expect(grid(page)).toHaveText(/2/, { timeout: 60_000 });
      await expect(stage(page).getByTestId("mentor-turn")).toHaveCount(0);
      await expect(stage(page).getByTestId("mentor-error")).toHaveCount(0);
    });
  });

  for (const w of [1440, 390] as const) {
    test.describe(`Task063 ảnh ${l} ${w}`, () => {
      test.use({ viewport: { width: w, height: w === 1440 ? 900 : 844 } });
      test("sáu tab vừa khung, không cuộn ngang; ảnh Capacity và Mentor", async ({ page }) => {
        test.setTimeout(240_000);
        await asUser(page);
        await page.goto(`/${l}`);
        await run(page, l, SETUP + "SELECT count(*) AS c FROM orders WHERE user_id = 7");
        await expect(grid(page)).toHaveCount(1, { timeout: 90_000 });
        await openStage(page, l);
        await expect(stageTab(page, l, 0)).toBeVisible({ timeout: 90_000 });
        const vw = page.viewportSize()!.width;
        for (let i = 0; i < 6; i++) {
          const b = (await stageTab(page, l, i).boundingBox())!;
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.x + b.width).toBeLessThanOrEqual(vw);
        }
        await pickTab(page, l, capTab);
        await stage(page).locator("#stage-cap-index").selectOption("orders_user_idx");
        await measure(page, 10_000);
        await stage(page).getByTestId("capacity-panel").scrollIntoViewIfNeeded();
        expect(await noHScroll(page)).toBe(true);
        await page.screenshot({ path: `${SHOTS63}/${w}-${l}-capacity.png` });
        await pickTab(page, l, mentorTab);
        await stage(page).getByTestId("mentor-question").fill(l === "vi" ? "Index nào giúp truy vấn này?" : "Which index helps this query?");
        await stage(page).getByTestId("mentor-send").click();
        await expect(stage(page).getByTestId("mentor-sql-ok")).toHaveCount(1, { timeout: 90_000 });
        await stage(page).getByTestId("mentor-apply").click();
        await expect(stage(page).getByTestId("mentor-applied")).toBeVisible();
        expect(await noHScroll(page)).toBe(true);
        await page.screenshot({ path: `${SHOTS63}/${w}-${l}-mentor.png` });
        expect(await page.evaluate(() => document.body.innerText)).not.toMatch(BAD);
      });
    });
  }
}

// Task063 AC5: CapacityPanel với cây 3 tầng thật: root, internal, leaf đều có node nằm trọn trong khung cuộn.
test.describe("Task063 AC5 Capacity cây 3 tầng", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("tầng internal thấy được trong khung", async ({ page }) => {
    test.setTimeout(280_000);
    await page.goto("/vi");
    await run(page, "vi", "CREATE TABLE accounts(email text PRIMARY KEY); INSERT INTO accounts SELECT 'u' || g FROM generate_series(1, 20) g; SELECT count(*) FROM accounts");
    await expect(grid(page)).toHaveCount(1, { timeout: 90_000 });
    await pickTab(page, "vi", 4);
    await stage(page).locator("#stage-cap-index").selectOption("accounts_pkey");
    await measure(page, 100_000);
    await expect(stage(page).getByTestId("capacity-tiers")).toHaveAttribute("data-height", "3");
    await stage(page).getByTestId("btree-scroll").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const rows = await stage(page).getByTestId("capacity-panel").evaluate((panel) => {
      const zone = document.getElementById("stage")!.getBoundingClientRect();
      const s0 = panel.querySelector<HTMLElement>('[data-testid="btree-scroll"]')!.getBoundingClientRect();
      const sc = { left: Math.max(s0.left, zone.left, 0), right: Math.min(s0.right, zone.right, innerWidth), top: Math.max(s0.top, zone.top, 0), bottom: Math.min(s0.bottom, zone.bottom, innerHeight) };
      const ys = new Map<number, { all: number; inside: number }>();
      for (const g of panel.querySelectorAll("g[data-page],g[data-hidden-level]")) {
        const r = g.getBoundingClientRect();
        const y = Math.round(r.top);
        const c = ys.get(y) ?? { all: 0, inside: 0 };
        c.all++;
        if (r.left >= sc.left - 1 && r.right <= sc.right + 1 && r.top >= sc.top - 1 && r.bottom <= sc.bottom + 1) c.inside++;
        ys.set(y, c);
      }
      return [...ys.entries()].sort((a, b) => a[0] - b[0]).map(([y, c]) => ({ y, ...c }));
    });
    await page.screenshot({ path: `${SHOTS63}/ac5-1440-vi-capacity-3-tang.png` });
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.inside, JSON.stringify(rows)).toBeGreaterThan(0);
  });
});
