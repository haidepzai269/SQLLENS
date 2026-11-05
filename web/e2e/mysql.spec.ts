import { expect, test, type Page, type Route } from "@playwright/test";

// Gin và agent giả bằng page.route: không gọi máy Azure, không cần key.
const SHOTS = "../_bmad-output/SP004/STR019/Task075/anh";
const ID = "0123456789abcdef0123456789abcdef".slice(0, 30);
const ID2 = "fedcba9876543210fedcba9876543210".slice(0, 30);
const MARK = "SECRET_MARKER_9431"; // SQL của người dùng: không được xuất hiện ở URL hay console
const json = (r: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  r.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
const err = (code: string, key: string, detail?: unknown) => ({ error: { code, messageKey: key }, ...(detail ? { detail } : {}) });

const T = {
  vi: { run: "Chạy", starting: "Đang khởi động phiên MySQL", idle: /chỉ được tạo khi bạn bấm Chạy/, ready: /Phiên MySQL đã sẵn sàng/, real: "Thật", cut: /đã cắt kết quả này/, postgres: "Dùng PostgreSQL", retry: "Thử lại", fresh: "Tạo phiên trống", replay: /Dựng lại và chạy lại 1 câu/, expired: "Phiên MySQL đã hết hạn", full: "Máy chủ MySQL đang hết chỗ", notCfg: "MySQL chưa sẵn sàng", stage: "Mô phỏng", tabs: ["Sơ đồ", "Plan", "B-Tree", "Thử sửa", "Capacity", "Mentor"], est: "Ước lượng", cancel: "Hủy", noBtree: /Chưa mô phỏng được cây B-Tree của MySQL/ },
  en: { run: "Run", starting: "Starting a MySQL session", idle: /created only when you press Run/, ready: /The MySQL session is ready/, real: "Real", cut: /The server cut this result/, postgres: "Use PostgreSQL", retry: "Try again", fresh: "Start an empty session", replay: /Rebuild and re-run 1 statement/, expired: "The MySQL session has expired", full: "The MySQL server is full", notCfg: "MySQL is not ready", stage: "Simulation", tabs: ["Schema", "Plan", "B-Tree", "Try a fix", "Capacity", "Mentor"], est: "Estimated", cancel: "Cancel", noBtree: /The MySQL B-Tree cannot be simulated/ },
} as const;

type St = { posts: number; queries: string[]; deletes: string[]; gate?: Promise<void>; create: (r: Route) => Promise<void>; query: (r: Route, sql: string) => Promise<void>; next: string[] };
const PLAN = { query_block: { select_id: 1, cost_info: { query_cost: "1.00" }, table: { table_name: "users", access_type: "ALL", rows_examined_per_scan: 1000, filtered: "10.00" } } };
const SCHEMA_COLS = ["schema_name", "table_name", "column_name", "data_type", "nullable", "is_pk", "is_unique", "ref_table", "ref_column"];

async function mock(page: Page, init: Partial<St> = {}) {
  const s: St = {
    posts: 0, queries: [], deletes: [], next: [ID, ID2],
    create: (r) => json(r, 201, { id: s.next.shift() ?? ID, expiresAt: "2030-01-01T00:00:00Z" }),
    query: (r, sql) => {
      if (sql.startsWith("EXPLAIN FORMAT=JSON")) return json(r, 200, { results: [{ columns: ["EXPLAIN"], rows: [[JSON.stringify(PLAN)]] }], truncated: false });
      if (sql.includes("information_schema.COLUMNS"))
        return json(r, 200, { results: [{ columns: SCHEMA_COLS, rows: [["app", "users", "id", "int", 0, 1, 0, null, null], ["app", "users", "email", "varchar(100)", 1, 0, 0, null, null]] }], truncated: false });
      return json(r, 200, { results: [{ columns: ["n"], rows: [[1]] }], truncated: false });
    },
    ...init,
  };
  await page.route("**/api/me", (r) => json(r, 200, { id: "1", name: "An", provider: "google" }));
  await page.route("**/api/mysql/sessions", async (r) => {
    s.posts++;
    await s.gate;
    return s.create(r);
  });
  await page.route(/\/api\/mysql\/sessions\/[0-9a-f]{30}(\/query)?$/, async (r) => {
    const u = r.request().url();
    if (r.request().method() === "DELETE") {
      s.deletes.push(u.split("/").pop()!);
      return r.fulfill({ status: 204 });
    }
    const sql = (r.request().postDataJSON() as { sql: string }).sql;
    s.queries.push(sql);
    return s.query(r, sql);
  });
  return s;
}

const sqlBox = (p: Page) => p.locator(".cm-content:visible").first();
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function type(p: Page, sql: string) {
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor();
  if (await tab.isVisible()) await tab.click();
  await sqlBox(p).fill(sql);
}
const runBtn = (p: Page, l: "vi" | "en") => p.getByRole("button", { name: T[l].run, exact: true }).first();
async function run(p: Page, l: "vi" | "en", sql: string) {
  await type(p, sql);
  await runBtn(p, l).click();
}
// Điện thoại: kết quả nằm ở tab Terminal, run() đã chuyển sang đó.
// Câu nội bộ của ứng dụng (đọc schema, EXPLAIN của cột Rủi ro) không tính vào câu của người dùng.
const mine = (s: St) => s.queries.filter((q) => !q.startsWith("EXPLAIN") && !q.includes("information_schema"));
const failure = (p: Page) => p.getByTestId("mysql-failure").filter({ visible: true });

for (const l of ["vi", "en"] as const) {
  const t = T[l];
  test.describe(`ngôn ngữ ${l}`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, timezoneId: "UTC" });

    test("AC1 AC4 mở trang không tạo phiên; Chạy tạo đúng một phiên, kể cả bấm hai lần; đổi engine thì hủy", async ({ page }) => {
      let release!: () => void;
      const s = await mock(page, { gate: new Promise<void>((r) => (release = r)) });
      const urls: string[] = [];
      const logs: string[] = [];
      page.on("request", (q) => urls.push(q.url()));
      page.on("console", (m) => logs.push(m.text()));
      await page.goto(`/${l}?engine=mysql`);
      await expect(page.getByText(t.idle).filter({ visible: true })).toBeVisible();
      await page.waitForTimeout(500);
      expect(s.posts).toBe(0);
      await run(page, l, `SELECT '${MARK}' AS n`);
      await expect(page.getByText(t.starting).filter({ visible: true })).toBeVisible();
      await runBtn(page, l).click({ force: true }).catch(() => {}); // lần hai khi đang tạo: nút đã tắt
      await page.screenshot({ path: `${SHOTS}/1440-${l}-khoidong.png` });
      release();
      await expect(page.getByTestId("mysql-ready")).toBeVisible();
      await expect(page.locator("tbody:visible tr")).toHaveCount(1);
      await expect(page.getByTestId("conclusion")).toContainText(t.real);
      await expect(page.getByTestId("conclusion")).not.toContainText("PostgreSQL"); // kết luận của MySQL không được nói là của PostgreSQL
      await expect(page.locator("body")).not.toContainText(/PostgreSQL (vừa|loaded)|Đã tải PostgreSQL/);
      expect(s.posts).toBe(1);
      expect(mine(s)).toEqual([`SELECT '${MARK}' AS n`]);
      await expect(page.getByTestId("mysql-ready")).toContainText(t.ready);
      await page.screenshot({ path: `${SHOTS}/1440-${l}-sansang.png` });
      // đổi engine: phiên bị hủy
      await page.getByRole("tab", { name: "PostgreSQL" }).click();
      await expect.poll(() => s.deletes).toEqual([ID]);
      // không có SQL trong URL hay console
      expect(urls.filter((u) => u.includes(MARK))).toEqual([]);
      expect(logs.filter((x) => x.includes(MARK))).toEqual([]);
      expect(page.url()).not.toContain(MARK);
    });

    test("AC4 tải lại giữa phiên: hủy phiên cũ trước khi tạo phiên mới, không tự khóa", async ({ page }) => {
      const s = await mock(page);
      await page.goto(`/${l}?engine=mysql`);
      await run(page, l, "SELECT 1");
      await expect(page.getByTestId("mysql-ready")).toBeVisible();
      await page.reload();
      await run(page, l, "SELECT 2");
      await expect(page.getByTestId("mysql-ready")).toBeVisible();
      expect(s.posts).toBe(2);
      expect(s.deletes[0]).toBe(ID); // phiên cũ bị hủy
    });

    test("AC2 mỗi lỗi một màn hình riêng", async ({ page }) => {
      const cases: [number, string, string, string, Record<string, string>?][] = [
        [429, "sandbox_full", "sandbox.full", "full"],
        [429, "user_session_limit", "sandbox.userSessionLimit", "userLimit"],
        [429, "quota_exceeded", "error.quotaExceeded", "quota", { "X-Quota-Reset": "2030-01-02T03:04:05Z" }],
        [429, "rate_limited", "error.rateLimited", "rate"],
        [502, "sandbox_unreachable", "sandbox.unreachable", "unreachable"],
        [504, "sandbox_timeout", "sandbox.timeout", "timeout"],
        [503, "not_configured", "error.notConfigured", "notConfigured"],
        [503, "quota_unavailable", "error.quotaUnavailable", "unavailable"],
      ];
      for (const [status, code, key, kind, h] of cases) {
        const s = await mock(page, { create: (r) => json(r, status, err(code, key), h) });
        await page.goto(`/${l}?engine=mysql`);
        await run(page, l, "SELECT 1");
        await expect(failure(page)).toHaveAttribute("data-kind", kind);
        if (kind === "quota") await expect(failure(page)).toContainText(/2030|30/);
        if (kind === "notConfigured") await expect(failure(page).getByRole("button", { name: t.postgres })).toBeVisible();
        if (kind === "full") await page.screenshot({ path: `${SHOTS}/1440-${l}-hetcho.png` });
        if (kind === "notConfigured") await page.screenshot({ path: `${SHOTS}/1440-${l}-chuacauhinh.png` });
        expect(s.posts).toBe(1);
        await page.unrouteAll({ behavior: "ignoreErrors" });
      }
      // lỗi ở câu lệnh
      for (const [status, code, key, kind] of [
        [429, "mysql_time_exhausted", "error.mysqlTimeExhausted", "timeBudget"],
        [422, "result_too_large", "sandbox.resultTooLarge", "tooLarge"],
        [422, "query_timeout", "sandbox.queryTimeout", "queryTimeout"],
        [502, "connection_lost", "sandbox.connectionLost", "unreachable"],
      ] as const) {
        await mock(page, { query: (r) => json(r, status, err(code, key)) });
        await page.goto(`/${l}?engine=mysql`);
        await run(page, l, "SELECT 1");
        await expect(failure(page)).toHaveAttribute("data-kind", kind);
        await page.unrouteAll({ behavior: "ignoreErrors" });
      }
    });

    test("lỗi SQL của MySQL hiện thông báo của MySQL, không phải màn hình hạ tầng", async ({ page }) => {
      await mock(page, { query: (r) => json(r, 422, err("sql_error", "sandbox.sqlError", { errno: 1146, sqlState: "42S02", message: "Table 'app.nope' doesn't exist" })) });
      await page.goto(`/${l}?engine=mysql`);
      await run(page, l, "SELECT * FROM nope");
      await expect(page.getByTestId("error").filter({ visible: true })).toContainText("Table 'app.nope' doesn't exist");
      await expect(failure(page)).toHaveCount(0);
    });

    test("AC3 phiên hết hạn giữa chừng: báo mất dữ liệu, không tự chạy lại câu ghi, tạo phiên trống khi bấm", async ({ page }) => {
      let expire = false;
      const s = await mock(page, {
        query: async (r) => (expire ? json(r, 404, err("session_not_found", "sandbox.sessionNotFound")) : json(r, 200, { results: [{ columns: [], rows: [], affectedRows: 1 }], truncated: false })),
      });
      await page.goto(`/${l}?engine=mysql`);
      await run(page, l, "INSERT INTO t VALUES (1)");
      await expect(page.getByTestId("mysql-ready")).toBeVisible();
      await expect.poll(() => s.queries.some((q) => q.includes("information_schema"))).toBe(true); // vùng stage đọc xong trước khi phiên hết hạn
      expire = true;
      await runBtn(page, l).click();
      await expect(failure(page)).toContainText(t.expired);
      await expect(failure(page).getByRole("button", { name: t.replay })).toBeVisible();
      await page.waitForTimeout(600);
      expect(mine(s)).toEqual(["INSERT INTO t VALUES (1)", "INSERT INTO t VALUES (1)"]); // chỉ hai lần bấm của người dùng, không tự chạy lại
      expect(s.posts).toBe(1); // chưa tự tạo phiên mới
      await page.screenshot({ path: `${SHOTS}/1440-${l}-hethan.png` });
      expire = false;
      await failure(page).getByRole("button", { name: t.fresh }).click();
      await expect(failure(page)).toHaveCount(0);
      await runBtn(page, l).click();
      await expect(page.getByTestId("mysql-ready")).toBeVisible();
      expect(s.posts).toBe(2);
      expect(mine(s).length).toBe(3);
    });

    test("AC3 dựng lại chỉ chạy lại khi người dùng đồng ý", async ({ page }) => {
      let expire = false;
      const s = await mock(page, {
        query: async (r) => (expire ? json(r, 404, err("session_not_found", "sandbox.sessionNotFound")) : json(r, 200, { results: [{ columns: [], rows: [], affectedRows: 1 }], truncated: false })),
      });
      await page.goto(`/${l}?engine=mysql`);
      await run(page, l, "INSERT INTO t VALUES (1)");
      await expect(page.getByTestId("mysql-ready")).toBeVisible();
      await expect.poll(() => s.queries.some((q) => q.includes("information_schema"))).toBe(true); // vùng stage đọc xong trước khi phiên hết hạn
      expire = true;
      await runBtn(page, l).click();
      await expect(failure(page)).toBeVisible();
      expire = false;
      const before = mine(s).length;
      await failure(page).getByRole("button", { name: t.replay }).click();
      await expect.poll(() => mine(s).length).toBe(before + 1); // đúng một câu đã chạy trước đó
      expect(mine(s).at(-1)).toBe("INSERT INTO t VALUES (1)");
      await expect(failure(page)).toHaveCount(0);
    });

    test("kết quả bị cắt ở 10.000 dòng được ghi rõ; lô nhiều câu hiện từng kết quả", async ({ page }) => {
      await mock(page, {
        query: (r) => json(r, 200, { results: [{ columns: ["a"], rows: [[1]] }, { columns: ["n"], rows: Array.from({ length: 3 }, (_, i) => [i]) }], truncated: true }),
      });
      await page.goto(`/${l}?engine=mysql`);
      await run(page, l, "SELECT 1; SELECT n FROM big");
      await expect(page.getByText(t.cut).filter({ visible: true })).toBeVisible();
      await expect(page.locator("button[aria-expanded]").filter({ hasText: /^(Câu|Statement) / }).filter({ visible: true })).toHaveCount(2);
    });

    test("AC5 vùng stage: Sơ đồ từ information_schema, Plan nhãn Ước lượng, bốn tab còn lại chưa mô phỏng", async ({ page }) => {
      const s = await mock(page);
      await page.goto(`/${l}?engine=mysql`);
      await run(page, l, "SELECT * FROM users");
      const stage = page.locator("#stage");
      await expect(stage.locator(".react-flow__node").filter({ hasText: "users" })).toContainText("email", { timeout: 30_000 });
      expect(s.queries.some((q) => q.includes("information_schema.COLUMNS"))).toBe(true);
      await stage.getByRole("tab", { name: t.tabs[1], exact: true }).click();
      await expect(stage.getByTestId("plan-tree")).toBeVisible({ timeout: 30_000 });
      await expect(stage.getByTestId("plan-label")).toHaveAttribute("data-label", "estimated");
      expect(s.queries.some((q) => q.startsWith("EXPLAIN FORMAT=JSON SELECT * FROM users"))).toBe(true);
      await page.screenshot({ path: `${SHOTS}/1440-${l}-plan.png` });
      for (const i of [2, 3, 4, 5]) {
        await stage.getByRole("tab", { name: t.tabs[i], exact: true }).click();
        await expect(stage.locator('[role="tabpanel"]:not([hidden])').getByTestId("stage-not-simulated")).toBeVisible();
      }
      await stage.getByRole("tab", { name: t.tabs[2], exact: true }).click();
      await expect(stage.getByTestId("stage-not-simulated").filter({ visible: true })).toContainText(t.noBtree);
      await page.screenshot({ path: `${SHOTS}/1440-${l}-btree-chuamophong.png` });
      await expect(page.locator("body")).not.toContainText(/thiết kế (này )?(đã )?ổn|design is (fine|ok|good)/i);
    });

    test("ca biên: đổi engine khi đang tạo phiên thì phiên vừa tạo xong bị hủy", async ({ page }) => {
      let release!: () => void;
      const s = await mock(page, { gate: new Promise<void>((r) => (release = r)) });
      await page.goto(`/${l}?engine=mysql`);
      await run(page, l, "SELECT 1");
      await expect.poll(() => s.posts).toBe(1);
      await page.getByRole("tab", { name: "PostgreSQL" }).click();
      await expect(page).toHaveURL(/engine=postgres/);
      await page.waitForTimeout(300); // effect dọn của React chạy sau khi URL đổi
      release();
      await expect.poll(() => s.deletes).toEqual([ID]);
      expect(mine(s)).toEqual([]);
    });

    test("chưa đăng nhập: nút Chạy tắt, nói cần đăng nhập, không gọi Gin", async ({ page }) => {
      const s = await mock(page);
      await page.unroute("**/api/me");
      await page.route("**/api/me", (r) => json(r, 401, err("auth_required", "error.authRequired")));
      await page.goto(`/${l}?engine=mysql`);
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(runBtn(page, l)).toBeDisabled();
      expect(s.posts).toBe(0);
    });
  });

  test.describe(`ngôn ngữ ${l} 390 px`, () => {
    test.use({ viewport: { width: 390, height: 800 }, timezoneId: "UTC" });

    test("ảnh 390 px: sẵn sàng và lỗi hết chỗ, không tràn ngang", async ({ page }) => {
      const s = await mock(page);
      await page.goto(`/${l}?engine=mysql`);
      await run(page, l, "SELECT 1");
      await expect(page.getByTestId("mysql-ready")).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/390-${l}-sansang.png` });
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mock(page, { create: (r) => json(r, 429, err("sandbox_full", "sandbox.full")) });
      await page.goto(`/${l}?engine=mysql`);
      await run(page, l, "SELECT 1");
      await expect(failure(page)).toContainText(t.full);
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/390-${l}-hetcho.png` });
      expect(s.posts).toBe(1);
    });
  });
}
