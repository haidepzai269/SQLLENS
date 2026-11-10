import { expect, test, type Page, type Route } from "@playwright/test";
import { gotoHydrated, throttleCpu } from "./helpers";

test.beforeEach(({ page }) => throttleCpu(page));

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

interface MockState {
  queries: { sql: string; connection?: string }[];
  lockWaits: unknown[][];
  connections: { a: number; b: number };
}

async function setupMock(page: Page) {
  const sid = "0123456789abcdef0123456789abcd";
  const state: MockState = {
    queries: [],
    lockWaits: [],
    connections: { a: 101, b: 202 },
  };

  await page.route("**/api/me", (r) =>
    json(r, 200, { id: "1", name: "Amelia", provider: "google" })
  );

  await page.route("**/api/mysql/sessions", async (r) => {
    if (r.request().method() === "POST") {
      return json(r, 201, { id: sid, expiresAt: "2030-01-01T00:00:00Z" });
    }
    return r.continue();
  });

  await page.route(`**/api/mysql/sessions/${sid}/locks`, (r) => {
    return json(r, 200, {
      waits: { columns: ["requesting_conn", "blocking_conn", "rl_type", "rl_mode", "obj", "idx"], rows: state.lockWaits },
      locks: { columns: [], rows: [] },
      connections: state.connections,
    });
  });

  await page.route(`**/api/mysql/sessions/${sid}/events`, (r) => {
    // Trả về keepalive và stream locks giả lập
    const sseBody = [
      ":keepalive\n\n",
      `event: lock_change\ndata: ${JSON.stringify({
        waits: { columns: [], rows: state.lockWaits },
        locks: { columns: [], rows: [] },
        connections: state.connections,
      })}\n\n`,
    ].join("");
    return r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
      body: sseBody,
    });
  });

  await page.route(`**/api/mysql/sessions/${sid}/query`, async (r) => {
    const postData = r.request().postDataJSON() as { sql: string; connection?: string };
    state.queries.push(postData);

    const sql = postData.sql;
    // Giả lập deadlock khi chuyển tiền ở bước 6 của kịch bản Deadlock
    if (sql.includes("+ 200 WHERE id = 1")) {
      return json(r, 422, {
        error: { code: "sql_error", messageKey: "sandbox.sqlError" },
        detail: {
          errno: 1213,
          sqlState: "40001",
          message: "Deadlock found when trying to get lock; try restarting transaction",
        },
      });
    }

    // Giả lập Gap Lock chờ khi Session B insert user_id = 15
    if (sql.includes("INSERT INTO lab_orders") && sql.includes("15")) {
      state.lockWaits = [
        [state.connections.b, state.connections.a, "RECORD", "X,GAP", "lab_orders", "idx_user_id"],
      ];
    }

    if (sql.includes("COMMIT") && postData.connection === "a") {
      state.lockWaits = [];
    }

    return json(r, 200, { results: [{ columns: ["ok"], rows: [[1]] }], truncated: false });
  });

  return state;
}

const noHScroll = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 5);

for (const l of ["vi", "en"] as const) {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test.describe(`MySQL Conflict [${l}] ${w}x${h}`, () => {
      test.use({ viewport: { width: w, height: h } });

      test("AC1, AC2, AC3, AC4: Chọn MySQL, chạy kịch bản Gap Lock, hiển thị nhãn Thật kèm Tooltip", async ({
        page,
      }) => {
        await setupMock(page);
        await gotoHydrated(page, `/${l}/e2e-conflict`);

        const panel = page.getByTestId("conflict-panel");
        await expect(panel).toBeVisible();

        // Chuyển sang Engine MySQL
        const engineSelect = page.getByTestId("cf-engine-select");
        await expect(engineSelect).toBeVisible();
        await engineSelect.selectOption("mysql");

        // AC4: Nhãn kết luận mang nhãn 'Thật' (real)
        const labelBadge = page.getByTestId("cf-label");
        await expect(labelBadge).toBeVisible();
        await expect(labelBadge).toHaveAttribute("data-label", "real");

        // Hover vào nhãn 'Thật' để kiểm tra tooltip hiển thị giải thích trung thực
        await labelBadge.hover();
        const tooltip = page.getByTestId("cf-label-tooltip");
        await expect(tooltip).toBeVisible();
        // Tooltip giải thích rõ ràng không mang hàm ý đánh giá thiết kế tốt hay xấu
        if (l === "vi") {
          await expect(tooltip).toContainText("phản ứng vật lý");
        } else {
          await expect(tooltip).toContainText("physical reaction");
        }

        // AC3: Kiểm tra 4 kịch bản MySQL có mặt trong dropdown
        const scenarioSelect = page.getByTestId("cf-mysql-scenario");
        await expect(scenarioSelect).toBeVisible();
        const opts = await scenarioSelect.locator("option").allInnerTexts();
        expect(opts.length).toBe(4);

        // Kịch bản 1: Gap Lock được chọn mặc định
        await expect(page.getByTestId("cf-mysql-about")).toBeVisible();
        await expect(page.getByTestId("cf-mysql-learn")).toBeVisible();

        // AC1 & AC2: Bấm Next bước tới từng lệnh
        const nextBtn = page.getByTestId("cf-next");
        await nextBtn.click(); // Step 1: Session A BEGIN
        await expect(page.getByTestId("cf-position")).toContainText("1");
        await expect(page.getByTestId("tick-0")).toBeVisible();

        await nextBtn.click(); // Step 2: Session B BEGIN
        await expect(page.getByTestId("cf-position")).toContainText("2");

        await nextBtn.click(); // Step 3: Session A UPDATE
        await expect(page.getByTestId("cf-position")).toContainText("3");

        await nextBtn.click(); // Step 4: Session B INSERT -> bị block chờ Gap Lock
        await expect(page.getByTestId("cf-position")).toContainText("4");

        // Cytoscape đồ thị chờ khóa được cập nhật
        const waitGraph = page.getByTestId("wait-graph");
        await expect(waitGraph).toBeVisible();

        // Kiểm tra không tràn màn hình ngang (responsive)
        expect(await noHScroll(page)).toBe(true);
      });

      test("AC3: Kịch bản Deadlock Chuyển tiền Ngân hàng bắt mã lỗi 1213 và Cytoscape đổi màu đỏ rực", async ({
        page,
      }) => {
        await setupMock(page);
        await gotoHydrated(page, `/${l}/e2e-conflict`);

        const engineSelect = page.getByTestId("cf-engine-select");
        await engineSelect.selectOption("mysql");

        // Chọn kịch bản Deadlock
        const scenarioSelect = page.getByTestId("cf-mysql-scenario");
        await scenarioSelect.selectOption("bank_transfer_deadlock");

        const nextBtn = page.getByTestId("cf-next");
        await expect(nextBtn).toBeEnabled();

        // Chạy 6 bước để gây Deadlock
        for (let i = 0; i < 6; i++) {
          await expect(nextBtn).toBeEnabled();
          await nextBtn.click();
          await expect(page.getByTestId("cf-position")).toContainText(`${i + 1}`);
        }

        // Đồ thị Cytoscape đánh dấu cycle = true (đổi màu đỏ rực)
        const waitGraph = page.getByTestId("wait-graph");
        await expect(waitGraph).toHaveAttribute("data-cycle", "true");

        // Session B bị ngắt hiển thị state aborted (viền đỏ đứt nét)
        const stateB = page.getByTestId("state-B");
        await expect(stateB).toHaveAttribute("data-state", "aborted");

        // Kết quả kết luận cảnh báo deadlock
        const outcome = page.getByTestId("cf-outcome");
        await expect(outcome).toBeVisible();
        await expect(outcome).toHaveAttribute("data-outcome", "deadlock");

        expect(await noHScroll(page)).toBe(true);
      });

      test("AC3: Kịch bản Flash Sale hỗ trợ biến thể FOR UPDATE (Khóa bi quan)", async ({
        page,
      }) => {
        await setupMock(page);
        await gotoHydrated(page, `/${l}/e2e-conflict`);

        const engineSelect = page.getByTestId("cf-engine-select");
        await engineSelect.selectOption("mysql");

        // Chọn kịch bản Flash Sale
        const scenarioSelect = page.getByTestId("cf-mysql-scenario");
        await scenarioSelect.selectOption("flash_sale_inventory");

        // Kiểm tra dropdown biến thể xuất hiện
        const variantSelect = page.getByTestId("cf-mysql-variant");
        await expect(variantSelect).toBeVisible();

        // Đổi sang biến thể FOR UPDATE
        await variantSelect.selectOption("for_update");

        // Bấm Next kiểm tra câu lệnh mang FOR UPDATE
        const nextBtn = page.getByTestId("cf-next");
        await expect(nextBtn).toBeEnabled();
        await nextBtn.click(); // Step 1: BEGIN
        await expect(page.getByTestId("cf-position")).toContainText("1");
        await expect(nextBtn).toBeEnabled();
        await nextBtn.click(); // Step 2: BEGIN
        await expect(page.getByTestId("cf-position")).toContainText("2");
        await expect(nextBtn).toBeEnabled();
        await nextBtn.click(); // Step 3: SELECT ... FOR UPDATE
        await expect(page.getByTestId("cf-position")).toContainText("3");
        await expect(page.getByTestId("tick-sql-2")).toContainText("FOR UPDATE");

        // Nút Reset hoạt động
        const resetBtn = page.getByTestId("cf-reset");
        await resetBtn.click();
        await expect(page.getByTestId("cf-position")).toContainText("0");
      });
    });
  }
}
