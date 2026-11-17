import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated, reloadHydrated } from "./helpers";

// Chạy trên bản build, Chrome thật: xác nhận worker SQLite + asset sqlite3.wasm chạy được dưới Turbopack,
// rào chắn chặn trước khi có câu nào chạy, và tab không làm được thì nói thật là không làm được.

const T = {
  en: {
    run: "Run",
    real: "Real",
    notSimulated: "not simulated",
    blocked: /ATTACH and DETACH are not allowed/,
    plan: /EXPLAIN \(ANALYZE, BUFFERS\)/,
    btree: /pageinspect/,
  },
} as const;

test.beforeEach(({ page }) => page.route("**/api/me", (r) => r.fulfill({ status: 503, body: "{}" })));

const sqlBox = (p: Page) => p.locator(".cm-content:visible").first();
const runBtn = (p: Page) => p.getByRole("button", { name: T.en.run, exact: true }).first();

async function openSqlite(p: Page) {
  await gotoHydrated(p, "/en");
  await p.getByRole("tab", { name: "SQLite", exact: true }).click();
  await expect(p).toHaveURL(/engine=sqlite/);
}

async function runSql(p: Page, sql: string) {
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor();
  if (await tab.isVisible()) await tab.click();
  await sqlBox(p).fill(sql);
  await runBtn(p).click();
}

test("Task133 AC1+AC2: SQL hợp lệ chạy thật trong trình duyệt, lệnh mở đường ra ngoài bị chặn cả chuỗi", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (r.method() !== "GET" && u.pathname.startsWith("/api") && u.pathname !== "/api/me") posts.push(u.pathname);
  });

  await openSqlite(page);
  await runSql(page, "CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT); INSERT INTO t VALUES (1,'a'),(2,'b'); SELECT * FROM t");
  await expect(page.locator('[data-testid="conclusion"]:visible')).toContainText(T.en.real, { timeout: 60_000 });
  await expect(page.locator("tbody:visible tr")).toHaveCount(2);

  // Cả chuỗi bị chặn: bảng g trong câu đầu không được tạo.
  await runSql(page, "CREATE TABLE g (id INTEGER);\n/* chen */ ATTACH DATABASE 'x.db' AS x;");
  await expect(page.locator('[data-testid="error"]:visible')).toContainText(T.en.blocked, { timeout: 30_000 });
  await runSql(page, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'g'");
  await expect(page.locator("tbody:visible tr")).toHaveText(/0/, { timeout: 30_000 });

  // SQL của người dùng không rời máy.
  expect(posts).toEqual([]);
});

test("Task133 AC4: Plan và B-Tree của SQLite nói chưa mô phỏng được, không vẽ số liệu giả", async ({ page }) => {
  await openSqlite(page);
  await runSql(page, "CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT); CREATE INDEX t_s ON t (s); SELECT * FROM t WHERE s = 'a'");
  await expect(page.locator('[data-testid="conclusion"]:visible')).toContainText(T.en.real, { timeout: 60_000 });

  // Các tab giữ mounted, nên chỉ xét phần tử đang hiển thị.
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await expect(page.locator('[data-testid="stage-not-simulated"]:visible')).toContainText(T.en.plan);
  await expect(page.locator('[data-testid="stage-label"]:visible').first()).toHaveText(/not simulated/i);

  await page.getByRole("tab", { name: "B-Tree", exact: true }).click();
  await expect(page.locator('[data-testid="stage-not-simulated"]:visible')).toContainText(T.en.btree);
  await expect(page.locator('[data-testid="stage-btree"]')).toHaveCount(0);
});

test("Task133 AC3: chọn SQLite rồi F5 vẫn giữ engine", async ({ page }) => {
  await openSqlite(page);
  await expect(page.getByRole("tab", { name: "SQLite", exact: true })).toHaveAttribute("aria-selected", "true");
  await reloadHydrated(page);
  await expect(page.getByRole("tab", { name: "SQLite", exact: true })).toHaveAttribute("aria-selected", "true");
  await runSql(page, "SELECT 1 AS ok");
  await expect(page.locator("tbody:visible tr")).toHaveText(/1/, { timeout: 60_000 });
});
