import { expect, test, type Page } from "@playwright/test";

const T = {
  vi: { run: "Chạy", real: "Thật", sqlError: "PostgreSQL báo lỗi", empty: "Câu cuối không trả dòng nào." },
  en: { run: "Run", real: "Real", sqlError: "PostgreSQL reported an error", empty: "The last statement returned no rows." },
} as const;

// DOM có thể giữ bản cũ đã ẩn sau khi đổi ngôn ngữ, nên chỉ chọn phần tử đang hiển thị.
const sqlBox = (p: Page) => p.locator("textarea:visible");
const runBtn = (p: Page, l: "vi" | "en") => p.locator("button:visible", { hasText: T[l].run });
const isWasm = (url: string) => /pglite.*\.wasm|\.wasm/.test(url);

for (const l of ["vi", "en"] as const) {
  test.describe(l, () => {
    test("AC1 chạy 3 câu, hiện bảng 2 dòng và nhãn Thật", async ({ page }) => {
      await page.goto(`/${l}/lab`);
      await sqlBox(page).fill("CREATE TABLE t(id int); INSERT INTO t VALUES (1),(2); SELECT * FROM t;");
      await runBtn(page, l).click();
      const conclusion = page.locator('[data-testid="conclusion"]:visible');
      await expect(conclusion).toContainText(T[l].real, { timeout: 60_000 });
      await expect(page.locator("tbody:visible tr")).toHaveCount(2);
    });

    test("AC2 SELEC 1 hiện lỗi PostgreSQL, không nhãn Thật", async ({ page }) => {
      await page.goto(`/${l}/lab`);
      await sqlBox(page).fill("SELEC 1");
      await runBtn(page, l).click();
      await expect(page.locator('[data-testid="error"]:visible')).toContainText(/syntax error/i, { timeout: 60_000 });
      await expect(page.locator('[data-testid="error"]:visible')).toContainText(T[l].sqlError);
      await expect(page.locator('[data-testid="conclusion"]:visible')).toHaveCount(0);
    });
  });
}

test("AC3 ô trống thì nút Chạy bị vô hiệu", async ({ page }) => {
  await page.goto("/vi/lab");
  await expect(runBtn(page, "vi")).toBeDisabled();
  await sqlBox(page).fill("   ");
  await expect(runBtn(page, "vi")).toBeDisabled();
  await sqlBox(page).fill("SELECT 1");
  await expect(runBtn(page, "vi")).toBeEnabled();
});

test("AC5/AC6 mở trang không tải WASM, bấm Chạy mới tải và chạy được", async ({ page }) => {
  const wasm: string[] = [];
  page.on("request", (r) => isWasm(r.url()) && wasm.push(r.url()));
  await page.goto("/en/lab");
  await page.waitForLoadState("networkidle");
  expect(wasm).toEqual([]);
  await sqlBox(page).fill("SELECT 1");
  await runBtn(page, "en").click();
  await expect(page.locator('[data-testid="conclusion"]:visible')).toContainText("Real", { timeout: 60_000 });
  expect(wasm.length).toBeGreaterThan(0);
});

test("ca biên: chạy lại dùng lại instance, CREATE TABLE lần hai báo lỗi, 0 dòng hiện rỗng", async ({ page }) => {
  const wasm: string[] = [];
  await page.goto("/en/lab");
  await sqlBox(page).fill("CREATE TABLE t(id int);");
  await runBtn(page, "en").click();
  await expect(page.locator('[data-testid="conclusion"]:visible')).toBeVisible({ timeout: 60_000 });
  page.on("request", (r) => isWasm(r.url()) && wasm.push(r.url()));
  await runBtn(page, "en").click();
  await expect(page.locator('[data-testid="error"]:visible')).toContainText(/already exists/i);
  await sqlBox(page).fill("SELECT 1 WHERE false");
  await runBtn(page, "en").click();
  await expect(page.getByText(T.en.empty)).toBeVisible();
  expect(wasm).toEqual([]);
});

test("AC4 tải thất bại hiện lỗi và cho thử lại", async ({ page }) => {
  let fail = true;
  await page.route(/\.wasm/, (route) => (fail ? route.abort() : route.continue()));
  await page.goto("/en/lab");
  await sqlBox(page).fill("SELECT 1");
  await runBtn(page, "en").click();
  const alert = page.locator('[data-testid="error"]:visible');
  await expect(alert).toContainText("Could not load PostgreSQL", { timeout: 60_000 });
  fail = false;
  await page.locator("button:visible", { hasText: "Retry" }).click();
  await expect(page.locator('[data-testid="conclusion"]:visible')).toContainText("Real", { timeout: 60_000 });
});

test("hiển thị Date, bytea và số ít đúng", async ({ page }) => {
  await page.goto("/en/lab");
  await sqlBox(page).fill(String.raw`SELECT '2026-01-02 03:04:05+00'::timestamptz d, '\xdeadbeef'::bytea b`);
  await runBtn(page, "en").click();
  const row = page.locator("tbody:visible tr");
  await expect(row).toContainText("2026-01-02T03:04:05.000Z", { timeout: 60_000 });
  await expect(row).toContainText(String.raw`\xdeadbeef`);
  await expect(page.locator('[data-testid="conclusion"]:visible')).toContainText("1 statement,");
});
