import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated, reloadHydrated } from "./helpers";

// Đứng ở trạng thái đã đăng nhập để không bị giới hạn lượt chạy của khách.
const AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'/%3E";
const USER = { id: "1", name: "An", avatarUrl: AVATAR, provider: "google", role: "user" };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }));
});

// Vùng #sql là cột soạn thảo của workspace; Stage có editor riêng nên phải khoanh vùng.
const editor = (p: Page) => p.locator("#sql .cm-content:visible");
const editorText = async (p: Page) => ((await editor(p).innerText()) ?? "").replace(/​/g, "").trim();

// Tên tab tính cả aria-label của nút đóng bên trong, nên lọc theo chữ thay vì so khớp tuyệt đối.
const tab = (p: Page, name: string) => p.getByRole("tab").filter({ hasText: name }).first();
// Nút engine (PostgreSQL/MySQL) cũng là role=tab, nên đếm tab của workspace theo testid riêng.
const workspaceTabs = (p: Page) => p.locator('[data-testid^="workspace-tab-"]');
const addTab = (p: Page) => p.getByTestId("tab-add-btn");
const runBtn = (p: Page) => p.locator("#sql").getByRole("button", { name: "Chạy", exact: true });
const conclusion = (p: Page) => p.locator('[data-testid="conclusion"]:visible');
const notice = (p: Page) => p.getByTestId("schema-changed-notice");

async function typeSql(p: Page, sql: string) {
  await editor(p).click();
  await p.keyboard.press("ControlOrMeta+a");
  await p.keyboard.type(sql);
}

async function runSql(p: Page, sql: string) {
  await typeSql(p, sql);
  await runBtn(p).click();
  await expect(conclusion(p)).toBeVisible({ timeout: 60_000 });
}

test.describe("Workspace tabs (Task126)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1+AC2: 5 tab dùng chung một editor và một sandbox, DDL ở tab này dùng được ở tab kia", async ({ page }) => {
    // Mỗi adapter PGlite tải pglite.wasm đúng một lần: đếm số lần tải là biết sandbox có bị dựng lại không.
    const pglite: string[] = [];
    page.on("request", (req) => {
      if (/pglite.*\.wasm/.test(req.url())) pglite.push(req.url());
    });

    await gotoHydrated(page, "/vi");
    await expect(editor(page)).toBeVisible();

    await runSql(page, "SELECT 1 AS one;");
    const sandboxes = pglite.length;
    expect(sandboxes).toBeGreaterThan(0);

    // 1 tab ban đầu + 4 tab mới = 5 tab.
    for (let i = 0; i < 4; i++) await addTab(page).click();
    await expect(workspaceTabs(page)).toHaveCount(5);

    // Chuyển qua lại giữa các tab: chỉ một editor, không dựng lại sandbox.
    await tab(page, "Query 3.sql").click();
    await tab(page, "Query 1").click();
    await tab(page, "Query 5.sql").click();

    expect(await page.locator("#sql .cm-editor").count()).toBe(1);
    expect(pglite.length).toBe(sandboxes);

    // Tab 1 tạo bảng, tab khác đọc lại bảng đó: sandbox của cả workspace vẫn nguyên.
    await tab(page, "Query 1").click();
    await runSql(page, "CREATE TABLE tab_one (id int);");
    await addTab(page).click();
    await runSql(page, "SELECT * FROM tab_one;");
  });

  test("AC3: DDL ở tab khác hiện thông báo, nút Xem tab đưa về đúng tab nguồn", async ({ page }) => {
    await gotoHydrated(page, "/vi");
    await expect(editor(page)).toBeVisible();

    await runSql(page, "CREATE TABLE notice_t (id int);");

    // Sang tab mới (khác tab nguồn): thông báo xuất hiện, nêu đúng tên tab nguồn.
    await addTab(page).click();
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toContainText("Schema đã cập nhật từ Query 1");
    // DDL vừa chạy thật nên thông báo mang nhãn kết luận "Thật".
    await expect(notice(page)).toContainText("Thật");

    // Nút "Xem tab" đưa về đúng tab nguồn; đứng ngay tab nguồn thì thông báo không còn nghĩa.
    await notice(page).getByRole("button", { name: "Xem tab" }).click();
    await expect(tab(page, "Query 1")).toHaveAttribute("aria-selected", "true");
    await expect(notice(page)).toBeHidden();
  });

  test("AC3 (390px): thông báo đọc được trên điện thoại, không tràn ngang", async ({ page }) => {
    await gotoHydrated(page, "/vi");
    await expect(editor(page)).toBeVisible();

    await runSql(page, "CREATE TABLE mobile_t (id int);");
    await addTab(page).click();
    await expect(notice(page)).toBeVisible();

    // Thu về 390px: cột SQL chuyển thành một tab của khung làm việc.
    await page.setViewportSize({ width: 390, height: 844 });
    const sqlZoneTab = page.getByRole("tab", { name: "SQL", exact: true });
    await sqlZoneTab.or(editor(page)).first().waitFor();
    if (await sqlZoneTab.isVisible()) await sqlZoneTab.click();

    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toContainText("Schema đã cập nhật");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("Ca biên: DDL lỗi thì không phát thông báo schema đổi", async ({ page }) => {
    await gotoHydrated(page, "/vi");
    await expect(editor(page)).toBeVisible();

    await typeSql(page, "CREATE TABLE broken (;");
    await runBtn(page).click();
    await expect(page.locator('[role="alert"]:visible').first()).toBeVisible({ timeout: 60_000 });

    await addTab(page).click();
    await expect(notice(page)).toBeHidden();
  });

  test("AC4+AC5: undo riêng từng tab, nội dung tab không active vẫn còn sau F5", async ({ page }) => {
    await gotoHydrated(page, "/vi");
    await expect(editor(page)).toBeVisible();

    await typeSql(page, "SELECT 'mot';");
    await addTab(page).click();
    await typeSql(page, "SELECT 'hai';");

    // Undo ở tab 2 tuyệt đối không được kéo nội dung của tab 1 sang.
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+z");
    expect(await editorText(page)).not.toContain("mot");

    await typeSql(page, "SELECT 'hai';");
    await page.waitForTimeout(500); // chờ autosave debounce 300ms

    await reloadHydrated(page);
    await expect(editor(page)).toBeVisible();

    // Sau F5: đúng 2 tab, mở lại đúng tab đang dùng, mỗi tab giữ nội dung của mình.
    await expect(workspaceTabs(page)).toHaveCount(2);
    await expect(tab(page, "Query 1")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => editorText(page)).toBe("SELECT 'mot';");

    await tab(page, "Query 2.sql").click();
    await expect.poll(() => editorText(page)).toBe("SELECT 'hai';");
  });
});
