import { expect, test, type Page, type Route } from "@playwright/test";

const ID = "0123456789abcdef0123456789abcdef".slice(0, 30);
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const T = {
  vi: {
    run: "Chạy",
    stage: "Mô phỏng",
    btreeTab: "B-Tree",
    simulated: "Mô phỏng",
    simTooltip: "Dựng từ cấu trúc dữ liệu và thống kê thật của InnoDB, không đọc trực tiếp file .ibd thô",
    drop: "Thả khóa",
    runAnim: "Chạy",
    coveringBadge: "Covering Index - Không cần tra cứu lại bảng chính",
    bookmarkBadge: "Bookmark Lookup - Tra cứu 2 lần qua Clustered Index",
    secIndexName: "idx_users_email",
    primaryIndexName: "PRIMARY",
  },
  en: {
    run: "Run",
    stage: "Simulation",
    btreeTab: "B-Tree",
    simulated: "Simulated",
    simTooltip: "Built from real InnoDB data and statistics, not raw .ibd files",
    drop: "Drop key",
    runAnim: "Run",
    coveringBadge: "Covering Index - No primary table lookup needed",
    bookmarkBadge: "Bookmark Lookup - Two-level lookup via Clustered Index",
    secIndexName: "idx_users_email",
    primaryIndexName: "PRIMARY",
  },
} as const;

const SCHEMA_COLS = ["schema_name", "table_name", "column_name", "data_type", "nullable", "is_pk", "is_unique", "ref_table", "ref_column"];

const SAMPLE_USERS = [
  [1, "alice@example.com", "Alice"],
  [2, "bob@example.com", "Bob"],
  [3, "charlie@example.com", "Charlie"],
  [4, "david@example.com", "David"],
  [5, "eve@example.com", "Eve"],
];

function setupMysqlBtreeMock(page: Page, isCoveringQuery = false) {
  const plan = {
    query_block: {
      select_id: 1,
      cost_info: { query_cost: "1.00" },
      table: {
        table_name: "users",
        access_type: "ref",
        key: "idx_users_email",
        using_index: isCoveringQuery,
        rows_examined_per_scan: 1,
      },
    },
  };

  return page.route(/\/api\/mysql\/sessions(\/[0-9a-f]{30}(\/query)?)?$/, async (r) => {
    const method = r.request().method();
    if (method === "POST" && r.request().url().endsWith("/sessions")) {
      return json(r, 201, { id: ID, expiresAt: "2030-01-01T00:00:00Z" });
    }
    if (method === "DELETE") {
      return r.fulfill({ status: 204 });
    }

    const postData = r.request().postDataJSON() as { sql?: string } | null;
    const sql = postData?.sql ?? "";

    if (sql.startsWith("EXPLAIN FORMAT=JSON")) {
      return json(r, 200, {
        results: [{ columns: ["EXPLAIN"], rows: [[JSON.stringify(plan)]] }],
        truncated: false,
      });
    }

    // 1. Schema columns
    if (sql.includes("information_schema.COLUMNS") && !sql.includes("WHERE TABLE_NAME =")) {
      return json(r, 200, {
        results: [
          {
            columns: SCHEMA_COLS,
            rows: [
              ["test", "users", "id", "int", 0, 1, 0, null, null],
              ["test", "users", "email", "varchar(100)", 0, 0, 1, null, null],
              ["test", "users", "name", "varchar(50)", 1, 0, 0, null, null],
            ],
          },
        ],
        truncated: false,
      });
    }

    // 2. Index list (information_schema.STATISTICS cho base tables)
    if (sql.includes("information_schema.STATISTICS") && sql.includes("GROUP BY s.TABLE_NAME")) {
      return json(r, 200, {
        results: [
          {
            columns: ["index_name", "table_name", "method"],
            rows: [
              ["PRIMARY", "users", "BTREE"],
              ["idx_users_email", "users", "BTREE"],
            ],
          },
        ],
        truncated: false,
      });
    }

    // 3. Index metadata cho btree-builder
    if (sql.includes("INDEX_NAME = 'idx_users_email'")) {
      return json(r, 200, {
        results: [
          {
            columns: ["TABLE_NAME", "INDEX_NAME", "COLUMN_NAME", "SEQ_IN_INDEX", "NON_UNIQUE", "INDEX_TYPE"],
            rows: [["users", "idx_users_email", "email", 1, 0, "BTREE"]],
          },
        ],
        truncated: false,
      });
    }

    if (sql.includes("INDEX_NAME = 'PRIMARY'")) {
      if (sql.includes("SELECT COLUMN_NAME")) {
        return json(r, 200, {
          results: [{ columns: ["COLUMN_NAME"], rows: [["id"]] }],
          truncated: false,
        });
      }
      return json(r, 200, {
        results: [
          {
            columns: ["TABLE_NAME", "INDEX_NAME", "COLUMN_NAME", "SEQ_IN_INDEX", "NON_UNIQUE", "INDEX_TYPE"],
            rows: [["users", "PRIMARY", "id", 1, 0, "BTREE"]],
          },
        ],
        truncated: false,
      });
    }

    // 4. InnoDB statistics
    if (sql.includes("mysql.innodb_index_stats")) {
      return json(r, 200, {
        results: [
          {
            columns: ["stat_name", "stat_value"],
            rows: [
              ["n_leaf_pages", 2],
              ["size", 3],
            ],
          },
        ],
        truncated: false,
      });
    }

    // 5. Data rows
    if (sql.includes("SELECT * FROM `users`")) {
      return json(r, 200, {
        results: [
          {
            columns: ["id", "email", "name"],
            rows: SAMPLE_USERS,
          },
        ],
        truncated: false,
      });
    }

    // Câu query người dùng
    return json(r, 200, {
      results: [{ columns: ["id", "email"], rows: [[1, "alice@example.com"]] }],
      truncated: false,
    });
  });
}

const sqlBox = (p: Page) => p.locator(".cm-content:visible").first();

async function runSql(p: Page, lang: "vi" | "en", sql: string) {
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor();
  if (await tab.isVisible()) await tab.click();
  await sqlBox(p).fill(sql);
  await p.getByRole("button", { name: T[lang].run, exact: true }).first().click();
}

for (const lang of ["vi", "en"] as const) {
  const t = T[lang];

  test.describe(`MySQL B-Tree [${lang}]`, () => {
    test.use({ timezoneId: "UTC" });

    test("AC1 AC2 AC3: Desktop 1440px hiển thị B-Tree MySQL nhãn Mô phỏng và hoạt ảnh Bookmark Lookup", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.route("**/api/me", (r) => json(r, 200, { id: "1", name: "An", provider: "google" }));
      await setupMysqlBtreeMock(page, false);

      await page.goto(`/${lang}?engine=mysql`);
      await runSql(page, lang, "SELECT * FROM users WHERE email = 'bob@example.com'");

      // Mở tab B-Tree trong Mô phỏng (Stage)
      const btreeTab = page.getByRole("tab", { name: t.btreeTab, exact: true });
      await btreeTab.click();

      // Kiểm tra dropdown có các index của MySQL
      const select = page.locator("#stage-index");
      await expect(select).toBeVisible();

      // Chọn Secondary Index idx_users_email
      await select.selectOption("idx_users_email");

      // AC2: Kiểm tra nhãn Mô phỏng (Simulated) và tooltip
      const label = page.getByTestId("btree-label").first();
      await expect(label).toBeVisible();
      await expect(label).toContainText(t.simulated);
      await expect(label).toHaveAttribute("title", t.simTooltip);

      // Nhập key tìm kiếm "bob@example.com"
      await page.locator("#stage-key").fill("bob@example.com");
      await page.getByTestId("stage-drop").click();

      // AC3: Kiểm tra hiển thị Bookmark Lookup badge và 2 cây (Secondary Index + Clustered Index)
      await expect(page.getByTestId("bookmark-badge")).toBeVisible();
      await expect(page.getByTestId("clustered-tree-container")).toBeVisible();

      // Kiểm tra nút điều khiển hoạt ảnh
      const runBtn = page.getByTestId("btree-drop-panel").getByRole("button", { name: t.runAnim, exact: true });
      await expect(runBtn).toBeVisible();

      // Nguyên tắc 2: Tuyệt đối không nói "thiết kế này ổn"
      await expect(page.locator("body")).not.toContainText(/thiết kế này ổn|this design is fine|this design is good/i);
    });

    test("AC4: Minh họa Covering Index hiển thị huy hiệu Covering Index và chỉ chạy 1 cây", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.route("**/api/me", (r) => json(r, 200, { id: "1", name: "An", provider: "google" }));
      await setupMysqlBtreeMock(page, true); // query covering

      await page.goto(`/${lang}?engine=mysql`);
      await runSql(page, lang, "SELECT id, email FROM users WHERE email = 'alice@example.com'");

      const btreeTab = page.getByRole("tab", { name: t.btreeTab, exact: true });
      await btreeTab.click();

      const select = page.locator("#stage-index");
      await select.selectOption("idx_users_email");

      // Nhập key tìm kiếm
      await page.locator("#stage-key").fill("alice@example.com");
      await page.getByTestId("stage-drop").click();

      // AC4: Huy hiệu Covering Index
      await expect(page.getByTestId("covering-badge")).toBeVisible();

      // Chỉ rơi trên 1 cây, không có container clustered index thứ 2
      await expect(page.getByTestId("clustered-tree-container")).not.toBeVisible();
    });

    test("Mobile 390px: giao diện co giãn hợp lý, không tràn ngang trang", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.route("**/api/me", (r) => json(r, 200, { id: "1", name: "An", provider: "google" }));
      await setupMysqlBtreeMock(page, false);

      await page.goto(`/${lang}?engine=mysql`);
      await runSql(page, lang, "SELECT * FROM users WHERE email = 'bob@example.com'");

      // Chuyển sang tab Mô phỏng
      const stageTab = page.getByRole("tab", { name: t.stage, exact: true });
      if (await stageTab.isVisible()) {
        await stageTab.click();
      }

      const btreeTab = page.getByRole("tab", { name: t.btreeTab, exact: true });
      await btreeTab.click();

      const select = page.locator("#stage-index");
      await expect(select).toBeVisible();

      // Không tràn ngang
      const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
      expect(noHScroll).toBe(true);
    });
  });
}
