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
    mysql: "MySQL cần đăng nhập. Đăng nhập để tiếp tục.",
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
    mysql: "MySQL requires sign-in. Sign in to continue.",
    mysqlTab: "MySQL",
    terminalTab: "Terminal",
  },
} as const;
// Cổng đăng nhập hỏi /api/me; ở các test này chưa biết là ai (503) để hộp thoại không che giao diện, kể cả khi máy đang chạy Gin.
test.beforeEach(({ page }) => page.route("**/api/me", (r) => r.fulfill({ status: 503, body: "{}" })));

const SHOTS = "../_bmad-output/SP006/STR025/Task032"; // không ghi đè ảnh của Task020
const AC1_SQL = "CREATE TABLE t(id int); INSERT INTO t VALUES (1),(2); SELECT * FROM t;";
const BAD_PHRASE = /thiết kế (này )?(đã )?ổn|design is (fine|ok|good)|good design/i;

// Khung bố cục chỉ render một cây (máy tính hoặc điện thoại), nhưng vẫn lọc phần tử đang hiển thị cho chắc.
const sqlBox = (p: Page) => p.locator(".cm-content:visible");
const sqlText = (p: Page) => sqlBox(p).evaluate((el) => (el as HTMLElement).innerText.replace(/​/g, ""));
const mark = (p: Page) => p.locator(".cm-sql-error:visible");
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
      await expect.poll(() => sqlText(page)).toBe(`${AC1_SQL} -- draft`);
      await page.getByRole("tab", { name: T[l].terminalTab, exact: true }).click();
      await expect(page.locator("tbody:visible tr")).toHaveCount(2);
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect.poll(() => sqlText(page)).toBe(`${AC1_SQL} -- draft`);
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

test("bấm Chạy liên tục chỉ tạo một adapter (parser worker đếm riêng)", async ({ page }) => {
  // Ô soạn tự mở worker parser, nên đếm adapter bằng số lần tải pglite.wasm (mỗi adapter tải đúng một lần).
  const pglite: string[] = [];
  page.on("request", (r) => /pglite.*.wasm/.test(r.url()) && pglite.push(r.url()));
  await page.goto("/en");
  await sqlBox(page).fill("SELECT 1");
  await runBtn(page, "en").dblclick();
  await expect(conclusion(page)).toBeVisible({ timeout: 60_000 });
  expect(pglite.length).toBeGreaterThan(0);
  expect(new Set(pglite).size).toBe(pglite.length);
  const adapters = pglite.filter((u) => !/initdb/.test(u));
  expect(adapters).toHaveLength(1);
});

test("SQL trống thì nút Chạy bị vô hiệu", async ({ page }) => {
  await page.goto("/vi");
  await expect(runBtn(page, "vi")).toBeDisabled();
  await sqlBox(page).fill("   ");
  await expect(runBtn(page, "vi")).toBeDisabled();
  await sqlBox(page).fill("SELECT 1");
  await expect(runBtn(page, "vi")).toBeEnabled();
});

test("0 dòng hiện câu rỗng", async ({ page }) => {
  await page.goto("/en");
  await runSql(page, "en", "SELECT 1 WHERE false");
  await expect(page.getByText(T.en.empty)).toBeVisible({ timeout: 60_000 });
  await expect(sqlBox(page)).toBeVisible();
});

// Task027: các câu mẫu lấy chữ thật hiện ra trên màn hình, không đọc code.
const G = {
  vi: { role: "Câu thứ 1 bị chặn: không được đổi role hay quyền của phiên", role2: "Câu thứ 2 bị chặn", at3: "Lỗi ở câu 3.", blocked2: "Câu 2 bị chặn.", affected: /bị ảnh hưởng/ },
  en: { role: "Statement 1 was blocked: it may not change the session role or privileges", role2: "Statement 2 was blocked", at3: "Error in statement 3.", blocked2: "Statement 2 blocked.", affected: /rows? affected/ },
} as const;
for (const l of ["vi", "en"] as const) {
  test.describe(`Task027 ${l}`, () => {
    test("AC1+AC2 infinity hiện chữ infinity và -infinity, ngày hợp lệ vẫn ISO, mảng không sập", async ({ page }) => {
      await page.goto(`/${l}`);
      await runSql(
        page,
        l,
        `SELECT 'infinity'::timestamptz AS a, '-infinity'::timestamptz AS b, 'infinity'::date AS c, 'infinity'::timestamp AS d,
                ARRAY['infinity'::timestamptz, '2020-01-02 03:04:05+00'] AS e, '2020-01-02 03:04:05+00'::timestamptz AS f`,
      );
      const cells = page.locator("tbody:visible td");
      await expect(cells).toHaveCount(6, { timeout: 60_000 });
      const text = (await cells.allTextContents()).map((x) => x.trim());
      console.log(`Task027 ${l} INFINITY_CELLS`, JSON.stringify(text));
      expect(text).toEqual(["infinity", "-infinity", "infinity", "infinity", '["infinity","2020-01-02T03:04:05.000Z"]', "2020-01-02T03:04:05.000Z"]);
      await expect(page.getByText("Invalid date")).toHaveCount(0);
      await expect(conclusion(page)).toContainText(T[l].real);
    });

    test("AC3 INSERT 2 dòng rồi SELECT trong cùng lần chạy: kết quả SELECT không hiện số dòng bị ảnh hưởng", async ({ page }) => {
      await page.goto(`/${l}`);
      await runSql(page, l, "CREATE TABLE t(id int); INSERT INTO t VALUES (1),(2); SELECT * FROM t;");
      await expect(page.locator("tbody:visible tr")).toHaveCount(2, { timeout: 60_000 });
      await expect(page.getByText(G[l].affected).filter({ visible: true })).toHaveCount(0);
      await page.getByRole("button", { name: l === "vi" ? "Câu 2" : "Statement 2", exact: true }).click(); // câu INSERT
      await expect(page.getByText(l === "vi" ? "2 dòng bị ảnh hưởng" : "2 rows affected").filter({ visible: true })).toHaveCount(1);
    });

    test("AC4 lỗi ở câu 3: nhật ký ghi số câu, không chứa nội dung SQL", async ({ page }) => {
      await page.goto(`/${l}`);
      await runSql(page, l, "SELECT 1;\nSELECT 2;\nSELECT * FROM bang_khong_co_xyz;");
      // Task033: query chỉ có SELECT mở màn hình xác nhận schema; bỏ qua để thấy lỗi thật của PostgreSQL.
      await page.getByRole("button", { name: l === "vi" ? "Bỏ qua, chỉ chạy query" : "Skip, run the query only" }).click();
      await expect(page.locator('[data-testid="error"]:visible')).toContainText(/bang_khong_co_xyz/, { timeout: 60_000 });
      const log = page.locator("#terminal ol:visible");
      await expect(log).toContainText(G[l].at3);
      expect(await log.innerText()).not.toMatch(/SELECT|bang_khong_co/);
    });

    test("AC5 SET ROLE postgres hiện câu chặn đúng ngôn ngữ, kèm số câu", async ({ page }) => {
      await page.goto(`/${l}`);
      await runSql(page, l, "SET ROLE postgres");
      const err = page.locator('[data-testid="error"]:visible');
      await expect(err).toContainText(G[l].role, { timeout: 60_000 });
      console.log(`Task027 ${l} GUARD_TEXT`, JSON.stringify(await err.innerText()));
      await runSql(page, l, "SELECT 1;\nSET ROLE postgres");
      await expect(err).toContainText(G[l].role2);
      await expect(page.locator("#terminal ol:visible")).toContainText(G[l].blocked2);
    });
  });
}

test("terminal đang tắt thì bấm Chạy mở lại để thấy kết quả", async ({ page }) => {
  await page.goto("/en");
  await sqlBox(page).waitFor();
  await page.getByRole("button", { name: /Terminal/ }).filter({ visible: true }).click();
  await expect(page.locator("#terminal")).toHaveCount(0);
  await runSql(page, "en", "SELECT 1");
  await expect(page.locator("tbody:visible tr")).toHaveCount(1, { timeout: 60_000 });
});

// ---- Task032: ô soạn CodeMirror, báo lỗi khi soạn, danh sách câu ----
const S = {
  vi: { empty: "Dán SQL để bắt đầu", sample: "Nạp câu mẫu", replace: "Thay bằng câu mẫu", keep: "Giữ SQL của tôi", parserDown: "Không bật được trình kiểm tra cú pháp", list: "3 câu đã tách" },
  en: { empty: "Paste SQL to get started", sample: "Load sample", replace: "Replace with sample", keep: "Keep my SQL", parserDown: "The syntax checker could not start", list: "3 statements found" },
} as const;
const open = async (p: Page, l: string) => {
  await p.goto(`/${l}`);
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor();
  if (await tab.isVisible()) await tab.click();
};

for (const l of ["vi", "en"] as const) {
  test.describe(`Task032 ${l}`, () => {
    test("AC1+AC2 SELEC 1: tô lỗi khi soạn, sửa thì hết, Chạy vẫn bấm được và engine báo lỗi thật", async ({ page }) => {
      await open(page, l);
      await sqlBox(page).fill("SELEC 1");
      await expect(mark(page)).toHaveText("S");
      await expect(page.locator("p[role=alert]:visible")).toContainText(/syntax error/i);
      await expect(runBtn(page, l)).toBeEnabled();
      await runBtn(page, l).click();
      await expect(page.locator('[data-testid="error"]:visible')).toContainText(/syntax error/i, { timeout: 60_000 });
      await sqlBox(page).fill("SELECT 1");
      await expect(mark(page)).toHaveCount(0);
      await expect(page.locator("p[role=alert]:visible")).toHaveCount(0);
    });

    test("AC3 dán 3 câu: danh sách 3 dòng có loại câu, dòng chọn có đường lamp", async ({ page }) => {
      await open(page, l);
      await sqlBox(page).fill("CREATE TABLE t(id int); INSERT INTO t VALUES (1); SELECT * FROM t;");
      const items = page.locator('ol[aria-label="' + S[l].list + '"]:visible li');
      await expect(items).toHaveCount(3);
      await expect(items.nth(0)).toContainText(l === "vi" ? "Tạo bảng" : "Create table");
      await expect(items.nth(2)).toContainText(l === "vi" ? "Truy vấn" : "Select");
      await expect(items.nth(0).locator("button")).toHaveAttribute("aria-current", "true");
      await items.nth(2).locator("button").click();
      await expect(items.nth(2).locator("button")).toHaveAttribute("aria-current", "true");
      await expect(items.nth(0).locator("button")).not.toHaveAttribute("aria-current", "true");
      const bar = await items.nth(2).locator("button").evaluate((e) => [getComputedStyle(e).borderLeftWidth, getComputedStyle(e).borderLeftColor]);
      expect(bar[0]).toBe("2px");
      expect(bar[1]).not.toBe("rgba(0, 0, 0, 0)");
    });

    test("AC4 lỗi engine ở câu thứ 3 sau emoji: tô đúng chữ, không lệch", async ({ page }) => {
      await open(page, l);
      await sqlBox(page).fill("SELECT '😀';\nSELECT 2;\nSELECT * FROM nope_table;");
      await runBtn(page, l).click();
      // Task033: query chỉ có SELECT mở màn hình xác nhận schema; bỏ qua để thấy lỗi thật của PostgreSQL.
      await page.getByRole("button", { name: l === "vi" ? "Bỏ qua, chỉ chạy query" : "Skip, run the query only" }).click();
      await expect(page.locator('[data-testid="error"]:visible')).toContainText(/nope_table/, { timeout: 60_000 });
      await expect(mark(page)).toHaveText("n");
      await expect(page.locator(".cm-line:visible", { has: mark(page) })).toContainText("SELECT * FROM nope_table;");
      await sqlBox(page).press("End");
      await sqlBox(page).pressSequentially(" ");
      await expect(mark(page)).toHaveCount(0); // sửa nội dung thì dấu lỗi của lần chạy cũ biến mất
    });

    test("AC5 parser không tải được: vẫn chạy, có một dòng báo rõ, không có dấu lỗi", async ({ page }) => {
      await page.route(/libpg-query.*\.wasm/, (r) => r.abort());
      await open(page, l);
      await sqlBox(page).fill("SELECT 41 + 1 AS answer");
      await expect(page.getByText(S[l].parserDown)).toBeVisible();
      await expect(mark(page)).toHaveCount(0);
      await runBtn(page, l).click();
      await expect(conclusion(page)).toContainText(T[l].real, { timeout: 60_000 });
      await expect(page.locator("tbody:visible td")).toHaveText("42");
    });

    test("AC6 vùng rỗng có câu mẫu; nạp mẫu khi đã có chữ phải hỏi, Giữ thì không mất SQL; đổi engine giữ SQL", async ({ page }) => {
      await open(page, l);
      await expect(page.getByText(S[l].empty)).toBeVisible();
      await page.getByRole("button", { name: S[l].sample }).click();
      await expect.poll(() => sqlText(page)).toContain("CREATE TABLE users");
      await expect(page.getByText(S[l].empty)).toHaveCount(0);
      await sqlBox(page).fill("SELECT 7 AS mine");
      await page.getByRole("button", { name: S[l].sample }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await expect.poll(() => sqlText(page)).toBe("SELECT 7 AS mine");
      await page.getByRole("button", { name: S[l].keep }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect.poll(() => sqlText(page)).toBe("SELECT 7 AS mine");
      await page.getByRole("tab", { name: T[l].mysqlTab }).click();
      await expect.poll(() => sqlText(page)).toBe("SELECT 7 AS mine");
      await page.getByRole("tab", { name: "PostgreSQL" }).click();
      await page.getByRole("button", { name: S[l].sample }).click();
      await page.getByRole("button", { name: S[l].replace }).click();
      await expect.poll(() => sqlText(page)).toContain("CREATE TABLE users");
    });

    test("ảnh chụp ô soạn có lỗi và danh sách câu, 1440 px và 390 px, không tràn ngang", async ({ page }) => {
      for (const w of [1440, 390]) {
        await page.setViewportSize({ width: w, height: 900 });
        await open(page, l);
        await sqlBox(page).fill("CREATE TABLE t(id int);\nINSERT INTO t VALUES (1);\nSELEC * FROM t;");
        await expect(mark(page)).toBeVisible();
        const doc = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        expect(doc[0]).toBeLessThanOrEqual(doc[1]);
        await page.screenshot({ path: `${SHOTS}/anh-soan-${l}-${w}.png` });
        await sqlBox(page).fill("CREATE TABLE t(id int);\nINSERT INTO t VALUES (1);\nSELECT * FROM t;");
        await expect(page.locator("ol[aria-label]:visible li")).toHaveCount(3);
        await page.screenshot({ path: `${SHOTS}/anh-danhsach-${l}-${w}.png` });
      }
    });

    test("ca biên: nội dung SQL không xuất hiện trong console", async ({ page }) => {
      const logs: string[] = [];
      page.on("console", (m) => logs.push(m.text()));
      await open(page, l);
      await sqlBox(page).fill("SELECT 'secret_marker_xyz' AS a");
      await runBtn(page, l).click();
      await expect(conclusion(page)).toBeVisible({ timeout: 60_000 });
      expect(logs.join("\n")).not.toContain("secret_marker_xyz");
      expect(await page.locator('ol[aria-label="' + (l === "vi" ? "Nhật ký chạy" : "Run log") + '"]:visible').innerText()).not.toContain("secret_marker_xyz");
    });
  });
}
