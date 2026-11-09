import { expect, test, type Page, type Route } from "@playwright/test";

const ID = "0123456789abcdef0123456789abcdef".slice(0, 30);
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

type L = "vi" | "en";
const T = {
  vi: {
    run: "Chạy",
    stage: "Mô phỏng",
    whatifTab: "Thử sửa",
    real: "Thật",
  },
  en: {
    run: "Run",
    stage: "Simulation",
    whatifTab: "Try a fix",
    real: "Real",
  },
} as const;

const FULL_SCAN_PLAN = {
  query_block: {
    select_id: 1,
    cost_info: { query_cost: "201.50" },
    table: {
      table_name: "users",
      access_type: "ALL",
      rows_examined_per_scan: 2000,
      rows_produced_per_join: 200,
      cost_info: { read_cost: "181.50" },
    },
  },
};

const INDEX_LOOKUP_PLAN = {
  query_block: {
    select_id: 1,
    cost_info: { query_cost: "1.00" },
    table: {
      table_name: "users",
      access_type: "ref",
      key: "idx_users_email",
      rows_examined_per_scan: 1,
      rows_produced_per_join: 1,
      cost_info: { read_cost: "0.00" },
    },
  },
};

const SCHEMA_COLS = ["schema_name", "table_name", "column_name", "data_type", "nullable", "is_pk", "is_unique", "ref_table", "ref_column"];

type MockState = {
  queries: string[];
};

function setupMysqlWhatifMock(page: Page, failDdl = false) {
  const state: MockState = { queries: [] };

  page.route("**/api/me", (r) => json(r, 200, { id: "1", name: "Amelia", provider: "google" }));

  page.route(/\/api\/mysql\/sessions(\/[0-9a-f]{30}(\/query)?)?$/, async (r) => {
    const method = r.request().method();
    if (method === "POST" && r.request().url().endsWith("/sessions")) {
      return json(r, 201, { id: ID, expiresAt: "2030-01-01T00:00:00Z" });
    }
    if (method === "DELETE") {
      return r.fulfill({ status: 204 });
    }

    const postData = r.request().postDataJSON() as { sql?: string } | null;
    const sql = postData?.sql ?? "";
    state.queries.push(sql);

    // 1. Schema queries
    if (sql.includes("information_schema.COLUMNS")) {
      return json(r, 200, {
        results: [
          {
            columns: SCHEMA_COLS,
            rows: [
              ["test", "users", "id", "int", 0, 1, 0, null, null],
              ["test", "users", "email", "varchar(100)", 0, 0, 0, null, null],
              ["test", "users", "name", "varchar(50)", 1, 0, 0, null, null],
            ],
          },
        ],
        truncated: false,
      });
    }

    if (sql.includes("information_schema.STATISTICS")) {
      return json(r, 200, {
        results: [
          {
            columns: ["index_name", "table_name", "method"],
            rows: [["PRIMARY", "users", "BTREE"]],
          },
        ],
        truncated: false,
      });
    }

    // 2. EXPLAIN queries
    if (sql.startsWith("EXPLAIN FORMAT=JSON")) {
      const isShadowQuery = sql.includes("__whatif_users");
      const plan = isShadowQuery ? INDEX_LOOKUP_PLAN : FULL_SCAN_PLAN;
      return json(r, 200, {
        results: [{ columns: ["EXPLAIN"], rows: [[JSON.stringify(plan)]] }],
        truncated: false,
      });
    }

    // 3. DDL câu change trên bảng shadow (nếu test lỗi)
    if (failDdl && sql.includes("CREATE INDEX")) {
      return json(r, 422, {
        error: { code: "sql_error", messageKey: "sandbox.sqlError" },
        detail: { errno: 1061, sqlState: "42000", message: "Duplicate key name 'idx_users_email'" },
      });
    }

    // 4. Các lệnh CREATE TABLE LIKE, INSERT LIMIT 10000, DROP TABLE IF EXISTS, SELECT thường
    return json(r, 200, {
      results: [{ columns: ["id", "email", "name"], rows: [[1, "alice@example.com", "Alice"]] }],
      truncated: false,
    });
  });

  return state;
}

const sqlBox = (p: Page) => p.locator(".cm-content:visible").first();
const stage = (p: Page) => p.locator("#stage");

async function typeAndRun(p: Page, l: L, sql: string) {
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor();
  if (await tab.isVisible()) await tab.click();
  await sqlBox(p).fill(sql);
  await p.getByRole("button", { name: T[l].run, exact: true }).first().click();
}

async function openStage(p: Page, l: L) {
  const tab = p.getByRole("tab", { name: T[l].stage, exact: true });
  if (await tab.isVisible()) await tab.click();
  await expect(stage(p)).toBeVisible({ timeout: 15_000 });
}

const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const l of ["vi", "en"] as const) {
  const t = T[l];

  test.describe(`MySQL What-if (${l}) - Desktop 1440px`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, timezoneId: "UTC" });

    test("AC1 + AC2 + AC3: Thử sửa thành công qua bảng shadow, đo trước/sau nhãn Thật, dọn dẹp sạch sẽ", async ({ page }) => {
      const state = setupMysqlWhatifMock(page);

      await page.goto(`/${l}?engine=mysql`);

      // Chạy câu SELECT ban đầu
      await typeAndRun(page, l, "SELECT * FROM users WHERE email = 'alice@example.com';");

      // Mở stage và vào tab "Thử sửa"
      await openStage(page, l);
      const stageEl = stage(page);
      const whatifTab = stageEl.getByRole("tab", { name: t.whatifTab, exact: true });
      await expect(whatifTab).toBeVisible({ timeout: 15_000 });
      await whatifTab.click();

      // Kiểm tra component What-if đã sẵn sàng và probe hiển thị đúng
      const whatifEditor = stageEl.getByTestId("whatif-editor");
      await expect(whatifEditor).toBeVisible();
      await expect(stageEl.getByTestId("whatif-probe")).toContainText("SELECT * FROM users WHERE email = 'alice@example.com'");

      // Nhập câu lệnh DDL thử nghiệm
      const whatifCm = whatifEditor.locator(".cm-content");
      await whatifCm.click();
      await whatifCm.fill("CREATE INDEX idx_users_email ON users(email);");

      // Bấm Chạy trong tab What-if
      await stageEl.getByTestId("whatif-run").click();

      // Kiểm tra kết quả đối chiếu
      await expect(stageEl.getByTestId("whatif-result")).toBeVisible({ timeout: 15_000 });
      await expect(stageEl.getByTestId("whatif-column")).toHaveCount(2);

      // Nhãn kết luận phải là Thật (real)
      const planLabel = stageEl.getByTestId("plan-label").first();
      await expect(planLabel).toContainText(t.real);
      await expect(planLabel).toHaveAttribute("data-label", "real");

      // Delta phải là fewer (giảm chi phí / số trang)
      await expect(stageEl.getByTestId("whatif-delta")).toHaveAttribute("data-change", "fewer");

      // Không bao giờ nói "thiết kế này ổn" (Nguyên tắc 2)
      await expect(page.locator("body")).not.toContainText(/thiết kế (này )?(đã )?ổn|design is (fine|ok|good)/i);

      // Kiểm tra chuỗi câu lệnh gửi lên máy chủ MySQL theo AC1, AC3, AC4:
      // 1. Đo trước bằng EXPLAIN FORMAT=JSON trên bảng gốc
      expect(state.queries.some((q) => q.startsWith("EXPLAIN FORMAT=JSON SELECT * FROM users"))).toBe(true);
      // 2. DROP TABLE IF EXISTS __whatif_users
      expect(state.queries.some((q) => q.includes("DROP TABLE IF EXISTS `__whatif_users`"))).toBe(true);
      // 3. CREATE TABLE __whatif_users LIKE users
      expect(state.queries.some((q) => q.includes("CREATE TABLE `__whatif_users` LIKE `users`"))).toBe(true);
      // 4. INSERT INTO __whatif_users SELECT * FROM users LIMIT 10000
      expect(state.queries.some((q) => q.includes("INSERT INTO `__whatif_users` SELECT * FROM `users` LIMIT 10000"))).toBe(true);
      // 5. Áp dụng câu lệnh DDL trên bảng shadow
      expect(state.queries.some((q) => q.includes("CREATE INDEX idx_users_email ON `__whatif_users` (email)"))).toBe(true);
      // 6. Đo sau bằng EXPLAIN FORMAT=JSON trên bảng shadow
      expect(state.queries.some((q) => q.startsWith("EXPLAIN FORMAT=JSON SELECT * FROM `__whatif_users`"))).toBe(true);
      // 7. Luôn dọn dẹp sạch sẽ bằng DROP TABLE IF EXISTS trong finally (câu lệnh cuối cùng)
      expect(state.queries[state.queries.length - 1]).toBe("DROP TABLE IF EXISTS `__whatif_users`");
    });

    test("AC3: Khi DDL lỗi, vẫn đảm bảo dọn dẹp DROP TABLE trong finally và hiện lỗi cho người dùng", async ({ page }) => {
      const state = setupMysqlWhatifMock(page, true);

      await page.goto(`/${l}?engine=mysql`);

      // Chạy câu SELECT ban đầu
      await typeAndRun(page, l, "SELECT * FROM users WHERE email = 'alice@example.com';");

      // Mở stage và vào tab "Thử sửa"
      await openStage(page, l);
      const stageEl = stage(page);
      await stageEl.getByRole("tab", { name: t.whatifTab, exact: true }).click();

      // Nhập câu DDL thử nghiệm bị lỗi trùng tên index
      const whatifCm = stageEl.getByTestId("whatif-editor").locator(".cm-content");
      await whatifCm.click();
      await whatifCm.fill("CREATE INDEX idx_users_email ON users(email);");
      await stageEl.getByTestId("whatif-run").click();

      // Kiểm tra lỗi hiển thị trong view lỗi SQL
      await expect(stageEl.getByTestId("whatif-error")).toBeVisible({ timeout: 15_000 });
      await expect(stageEl.getByTestId("whatif-error")).toContainText("Duplicate key name 'idx_users_email'");

      // Dù lỗi, bảng shadow vẫn được dọn dẹp trong finally
      expect(state.queries[state.queries.length - 1]).toBe("DROP TABLE IF EXISTS `__whatif_users`");
    });
  });

  test.describe(`MySQL What-if (${l}) - Mobile 390px`, () => {
    test.use({ viewport: { width: 390, height: 844 }, timezoneId: "UTC" });

    test("giao diện What-if trên mobile 390px hiển thị chuẩn, không tràn ngang", async ({ page }) => {
      setupMysqlWhatifMock(page);

      await page.goto(`/${l}?engine=mysql`);

      // Chạy câu SELECT ban đầu trên mobile
      await typeAndRun(page, l, "SELECT * FROM users WHERE email = 'alice@example.com';");

      // Chuyển sang tab Mô phỏng (Stage) trên mobile
      await openStage(page, l);
      const stageEl = stage(page);
      const whatifTab = stageEl.getByRole("tab", { name: t.whatifTab, exact: true });
      await expect(whatifTab).toBeVisible({ timeout: 15_000 });
      await whatifTab.click();

      const whatifCm = stageEl.getByTestId("whatif-editor").locator(".cm-content");
      await whatifCm.click();
      await whatifCm.fill("CREATE INDEX idx_users_email ON users(email);");
      await stageEl.getByTestId("whatif-run").click();

      await expect(stageEl.getByTestId("whatif-result")).toBeVisible({ timeout: 15_000 });
      expect(await noHScroll(page)).toBe(true);
    });
  });
}
