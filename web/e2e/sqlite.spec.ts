import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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

/** Tạo file .sqlite thật bằng chính WASM (bản Node) để test không phải chứa file nhị phân trong repo. */
async function writeFixture(file: string, sql?: string) {
  const { default: init } = await import("@sqlite.org/sqlite-wasm");
  const s = await init();
  const { capi, wasm } = s;
  const db = new s.oo1.DB(":memory:", "c");
  db.exec(sql ?? "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO customers VALUES (1,'An'),(2,'Bình');");
  const dbPtr = db.pointer;
  if (dbPtr === undefined) throw new Error("fixture: DB đã đóng");
  const scope = wasm.scopedAllocPush();
  try {
    const pSize = wasm.scopedAlloc(4);
    const p = capi.sqlite3_serialize(dbPtr, "main", pSize, 0);
    const size = Number(wasm.peekPtr(pSize));
    writeFileSync(file, wasm.heap8u().slice(p, p + size));
    capi.sqlite3_free(p);
  } finally {
    wasm.scopedAllocPop(scope);
    db.close();
  }
}

test("Task134 + Task135: nhập file .sqlite thật, chạy SELECT, xuất rồi nhập lại", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (r.method() !== "GET" && u.pathname.startsWith("/api") && u.pathname !== "/api/me") posts.push(u.pathname);
  });
  const dir = path.join(process.cwd(), "test-results");
  mkdirSync(dir, { recursive: true });
  const fixture = path.join(dir, "customers.sqlite");
  await writeFixture(fixture);

  await openSqlite(page);
  const status = page.locator('[data-testid="sqlite-file-status"]:visible');
  const confirm = page.getByTestId("sqlite-import-confirm");

  // AC1: nạp file, liệt kê đúng bảng. Sandbox đang có SQL thì phải hỏi trước (AC5).
  await page.setInputFiles('[data-testid="sqlite-file-input"]', fixture);
  await expect(status.or(confirm).first()).toBeVisible({ timeout: 30_000 });
  if (await confirm.isVisible()) await confirm.click();
  await expect(status).toContainText(/Imported customers\.sqlite: 1 table/, { timeout: 60_000 });

  // AC2: SELECT trên bảng của file trả đúng dữ liệu thật của file.
  await runSql(page, "SELECT id, name FROM customers ORDER BY id");
  await expect(page.locator("tbody:visible tr")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.locator("tbody:visible")).toContainText("Bình");

  // AC1 (Task135): xuất ra file đúng định dạng SQLite.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sqlite-export").click()]);
  expect(dl.suggestedFilename()).toMatch(/\.sqlite$/);
  const exported = path.join(dir, "exported.sqlite");
  await dl.saveAs(exported);
  expect(readFileSync(exported).subarray(0, 16).toString("latin1")).toBe("SQLite format 3\u0000");

  // AC2 (Task135): file xuất ra nhập lại được, vẫn còn đúng bảng và đúng dòng.
  await page.setInputFiles('[data-testid="sqlite-file-input"]', exported);
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await confirm.click();
  await expect(status).toContainText(/Imported exported\.sqlite: 1 table/, { timeout: 60_000 });
  await runSql(page, "SELECT count(*) AS n FROM customers");
  await expect(page.locator("tbody:visible tr")).toHaveText(/2/, { timeout: 60_000 });

  // AC4: file không rời máy, không có request upload nào.
  expect(posts).toEqual([]);
});

test("Task134 AC5: file 40MB được đọc trong worker, giao diện vẫn báo trạng thái và không đóng băng", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = path.join(process.cwd(), "test-results");
  mkdirSync(dir, { recursive: true });
  const big = path.join(dir, "big.sqlite");
  await writeFixture(
    big,
    "CREATE TABLE big (x BLOB); WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i < 40000) INSERT INTO big SELECT randomblob(1000) FROM c;",
  );

  await openSqlite(page);
  const status = page.locator('[data-testid="sqlite-file-status"]:visible');
  const confirm = page.getByTestId("sqlite-import-confirm");
  await page.setInputFiles('[data-testid="sqlite-file-input"]', big);
  await expect(status.or(confirm).first()).toBeVisible({ timeout: 30_000 });
  if (await confirm.isVisible()) await confirm.click();
  // 40.000 dòng × 1KB: file ~39MB. Trạng thái "Importing big.sqlite…" đã hiện trong lúc đọc file.
  await expect(status).toContainText(/Imported big\.sqlite: 1 table, 39\.\d MB/, { timeout: 60_000 });

  // Trong lúc nạp, tab vẫn bấm được: hỏi thẳng engine đang chọn qua aria-selected.
  await expect(page.getByRole("tab", { name: "SQLite", exact: true })).toHaveAttribute("aria-selected", "true");
  await runSql(page, "SELECT count(*) AS n FROM big");
  await expect(page.locator("tbody:visible tr")).toHaveText(/40000/, { timeout: 60_000 });
});

test("Task134/135 AC6: nút Nhập và Xuất dùng được ở 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSqlite(page);
  // Trên điện thoại cột SQL có thể đang bị ẩn sau tab, mở nó ra trước.
  await page.getByRole("tab", { name: "SQL", exact: true }).click();
  await expect(page.getByTestId("sqlite-import")).toBeVisible();
  await expect(page.getByTestId("sqlite-import")).toBeEnabled();
  await expect(page.getByTestId("sqlite-export")).toBeVisible();
  await expect(page.getByTestId("sqlite-export")).toBeEnabled();
  // Nút không bị bóp khỏi màn hình: mép phải vẫn nằm trong khung nhìn.
  const box = await page.getByTestId("sqlite-export").boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(390);
});

test("Task133 AC3: chọn SQLite rồi F5 vẫn giữ engine", async ({ page }) => {
  await openSqlite(page);
  await expect(page.getByRole("tab", { name: "SQLite", exact: true })).toHaveAttribute("aria-selected", "true");
  await reloadHydrated(page);
  await expect(page.getByRole("tab", { name: "SQLite", exact: true })).toHaveAttribute("aria-selected", "true");
  await runSql(page, "SELECT 1 AS ok");
  await expect(page.locator("tbody:visible tr")).toHaveText(/1/, { timeout: 60_000 });
});
