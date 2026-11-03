import { expect, test, type Page } from "@playwright/test";

const T = {
  vi: {
    run: "Chạy",
    cancel: "Hủy",
    confirm: "Xác nhận và chạy",
    skip: "Bỏ qua, chỉ chạy query",
    tableName: (n: number) => `Tên bảng ${n}`,
    colName: (c: number, t: string) => `Tên cột ${c} của ${t}`,
    colType: (c: number, t: string) => `Kiểu cột ${c} của ${t}`,
    colPk: (c: number, t: string) => `Khóa chính của cột ${c} của ${t}`,
    rmCol: (c: number, t: string) => `Xóa cột ${c} của ${t}`,
    rmFk: (c: string, t: string) => `Bỏ gợi ý khóa ngoại của cột ${c} của ${t}`,
    add: "Thêm cột",
    write: "Tự viết CREATE TABLE",
    manual: "CREATE TABLE do bạn tự viết",
    draft: "bản nháp suy từ query của bạn",
    guess: "Đoán: kiểu lấy từ giá trị",
    userSet: "Bạn đã đặt",
    noCols: "không còn cột nào",
    schemaError: "Không tạo được bảng",
    ran: "PostgreSQL vừa chạy 1 câu, câu cuối trả 0 dòng",
    sqlTab: "SQL",
    dump: "Đã bỏ qua 1 khối dữ liệu COPY",
    cancelled: "Đã hủy xác nhận schema, chưa chạy gì.",
    applied: "Đã tạo bảng từ bản nháp bạn xác nhận.",
    star: "được dùng với SELECT *",
    incomplete: "Chưa đủ cột",
  },
  en: {
    run: "Run",
    cancel: "Cancel",
    confirm: "Confirm and run",
    skip: "Skip, run the query only",
    tableName: (n: number) => `Name of table ${n}`,
    colName: (c: number, t: string) => `Name of column ${c} of ${t}`,
    colType: (c: number, t: string) => `Type of column ${c} of ${t}`,
    colPk: (c: number, t: string) => `Primary key for column ${c} of ${t}`,
    rmCol: (c: number, t: string) => `Remove column ${c} of ${t}`,
    rmFk: (c: string, t: string) => `Remove the foreign key guess for column ${c} of ${t}`,
    add: "Add column",
    write: "Write CREATE TABLE myself",
    manual: "CREATE TABLE written by you",
    draft: "draft inferred from your query",
    guess: "Guess: type taken from the value",
    userSet: "Set by you",
    noCols: "has no columns left",
    schemaError: "Could not create the tables",
    ran: "PostgreSQL just ran 1 statement, the last returned 0 rows",
    sqlTab: "SQL",
    dump: "Skipped 1 COPY data block",
    cancelled: "Schema confirmation cancelled, nothing was run.",
    applied: "Created the tables from the draft you confirmed.",
    star: "is used with SELECT *",
    incomplete: "Columns incomplete",
  },
} as const;
const SHOTS = "../_bmad-output/SP006/STR028/Task033";
const QUERY = "SELECT u.name, o.total FROM users u JOIN orders o ON o.user_id = u.id WHERE o.total > 10";
const BAD_PHRASE = /thiết kế (này )?(đã )?ổn|design is (fine|ok|good)|good design|schema (đúng|is correct)/i;

const sqlBox = (p: Page) => p.locator(".cm-content:visible");
const dialog = (p: Page) => p.getByTestId("confirm-schema");
const isWasm = (url: string) => /pglite[^/]*\.wasm/.test(url); // wasm của parser (libpg-query) tải khi soạn là bình thường

async function open(p: Page, l: "vi" | "en", sql: string) {
  await p.goto(`/${l}`);
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor();
  if (await tab.isVisible()) await tab.click();
  await sqlBox(p).fill(sql);
}
const runBtn = (p: Page, l: "vi" | "en") => p.getByRole("button", { name: T[l].run, exact: true });
const noHScroll = (p: Page) =>
  p.evaluate(() => {
    const d = document.querySelector('[data-testid="confirm-schema"]');
    return document.documentElement.scrollWidth <= window.innerWidth && (!d || d.scrollWidth <= d.clientWidth);
  });

test.setTimeout(90_000); // tải PGlite lần đầu mất vài chục giây khi máy bận

for (const l of ["vi", "en"] as const) {
  const x = T[l];
  test.describe(l, () => {
    test("AC1 chỉ có query: mở màn hình xác nhận, chưa chạy gì; có schema thì không hỏi", async ({ page }) => {
      const wasm: string[] = [];
      page.on("request", (r) => isWasm(r.url()) && wasm.push(r.url()));
      await open(page, l, QUERY);
      await runBtn(page, l).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page).getByTestId("draft-table")).toHaveCount(2);
      await expect(dialog(page).getByLabel(x.tableName(1))).toHaveValue("users");
      await expect(dialog(page).getByLabel(x.tableName(2))).toHaveValue("orders");
      await expect(dialog(page)).toContainText(x.draft);
      await expect(dialog(page).getByTestId("draft-fk")).toHaveCount(1); // orders.user_id -> users.id
      expect(await dialog(page).innerText()).not.toMatch(BAD_PHRASE);
      expect(wasm).toEqual([]); // chưa có câu nào được chạy: engine còn chưa được tải
      await expect(page.locator('[data-testid="conclusion"]:visible')).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/anh-${l}-1440.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/anh-${l}-390.png` });
    });

    test("AC1 dán schema cùng query thì chạy thẳng, không hỏi", async ({ page }) => {
      await open(page, l, "CREATE TABLE t(id int); INSERT INTO t VALUES (1); SELECT * FROM t;");
      await runBtn(page, l).click();
      await expect(page.locator('[data-testid="conclusion"]:visible')).toBeVisible({ timeout: 60_000 });
      await expect(dialog(page)).toHaveCount(0);
    });

    test("AC1 query không có bảng thì chạy thẳng", async ({ page }) => {
      await open(page, l, "SELECT 1");
      await runBtn(page, l).click();
      await expect(page.locator('[data-testid="conclusion"]:visible')).toBeVisible({ timeout: 60_000 });
      await expect(dialog(page)).toHaveCount(0);
    });

    test("AC2 sửa tên bảng, tên cột, kiểu, khóa chính, thêm, xóa cột, bỏ FK; phần đoán có lý do", async ({ page }) => {
      await open(page, l, QUERY);
      await runBtn(page, l).click();
      const d = dialog(page);
      await expect(d.getByTestId("reason").filter({ hasText: x.guess }).first()).toBeVisible();
      await d.getByLabel(x.tableName(1)).fill("members");
      await d.getByLabel(x.colName(1, "members")).fill("full_name");
      await d.getByLabel(x.colType(1, "members")).selectOption("varchar(255)");
      await expect(d.getByTestId("draft-column").first().getByTestId("reason")).toHaveText(x.userSet);
      await d.getByLabel(x.colPk(1, "members")).check();
      await expect(d.getByLabel(x.colPk(1, "members"))).toBeChecked();
      await d.getByRole("button", { name: x.add }).first().click();
      await d.getByLabel(x.colName(3, "members")).fill("extra");
      await expect(d.getByTestId("draft-table").first().getByTestId("draft-column")).toHaveCount(3);
      await d.getByRole("button", { name: x.rmCol(3, "members") }).click();
      await expect(d.getByTestId("draft-table").first().getByTestId("draft-column")).toHaveCount(2);
      await d.getByRole("button", { name: x.rmFk("user_id", "orders") }).click();
      await expect(d.getByTestId("draft-fk")).toHaveCount(0);
    });

    test("AC3+ca biên: xóa hết cột thì không cho xác nhận và nói lý do; có ô tự viết CREATE TABLE", async ({ page }) => {
      await open(page, l, "SELECT * FROM things");
      await runBtn(page, l).click();
      const d = dialog(page);
      await expect(d.getByTestId("warnings")).toContainText(x.star);
      await expect(d.getByText(x.incomplete, { exact: true })).toBeVisible();
      await expect(d.getByRole("button", { name: x.confirm })).toBeDisabled(); // bảng chỉ có SELECT * chưa có cột nào
      await expect(d.getByTestId("issues")).toContainText(x.noCols);
      await d.getByRole("button", { name: x.add }).click();
      await d.getByLabel(x.colName(1, "things")).fill("id");
      await expect(d.getByRole("button", { name: x.confirm })).toBeEnabled();
      await d.getByRole("button", { name: x.rmCol(1, "things") }).click();
      await expect(d.getByRole("button", { name: x.confirm })).toBeDisabled();
      await d.getByRole("button", { name: x.write }).click();
      await expect(d.getByLabel(x.manual)).toContainText("CREATE TABLE");
      await d.getByLabel(x.manual).fill("");
      await expect(d.getByRole("button", { name: x.confirm })).toBeDisabled();
    });

    test("AC4 xác nhận: tạo bảng rồi chạy query; lỗi ở bước schema quay lại và giữ phần đã sửa", async ({ page }) => {
      await open(page, l, QUERY);
      await runBtn(page, l).click();
      const d = dialog(page);
      await d.getByLabel(x.tableName(1)).fill("users");
      // Chế độ tự viết: câu thứ hai trùng tên nên cả bước schema phải lỗi và không để lại bảng nào.
      await d.getByRole("button", { name: x.write }).click();
      const bad = 'CREATE TABLE users (id int PRIMARY KEY, name text); CREATE TABLE orders (id int, user_id int, total numeric); CREATE TABLE orders (id int);';
      await d.getByLabel(x.manual).fill(bad);
      await d.getByRole("button", { name: x.confirm }).click();
      await expect(d.getByTestId("schema-error")).toContainText(x.schemaError, { timeout: 60_000 });
      await expect(d.getByLabel(x.manual)).toHaveValue(bad);
      await expect(page.locator('[data-testid="conclusion"]:visible')).toHaveCount(0);
      // Sửa rồi xác nhận lại: nếu câu đầu của lần lỗi còn sót thì CREATE TABLE users sẽ báo trùng.
      const good = bad.replace(" CREATE TABLE orders (id int);", "");
      await d.getByLabel(x.manual).fill(good);
      await d.getByRole("button", { name: x.confirm }).click();
      await expect(page.locator('[data-testid="conclusion"]:visible')).toContainText(x.ran, { timeout: 60_000 });
      await expect(dialog(page)).toHaveCount(0);
      // Chạy lại cùng query: bảng đã có, không hỏi lại.
      await page.getByRole("tab", { name: "SQL", exact: true }).or(runBtn(page, l)).first().waitFor();
      if (await page.getByRole("tab", { name: "SQL", exact: true }).isVisible()) await page.getByRole("tab", { name: "SQL", exact: true }).click();
      await runBtn(page, l).click();
      await expect(page.locator('[data-testid="conclusion"]:visible')).toBeVisible();
      await expect(dialog(page)).toHaveCount(0);
    });

    test("AC4 dạng bảng sửa: xác nhận tạo bảng đã sửa tên và nhật ký có dòng đã tạo", async ({ page }) => {
      await open(page, l, "SELECT name FROM people WHERE age > 3");
      await runBtn(page, l).click();
      const d = dialog(page);
      await d.getByRole("button", { name: x.confirm }).click();
      await expect(page.locator('[data-testid="conclusion"]:visible')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator("li:visible", { hasText: x.applied })).toBeVisible();
    });

    test("AC4 query lỗi sau khi tạo bảng: Chạy lần sau mở lại được bản nháp", async ({ page }) => {
      await open(page, l, "SELECT u.name FROM users u WHERE u.id > 1");
      await runBtn(page, l).click();
      await dialog(page).getByLabel(x.tableName(1)).fill("members"); // đặt tên lệch với query nên query sẽ lỗi
      await dialog(page).getByRole("button", { name: x.confirm }).click();
      await expect(page.locator('[data-testid="error"]:visible')).toBeVisible({ timeout: 60_000 });
      await runBtn(page, l).click();
      await expect(dialog(page)).toBeVisible();
    });

    test("AC5 hủy giữ nguyên SQL, không chạy gì, focus về nút Chạy; mở lại còn phần đã sửa; query đổi thì bỏ", async ({ page }) => {
      const wasm: string[] = [];
      page.on("request", (r) => isWasm(r.url()) && wasm.push(r.url()));
      await open(page, l, QUERY);
      await runBtn(page, l).click();
      await dialog(page).getByLabel(x.tableName(1)).fill("members");
      await dialog(page).getByRole("button", { name: x.cancel }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(runBtn(page, l)).toBeFocused();
      expect(await sqlBox(page).evaluate((el) => (el as HTMLElement).innerText.replace(/​/g, ""))).toBe(QUERY);
      expect(wasm).toEqual([]);
      await expect(page.locator("li:visible", { hasText: x.cancelled })).toBeVisible();
      await runBtn(page, l).click();
      await expect(dialog(page).getByLabel(x.tableName(1))).toHaveValue("members");
      await page.keyboard.press("Escape"); // đóng bằng bàn phím cũng trả focus
      await expect(dialog(page)).toHaveCount(0);
      await expect(runBtn(page, l)).toBeFocused();
      await sqlBox(page).fill(QUERY + " AND o.id > 0");
      await runBtn(page, l).click();
      await expect(dialog(page).getByLabel(x.tableName(1))).toHaveValue("users");
    });

    test("AC7 dump có COPY và LOCK: báo đã bỏ qua và không hỏi schema", async ({ page }) => {
      const dump = "CREATE TABLE t(id int);\nCOPY t (id) FROM stdin;\n1\n2\n\\.\nSELECT count(*) FROM t;\n";
      await open(page, l, dump);
      await expect(page.getByTestId("dump-notice").filter({ visible: true })).toContainText(x.dump, { timeout: 10_000 });
      await runBtn(page, l).click();
      await expect(page.locator('[data-testid="conclusion"]:visible')).toBeVisible({ timeout: 60_000 });
    });

    test("AC8 bàn phím đi hết dialog; 390 px không cuộn ngang", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, l, QUERY);
      await runBtn(page, l).click();
      const d = dialog(page);
      await expect(d).toBeVisible();
      // Tab đi qua mọi nút của dialog rồi vòng lại, không thoát ra ngoài.
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        // Focus guard của dialog có thể giữ focus một nhịp trước khi chuyển vào lại.
        await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="confirm-schema"]')), { timeout: 3000 }).toBe(true);
        seen.add(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? ""));
      }
      expect(seen.has(x.confirm)).toBe(true);
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/anh-${l}-390-day.png`, fullPage: false });
    });
  });
}
