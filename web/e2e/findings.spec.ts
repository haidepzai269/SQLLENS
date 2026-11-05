import { expect, test, type Page } from "@playwright/test";

const SHOTS = "../_bmad-output/SP009/STR042/Task069/anh";
type L = "vi" | "en";
const T = {
  vi: { run: "Chạy", stage: "Mô phỏng", risks: "Rủi ro", schema: "Sơ đồ", plan: "Plan", openPlan: "Mở nút trong Plan", showSql: "Xem trong SQL", empty: "Không có luật nào khớp trong các câu đã chạy", scope: "Các luật đã kiểm", unrelated: "không lọc theo cột email", notSim: /Chưa mô phỏng được/, stale: "thuộc lần chạy trước" },
  en: { run: "Run", stage: "Simulation", risks: "Risks", schema: "Schema", plan: "Plan", openPlan: "Open node in Plan", showSql: "Show in SQL", empty: "No rule matched in the statements that ran", scope: "Rules checked", unrelated: "does not filter on column email", notSim: /Not simulated yet/, stale: "belong to the previous run" },
} as const;
// Không câu nào trên cột Rủi ro được hàm ý thiết kế ổn (nguyên tắc 2).
const BAD = /thiết kế (này )?(đã )?ổn|\b(tốt|an toàn|ổn)\b|\b(good|safe|fine|ok|okay)\b|no problem/i;

// Ba màu cùng lúc: lỗi ở UPDATE (chưa mô phỏng), id = '5' đọc qua index khóa chính (xanh), LIKE '%77' quét toàn bảng (đỏ), ba luật schema (vàng).
const MAIN = [
  "CREATE TABLE users(id int PRIMARY KEY, email text);",
  "CREATE TABLE orders(id int, user_id int REFERENCES users(id), price float);",
  "CREATE INDEX users_email_idx ON users(email);",
  "INSERT INTO users SELECT g, 'u' || g FROM generate_series(1, 3000) g;",
  "UPDATE users SET email = email WHERE email LIKE '%9';",
  "SELECT * FROM users WHERE id = '5';",
  "SELECT * FROM users WHERE email LIKE '%77'",
].join("\n");
const USERS = "CREATE TABLE users(id int PRIMARY KEY, email text); CREATE INDEX users_email_idx ON users(email); INSERT INTO users SELECT g, 'u' || g FROM generate_series(1, 3000) g; ";

test.beforeEach(({ page }) => page.route("**/api/me", (r) => r.fulfill({ status: 503, body: "{}" })));

const sqlBox = (p: Page) => p.locator(".cm-content:visible").first();
const stage = (p: Page) => p.locator("#stage");
async function run(p: Page, l: L, sql: string) {
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor();
  if (await tab.isVisible()) await tab.click();
  await sqlBox(p).fill(sql);
  await p.getByRole("button", { name: T[l].run, exact: true }).first().click();
}
const items = (p: Page, sev?: string) => p.locator(sev ? `[data-testid=finding][data-severity=${sev}]` : "[data-testid=finding]");
const hit = (p: Page) => p.locator(".cm-sql-hit:visible");
const hitText = async (p: Page) => (await hit(p).allInnerTexts()).join("");
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function ready(p: Page, n: number) {
  await expect(items(p)).toHaveCount(n, { timeout: 120_000 });
  await expect(p.getByTestId("findings-loading")).toHaveCount(0);
}

for (const l of ["vi", "en"] as const) {
  test.describe(`${l} 1440`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("AC1 AC4 AC6: ba màu, nhãn, bằng chứng; bấm mục tô SQL, nổi bảng, mở nút Plan; sửa SQL thì báo lần chạy trước", async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto(`/${l}`);
      await run(page, l, MAIN);
      await ready(page, 6);
      await expect(page.getByTestId("conclusion")).toBeVisible(); // kết luận chạy SQL hiện có vẫn giữ
      await expect(items(page, "broken")).toHaveCount(1);
      await expect(items(page, "not_broken")).toHaveCount(1);
      await expect(items(page, "unverified")).toHaveCount(3);
      await expect(items(page, "not_simulated")).toHaveCount(1);
      await expect(items(page, "not_simulated")).toContainText(T[l].notSim);
      // mỗi kết luận có nhãn và bằng chứng; màu đi kèm chữ mức độ
      for (const sev of ["broken", "not_broken", "unverified"]) {
        const first = items(page, sev).first();
        await expect(first.getByTestId("finding-label")).toBeVisible();
        await expect(first.getByTestId("finding-severity")).not.toBeEmpty();
        await expect(first.getByTestId("finding-evidence").first()).toBeVisible();
      }
      await expect(items(page, "broken").getByTestId("finding-evidence").nth(1)).toContainText(/\d+/); // số dòng, số trang
      expect(await page.getByTestId("findings").innerText()).not.toMatch(BAD);
      await page.screenshot({ path: `${SHOTS}/1440-${l}-risks.png` });

      // bấm đỏ: tô đúng câu trong SQL, mở sơ đồ và làm nổi thẻ bảng
      await items(page, "broken").locator("button[aria-pressed]").click();
      await expect(hit(page)).toHaveCount(1);
      await expect(hit(page).locator("xpath=ancestor::div[contains(concat(' ',@class,' '),' cm-line ')]")).toContainText("%77"); // đúng biểu thức trong đúng câu
      await expect(stage(page).getByRole("tab", { name: T[l].schema, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(stage(page).locator(".react-flow__node.selected")).toContainText("users", { timeout: 30_000 });
      const first = await hitText(page);
      // bấm mục khác: bỏ tô cũ
      await items(page, "not_broken").locator("button[aria-pressed]").click();
      await expect(hit(page)).toHaveCount(1);
      expect(await hitText(page)).not.toBe(first);
      await items(page, "unverified").first().locator("button[aria-pressed]").click();
      await expect(hit(page)).toHaveCount(1);
      expect(await hitText(page)).toMatch(/CREATE TABLE/i);
      await page.screenshot({ path: `${SHOTS}/1440-${l}-highlight.png` });

      // nút mở đúng nút trong tab Plan
      await items(page, "broken").getByRole("button", { name: T[l].openPlan }).click();
      await expect(stage(page).getByRole("tab", { name: T[l].plan, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("plan-detail")).toBeVisible({ timeout: 30_000 });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("plan-detail")).toHaveCount(0);

      // sửa SQL sau khi chạy: không tô lệch, báo kết quả thuộc lần chạy trước
      await sqlBox(page).click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type("  ");
      await expect(page.getByTestId("findings-stale")).toContainText(T[l].stale);
      await expect(hit(page)).toHaveCount(0);
      await items(page, "broken").locator("button[aria-pressed]").click();
      await expect(hit(page)).toHaveCount(0);
      // chạy lại với SQL khác: danh sách thay mới (không còn 6 mục cũ), không còn báo lần chạy trước
      await run(page, l, "SELECT * FROM users WHERE email LIKE '%77'");
      // SQL mới không có CREATE INDEX nên luật không biết index nào: danh sách rỗng, không còn mục cũ
      await expect(page.getByTestId("findings-empty")).toBeVisible({ timeout: 120_000 });
      await expect(items(page)).toHaveCount(0);
      await expect(page.getByTestId("findings-stale")).toHaveCount(0);
    });

    test("AC2: LIKE '%77' AND id = 5 đọc qua index khóa chính thì vàng, không xanh", async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto(`/${l}`);
      await run(page, l, USERS + "SELECT * FROM users WHERE email LIKE '%77' AND id = 5");
      await ready(page, 1);
      await expect(items(page, "unverified")).toHaveCount(1);
      await expect(items(page, "not_broken")).toHaveCount(0);
      await expect(items(page, "unverified").getByTestId("finding-label")).toBeVisible();
      await expect(items(page, "unverified")).toContainText(T[l].unrelated);
    });

    test("AC3: danh sách rỗng chỉ nói không có luật khớp, kèm phạm vi, không hàm ý thiết kế ổn", async ({ page }) => {
      await page.goto(`/${l}`);
      await run(page, l, "CREATE TABLE a(id int PRIMARY KEY); SELECT * FROM a");
      const empty = page.getByTestId("findings-empty");
      await expect(empty).toBeVisible({ timeout: 120_000 });
      await expect(empty).toContainText(T[l].empty);
      await expect(empty).toContainText(T[l].scope);
      await expect(items(page)).toHaveCount(0);
      expect(await page.getByTestId("findings").innerText()).not.toMatch(BAD);
      await page.screenshot({ path: `${SHOTS}/1440-${l}-empty.png` });
    });

    test("ca biên: không có SELECT, SQL lỗi giữa chừng, 50 rủi ro", async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto(`/${l}`);
      await run(page, l, "CREATE TABLE b(x int)");
      await ready(page, 1);
      await expect(page.getByRole("button", { name: T[l].openPlan })).toHaveCount(0);
      await run(page, l, "CREATE TABLE c(x int); SELEC 1");
      await expect(page.getByTestId("error")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("findings")).toHaveCount(0);
      await run(page, l, Array.from({ length: 50 }, (_, i) => `CREATE TABLE t${i}(x int)`).join("; "));
      await ready(page, 50);
      expect(await noHScroll(page)).toBe(true);
    });

    test("AC6: explain của câu SELECT chạy đúng một lần cho mỗi lần chạy (dùng chung với tab Plan)", async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto(`/${l}`);
      await run(page, l, "CREATE SEQUENCE s; " + USERS + "SELECT nextval('s') AS n FROM users WHERE email LIKE '%77' LIMIT 1");
      await ready(page, 1);
      await stage(page).getByRole("tab", { name: T[l].plan, exact: true }).click();
      await expect(stage(page).getByTestId("plan-tree")).toBeVisible({ timeout: 30_000 });
      await run(page, l, "SELECT pg_sequence_last_value('s'::regclass) AS a, 'read' AS tag");
      await expect.poll(() => page.locator("tbody:visible tr").allInnerTexts().then((r) => r.join("|")), { timeout: 60_000 }).toMatch(/read$/);
      // 1 lần chạy của người dùng + 1 lần explain dùng chung; nếu luật và tab Plan mỗi nơi explain một lần thì ra 3
      expect((await page.locator("tbody:visible tr").allInnerTexts()).join("|").split("\t")[0]).toBe("2");
    });

    test("AC5: gói gửi Mentor có findings và vẫn không chứa dòng dữ liệu", async ({ page }) => {
      test.setTimeout(240_000);
      const MARK = "SECRET_MARK_7f3a9c";
      const bodies: string[] = [];
      await page.route("**/api/me", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "u1", name: "T", provider: "google" }) }));
      await page.route("**/api/ai/chat", (r) => {
        bodies.push(r.request().postData() ?? "");
        return r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `data: ${JSON.stringify({ type: "delta", text: "ok" })}\n\ndata: ${JSON.stringify({ type: "done" })}\n\n` });
      });
      await page.goto(`/${l}`);
      await run(page, l, USERS.replace("'u' || g", `'${MARK}' || g`) + "SELECT * FROM users WHERE email LIKE '%77'");
      await ready(page, 1);
      await stage(page).getByRole("tab", { name: "Mentor", exact: true }).click();
      await stage(page).getByTestId("mentor-question").fill("Why?");
      await stage(page).getByTestId("mentor-send").click();
      await expect.poll(() => bodies.length, { timeout: 60_000 }).toBe(1);
      const sent = JSON.parse(bodies[0]) as { evidence: { findings?: { ruleId: string }[] } };
      expect(sent.evidence.findings?.map((f) => f.ruleId)).toContain("leading-wildcard");
      expect(bodies[0]).not.toContain(MARK);
    });
  });

  test.describe(`${l} 390`, () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("Điện thoại: bấm mục chuyển sang tab tương ứng, nút Xem trong SQL đưa về ô soạn", async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto(`/${l}`);
      await run(page, l, MAIN);
      await expect(page.locator("table:visible").first()).toBeVisible({ timeout: 120_000 }); // lần chạy tự chuyển sang Terminal; chờ xong rồi mới đổi tab
      await page.getByRole("tab", { name: T[l].risks, exact: true }).click();
      await ready(page, 6);
      expect(await noHScroll(page)).toBe(true);
      expect(await page.getByTestId("findings").innerText()).not.toMatch(BAD);
      await page.screenshot({ path: `${SHOTS}/390-${l}-risks.png` });
      await items(page, "broken").locator("button[aria-pressed]").click();
      await expect(page.getByRole("tab", { name: T[l].stage, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(stage(page)).toBeVisible();
      await expect(stage(page).locator(".react-flow__node.selected")).toContainText("users", { timeout: 30_000 });
      await page.screenshot({ path: `${SHOTS}/390-${l}-schema.png` });
      await page.getByRole("tab", { name: T[l].risks, exact: true }).click();
      await items(page, "broken").getByRole("button", { name: T[l].showSql }).click();
      await expect(page.getByRole("tab", { name: "SQL", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(hit(page)).toHaveCount(1);
      await page.screenshot({ path: `${SHOTS}/390-${l}-sql.png` });
    });
  });
}
