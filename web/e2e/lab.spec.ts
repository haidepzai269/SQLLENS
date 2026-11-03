import { expect, test, type Page } from "@playwright/test";

const T = {
  vi: {
    run: "Chạy",
    cancel: "Hủy",
    rebuild: "Dựng lại",
    retry: "Thử lại",
    real: "Thật",
    sqlError: "PostgreSQL báo lỗi",
    loadError: "Không tải được PostgreSQL",
    empty: "Truy vấn không trả dòng nào",
    ran: "PostgreSQL vừa chạy 3 câu, câu cuối trả 2 dòng",
    lost: "dữ liệu tạo bởi các câu trước đã mất",
    mysql: "MySQL cần đăng nhập, sẽ có ở SP004.",
    mysqlTab: "MySQL",
    terminalTab: "Terminal",
  },
  en: {
    run: "Run",
    cancel: "Cancel",
    rebuild: "Rebuild",
    retry: "Retry",
    real: "Real",
    sqlError: "PostgreSQL error",
    loadError: "Could not load PostgreSQL",
    empty: "The query returned no rows",
    ran: "PostgreSQL just ran 3 statements, the last returned 2 rows",
    lost: "data created by earlier statements is gone",
    mysql: "MySQL requires sign-in, coming in SP004.",
    mysqlTab: "MySQL",
    terminalTab: "Terminal",
  },
} as const;
const SHOTS = "../_bmad-output/SP003/STR012/Task020";
const AC1_SQL = "CREATE TABLE t(id int); INSERT INTO t VALUES (1),(2); SELECT * FROM t;";
const BAD_PHRASE = /thiết kế (này )?(đã )?ổn|design is (fine|ok|good)|good design/i;

// Khung bố cục chỉ render một cây (máy tính hoặc điện thoại), nhưng vẫn lọc phần tử đang hiển thị cho chắc.
const sqlBox = (p: Page) => p.locator("textarea:visible");
const runBtn = (p: Page, l: "vi" | "en") => p.getByRole("button", { name: T[l].run, exact: true });
const conclusion = (p: Page) => p.locator('[data-testid="conclusion"]:visible');
const isWasm = (url: string) => /\.wasm/.test(url);

async function runSql(p: Page, l: "vi" | "en", sql: string) {
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor(); // đợi bố cục hydrate xong mới biết máy tính hay điện thoại
  if (await tab.isVisible()) await tab.click(); // điện thoại: ô SQL nằm trong tab
  await sqlBox(p).fill(sql);
  await runBtn(p, l).click();
}

for (const l of ["vi", "en"] as const) {
  test.describe(l, () => {
    test("AC1+AC3 mở trang không tải WASM, có tiến trình khi tải, ra bảng 2 dòng và kết luận Thật", async ({ page }) => {
      const wasm: string[] = [];
      page.on("request", (r) => isWasm(r.url()) && wasm.push(r.url()));
      // Làm chậm WASM để thấy thanh tiến trình.
      await page.route(/\.wasm/, async (route) => {
        await new Promise((r) => setTimeout(r, 800));
        await route.continue();
      });
      await page.goto(`/${l}`);
      await page.waitForLoadState("networkidle");
      expect(wasm).toEqual([]);
      await runSql(page, l, AC1_SQL);
      await expect(page.locator("progress:visible")).toBeVisible();
      await expect(conclusion(page)).toContainText(T[l].real, { timeout: 60_000 });
      await expect(conclusion(page)).toContainText(T[l].ran);
      await expect(conclusion(page)).not.toContainText(BAD_PHRASE);
      await expect(page.locator("tbody:visible tr")).toHaveCount(2);
      expect(wasm.length).toBeGreaterThan(0);
    });

    test("AC2 tải thất bại hiện lỗi và Thử lại tải được", async ({ page }) => {
      let fail = true;
      await page.route(/\.wasm/, (route) => (fail ? route.abort() : route.continue()));
      await page.goto(`/${l}`);
      await runSql(page, l, "SELECT 1");
      await expect(page.locator('[data-testid="error"]:visible')).toContainText(T[l].loadError, { timeout: 60_000 });
      fail = false;
      await page.getByRole("button", { name: T[l].retry }).click();
      await expect(conclusion(page)).toContainText(T[l].real, { timeout: 60_000 });
    });

    test("AC4 Hủy câu chạy lâu: báo mất dữ liệu, Dựng lại chạy lại câu trước đó", async ({ page }) => {
      await page.goto(`/${l}`);
      await runSql(page, l, "CREATE TABLE t(id int); INSERT INTO t VALUES (7);");
      await expect(conclusion(page)).toBeVisible({ timeout: 60_000 });
      await runSql(page, l, "SELECT pg_sleep(60)");
      await page.getByRole("button", { name: T[l].cancel, exact: true }).click();
      await expect(page.locator('[data-testid="stopped"]:visible')).toContainText(T[l].lost);
      await expect(runBtn(page, l)).toBeDisabled();
      await page.getByRole("button", { name: T[l].rebuild, exact: true }).click();
      await expect(page.locator('[data-testid="stopped"]')).toHaveCount(0, { timeout: 60_000 });
      await runSql(page, l, "SELECT id FROM t");
      await expect(page.locator("tbody:visible tr")).toHaveText(/7/, { timeout: 60_000 });
    });

    test("AC5 thu nhỏ qua mốc 900 px rồi phóng lại vẫn giữ SQL và kết quả", async ({ page }) => {
      await page.goto(`/${l}`);
      await runSql(page, l, AC1_SQL);
      await expect(page.locator("tbody:visible tr")).toHaveCount(2, { timeout: 60_000 });
      await sqlBox(page).fill(`${AC1_SQL} -- draft`);
      await page.setViewportSize({ width: 600, height: 800 });
      await page.getByRole("tab", { name: "SQL", exact: true }).click();
      await expect(sqlBox(page)).toHaveValue(`${AC1_SQL} -- draft`);
      await page.getByRole("tab", { name: T[l].terminalTab, exact: true }).click();
      await expect(page.locator("tbody:visible tr")).toHaveCount(2);
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(sqlBox(page)).toHaveValue(`${AC1_SQL} -- draft`);
      await expect(page.locator("tbody:visible tr")).toHaveCount(2);
    });

    test("AC7 /lab chuyển về màn hình chính và giữ query", async ({ page }) => {
      await page.goto(`/${l}/lab?x=1`);
      await expect(page).toHaveURL(new RegExp(`/${l}\\?x=1$`));
      await expect(sqlBox(page)).toBeVisible();
    });

    test("SELEC 1 hiện lỗi PostgreSQL, không có kết luận", async ({ page }) => {
      await page.goto(`/${l}`);
      await runSql(page, l, "SELEC 1");
      const err = page.locator('[data-testid="error"]:visible');
      await expect(err).toContainText(/syntax error/i, { timeout: 60_000 });
      await expect(err).toContainText(T[l].sqlError);
      await expect(conclusion(page)).toHaveCount(0);
    });

    test("chọn MySQL: terminal báo cần đăng nhập, nút Chạy tắt", async ({ page }) => {
      await page.goto(`/${l}`);
      await sqlBox(page).fill("SELECT 1");
      await page.getByRole("tab", { name: T[l].mysqlTab }).click();
      await expect(page.getByText(T[l].mysql)).toBeVisible();
      await expect(runBtn(page, l)).toBeDisabled();
    });

    test("ảnh chụp 1440 px và 390 px; bảng rộng cuộn ngang bên trong khung ở 390 px", async ({ page }) => {
      test.setTimeout(120_000);
      const cols = Array.from({ length: 12 }, (_, i) => `1 AS very_long_column_name_number_${i}`).join(", ");
      for (const w of [1440, 390]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(`/${l}`);
        await runSql(page, l, `${AC1_SQL} SELECT ${cols};`);
        await expect(page.locator("tbody:visible tr")).toHaveCount(1, { timeout: 60_000 });
        const doc = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        expect(doc[0]).toBeLessThanOrEqual(doc[1]);
        const box = await page.locator('[data-slot="table-container"]:visible').evaluate((e) => [e.scrollWidth, e.clientWidth]);
        if (w === 390) expect(box[0]).toBeGreaterThan(box[1]);
        await page.screenshot({ path: `${SHOTS}/anh-${l}-${w}.png` });
      }
    });
  });
}

test("bấm Chạy liên tục chỉ tạo một worker", async ({ page }) => {
  const workers: string[] = [];
  page.on("worker", (w) => workers.push(w.url()));
  await page.goto("/en");
  await sqlBox(page).fill("SELECT 1");
  await runBtn(page, "en").dblclick();
  await expect(conclusion(page)).toBeVisible({ timeout: 60_000 });
  expect(workers).toHaveLength(1);
});

test("SQL trống thì nút Chạy bị vô hiệu", async ({ page }) => {
  await page.goto("/vi");
  await expect(runBtn(page, "vi")).toBeDisabled();
  await sqlBox(page).fill("   ");
  await expect(runBtn(page, "vi")).toBeDisabled();
  await sqlBox(page).fill("SELECT 1");
  await expect(runBtn(page, "vi")).toBeEnabled();
});

test("0 dòng hiện câu rỗng; infinity của timestamptz không làm sập trang (ghi chữ thật)", async ({ page }) => {
  await page.goto("/en");
  await runSql(page, "en", "SELECT 1 WHERE false");
  await expect(page.getByText(T.en.empty)).toBeVisible({ timeout: 60_000 });
  await runSql(page, "en", "SELECT 'infinity'::timestamptz AS a, '-infinity'::timestamptz AS b");
  const cells = page.locator("tbody:visible td");
  await expect(cells).toHaveCount(2, { timeout: 60_000 });
  console.log("INFINITY_CELLS", JSON.stringify(await cells.allTextContents()));
  await expect(conclusion(page)).toContainText("Real");
  await expect(sqlBox(page)).toBeVisible();
});

test("terminal đang tắt thì bấm Chạy mở lại để thấy kết quả", async ({ page }) => {
  await page.goto("/en");
  await sqlBox(page).waitFor();
  await page.getByRole("button", { name: /Terminal/ }).filter({ visible: true }).click();
  await expect(page.locator("#terminal")).toHaveCount(0);
  await runSql(page, "en", "SELECT 1");
  await expect(page.locator("tbody:visible tr")).toHaveCount(1, { timeout: 60_000 });
});
