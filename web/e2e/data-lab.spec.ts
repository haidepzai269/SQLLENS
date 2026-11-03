import { expect, test, type Page } from "@playwright/test";

const T = {
  vi: {
    run: "Chạy", open: "Sinh dữ liệu", cancel: "Hủy", disabledHint: "Cần có ít nhất một bảng",
    rowsOf: (t: string) => `Số dòng của bảng ${t}`, columns: /Chỉnh 2 cột|Chỉnh 1 cột/,
    distinctOf: (c: string) => `Số giá trị khác nhau của cột ${c}`, warn: "khoảng 600 MB RAM", cancelled: "Đã hủy sinh dữ liệu, dữ liệu trở về như trước.",
    large: /Capacity Advisor.*Ước lượng/, unsupported: /Không sinh được dữ liệu/, tabTerminal: "Terminal",
  },
  en: {
    run: "Run", open: "Generate data", cancel: "Cancel", disabledHint: "Needs at least one table",
    rowsOf: (t: string) => `Rows for table ${t}`, columns: /Tune [12] columns?/,
    distinctOf: (c: string) => `Distinct values of column ${c}`, warn: "about 600 MB of RAM", cancelled: "Data generation cancelled, the data is back to how it was.",
    large: /Capacity Advisor.*Estimated/, unsupported: /Could not generate data/, tabTerminal: "Terminal",
  },
} as const;
const SHOTS = "../_bmad-output/SP003/STR014/Task024";

// Máy bận thì mỗi lần khởi tạo PGlite có thể mất vài chục giây.
test.describe.configure({ timeout: 120_000 });

const sqlBox = (p: Page) => p.locator(".cm-content:visible");
const dialog = (p: Page) => p.getByRole("dialog");

async function runSql(p: Page, l: "vi" | "en", sql: string) {
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor();
  if (await tab.isVisible()) await tab.click();
  await sqlBox(p).fill(sql);
  const items = p.locator("#terminal ol:visible li");
  const before = await items.count();
  await p.getByRole("button", { name: T[l].run, exact: true }).click();
  // Ở 390 px kết luận nằm ở tab Rủi ro, nên đợi nhật ký chạy ở terminal có thêm dòng.
  await expect(items).not.toHaveCount(before, { timeout: 60_000 });
}
async function count(p: Page, l: "vi" | "en", sql: string) {
  await runSql(p, l, sql);
  const cell = p.locator("tbody:visible td").first();
  await expect(cell).toBeVisible();
  return (await cell.innerText()).trim();
}
async function openDialog(p: Page, l: "vi" | "en") {
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  if (await tab.isVisible()) await tab.click();
  await p.getByRole("button", { name: T[l].open, exact: true }).click();
  await expect(dialog(p)).toBeVisible();
  await expect(dialog(p).locator("select").first()).toBeVisible({ timeout: 30_000 });
}
const start = (p: Page, l: "vi" | "en") => dialog(p).getByRole("button", { name: T[l].open, exact: true });
const FK_SCHEMA = `CREATE TABLE customers(id int PRIMARY KEY, email text NOT NULL);
CREATE TABLE orders(id int PRIMARY KEY, customer_id int NOT NULL REFERENCES customers(id), status text);
CREATE TABLE order_items(id int PRIMARY KEY, order_id int NOT NULL REFERENCES orders(id), qty int);`;

for (const l of ["vi", "en"] as const) {
  test.describe(l, () => {
    test("nút bị vô hiệu kèm giải thích khi chưa có bảng, bật sau CREATE TABLE", async ({ page }) => {
      await page.goto(`/${l}`);
      const btn = page.getByRole("button", { name: T[l].open, exact: true });
      await expect(btn).toBeDisabled();
      await expect(page.getByText(T[l].disabledHint)).toBeVisible();
      await runSql(page, l, "CREATE TABLE t(id int)");
      await expect(btn).toBeEnabled();
    });

    test("AC1 ba bảng có FK, 10k mỗi bảng: không lỗi, terminal ghi số dòng và thời gian", async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto(`/${l}`);
      await runSql(page, l, FK_SCHEMA);
      await openDialog(page, l);
      for (const t of ["customers", "orders", "order_items"]) await dialog(page).getByLabel(T[l].rowsOf(t)).selectOption("10000");
      await start(page, l).click();
      await expect(dialog(page)).toHaveCount(0, { timeout: 90_000 });
      const log = page.locator("#terminal ol:visible");
      await expect(log).toContainText(/customers: 10[.,]000, orders: 10[.,]000, order_items: 10[.,]000/);
      await expect(log).toContainText(/\d+\.\d (giây|s)/);
      await expect(page.locator('[data-testid="stopped"]')).toHaveCount(0);
      expect(await count(page, l, "SELECT count(*) FROM order_items")).toBe("10000");
      expect(await count(page, l, "SELECT count(*) FROM orders o JOIN customers c ON c.id = o.customer_id")).toBe("10000");
    });

    test("AC3 status có 3 giá trị khác nhau", async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto(`/${l}`);
      await runSql(page, l, "CREATE TABLE orders(id int PRIMARY KEY, status text, note text)");
      await openDialog(page, l);
      await dialog(page).getByLabel(T[l].rowsOf("orders")).selectOption("10000");
      await dialog(page).locator("summary").click();
      await dialog(page).getByLabel(T[l].distinctOf("orders.status")).fill("3");
      await start(page, l).click();
      await expect(dialog(page)).toHaveCount(0, { timeout: 90_000 });
      expect(await count(page, l, "SELECT count(DISTINCT status) FROM orders")).toBe("3");
    });

    test("AC2 Hủy giữa chừng khi sinh 500k: count(*) trả số cũ", async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto(`/${l}`);
      await runSql(page, l, "CREATE TABLE big(id int PRIMARY KEY, v int); INSERT INTO big VALUES (-5, 0);");
      await openDialog(page, l);
      await dialog(page).getByLabel(T[l].rowsOf("big")).selectOption("500000");
      await start(page, l).click();
      await expect(dialog(page).locator("progress")).toBeVisible();
      await dialog(page).getByRole("button", { name: T[l].cancel, exact: true }).click();
      await expect(dialog(page)).toHaveCount(0, { timeout: 90_000 });
      await expect(page.locator("#terminal ol:visible")).toContainText(T[l].cancelled);
      expect(await count(page, l, "SELECT count(*) FROM big")).toBe("1");
    });

    test("Task027 AC8 dựng lại sau khi sinh dữ liệu: đếm đúng câu của người dùng và nói rõ dữ liệu sinh không được giữ", async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto(`/${l}`);
      await runSql(page, l, "CREATE TABLE g(id int PRIMARY KEY, v int)");
      await openDialog(page, l);
      await dialog(page).getByLabel(T[l].rowsOf("g")).selectOption("10000");
      await start(page, l).click();
      await expect(dialog(page)).toHaveCount(0, { timeout: 90_000 });
      expect(await count(page, l, "SELECT count(*) FROM g")).toBe("10000");
      await runSql(page, l, "SELECT pg_sleep(60)");
      await page.getByRole("button", { name: T[l].cancel, exact: true }).click();
      const stopped = page.locator('[data-testid="stopped"]:visible');
      await expect(stopped).toContainText(l === "vi" ? /chạy lại 2 câu/ : /replay 2 statements/); // CREATE và SELECT count; không tính BEGIN, INSERT, COMMIT hay kiểm bảng
      await stopped.getByRole("button", { name: l === "vi" ? "Dựng lại" : "Rebuild", exact: true }).click();
      await expect(page.locator("#terminal ol:visible")).toContainText(l === "vi" ? "không được giữ lại" : "is not kept", { timeout: 60_000 });
      expect(await count(page, l, "SELECT count(*) FROM g")).toBe("0");
    });

    test("AC4 cảnh báo 500k, không có lựa chọn trên 500k, có câu dẫn đến Capacity Advisor", async ({ page }) => {
      await page.goto(`/${l}`);
      await runSql(page, l, "CREATE TABLE t(id int PRIMARY KEY)");
      await openDialog(page, l);
      await expect(dialog(page).getByTestId("warn-500k")).toHaveCount(0);
      const sel = dialog(page).getByLabel(T[l].rowsOf("t"));
      await sel.selectOption("500000");
      await expect(dialog(page).getByTestId("warn-500k")).toContainText(T[l].warn);
      const values = await sel.locator("option").evaluateAll((o) => o.map((x) => Number((x as HTMLOptionElement).value)));
      expect(values).toEqual([10000, 100000, 500000]);
      await expect(dialog(page)).toContainText(T[l].large);
    });

    test("kiểu không hỗ trợ NOT NULL: lỗi rõ, không sinh nửa chừng", async ({ page }) => {
      await page.goto(`/${l}`);
      await runSql(page, l, "CREATE TABLE u(id int PRIMARY KEY, b bytea NOT NULL)");
      await openDialog(page, l);
      await start(page, l).click();
      await expect(dialog(page).getByTestId("gen-error")).toContainText(T[l].unsupported);
      await expect(dialog(page).getByTestId("gen-error")).toContainText("bytea");
      await dialog(page).getByRole("button", { name: l === "vi" ? "Đóng" : "Close", exact: true }).first().click();
      expect(await count(page, l, "SELECT count(*) FROM u")).toBe("0");
    });

    test("AC5+AC6 bàn phím, focus nhìn thấy, không tràn ngang; ảnh 1440 và 390", async ({ page }) => {
      test.setTimeout(120_000);
      for (const w of [1440, 390]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(`/${l}`);
        await runSql(page, l, "CREATE TABLE a_table_with_a_rather_long_name_for_wrapping(id int PRIMARY KEY, a_long_column_name_here text, other text)");
        await openDialog(page, l);
        await dialog(page).locator("summary").click();
        await dialog(page).getByLabel(T[l].rowsOf("a_table_with_a_rather_long_name_for_wrapping")).selectOption("500000");
        const over = await dialog(page).evaluate((e) => [e.scrollWidth, e.clientWidth]);
        expect(over[0]).toBeLessThanOrEqual(over[1]);
        const doc = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        expect(doc[0]).toBeLessThanOrEqual(doc[1]);
        await page.screenshot({ path: `${SHOTS}/anh-${l}-${w}.png` });
        if (w === 1440) {
          // Tab qua các điều khiển: phần tử đang focus nằm trong dialog và có viền focus.
          await page.keyboard.press("Tab");
          const f = await page.evaluate(() => {
            const a = document.activeElement as HTMLElement;
            const cs = getComputedStyle(a);
            return { inDialog: !!a.closest('[role="dialog"]'), visible: cs.outlineStyle !== "none" || cs.boxShadow !== "none" };
          });
          expect(f.inDialog).toBe(true);
          expect(f.visible).toBe(true);
          await page.keyboard.press("Escape");
          await expect(dialog(page)).toHaveCount(0);
          await expect(page.getByRole("button", { name: T[l].open, exact: true })).toBeFocused();
        }
      }
    });
  });
}
