import { expect, test, type Page } from "@playwright/test";

/**
 * Task167: Fork phòng cộng tác sang Local Sandbox (trần 512 KB + tối đa 5 phòng fork).
 */

async function setupApiMe(page: Page, userId: string | null) {
  await page.route("**/api/me", async (route) => {
    if (!userId) {
      await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: userId, name: "E2E User", provider: "google" }),
    });
  });
}

test.describe("Task167 — Fork sang Local Sandbox", () => {
  test("AC1 & AC5: Fork 3 tab sang IndexedDB, dự án gốc không đổi, đúng 1 request /api/me và 0 byte SQL lên mạng", async ({
    page,
  }) => {
    await setupApiMe(page, "u-fork-1");
    await page.goto("/vi/e2e-fork?userId=u-fork-1");
    await expect(page.getByTestId("e2e-fork-ready")).toHaveText("ready", { timeout: 20_000 });

    const recordedRequests: { url: string; postData: string | null }[] = [];
    page.on("request", (req) => {
      recordedRequests.push({ url: req.url(), postData: req.postData() });
    });

    await page.getByTestId("fork-open-button").click();
    await expect(page.getByTestId("fork-dialog")).toBeVisible();
    await expect(page.getByTestId("fork-active-count")).toContainText("0/5");

    await page.getByTestId("fork-confirm-button").click();
    await expect(page.getByTestId("fork-dialog")).toBeHidden({ timeout: 10_000 });

    const forkId = await page.getByTestId("last-fork-id").textContent();
    expect(forkId).toBeTruthy();

    // AC5: Đúng 1 request /api/me trong toàn luồng bấm Fork, 0 request mang nội dung SQL.
    const apiMeCalls = recordedRequests.filter((r) => new URL(r.url).pathname === "/api/me");
    expect(apiMeCalls).toHaveLength(1);
    const sqlLeak = recordedRequests.some(
      (r) =>
        (r.postData && (r.postData.includes("CREATE TABLE") || r.postData.includes("SELECT id"))) ||
        r.url.includes("CREATE%20TABLE"),
    );
    expect(sqlLeak).toBe(false);

    // AC1: Dự án mới có đủ 3 tab khớp nguyên vẹn, dự án gốc không đổi.
    const ws = await page.evaluate(async () => {
      const api = (window as unknown as {
        __e2eForkApi: {
          readWorkspace: () => Promise<{
            projects: { id: string; name: string; roomFork?: { projectId: string; forkedAt: number } }[];
            tabsByProject: Record<string, { name: string; sql: string; position: number }[]>;
          }>;
        };
      }).__e2eForkApi;
      return api.readWorkspace();
    });

    expect(ws.projects).toHaveLength(2);
    const forked = ws.projects.find((p) => p.id === forkId);
    expect(forked?.roomFork?.projectId).toBe("room-origin-e2e");
    expect(forked?.name).toContain("Phòng thực hành E2E — Fork ");
    expect(ws.tabsByProject[forkId!]).toEqual([
      { name: "01_schema.sql", sql: "CREATE TABLE orders (id INT PRIMARY KEY, total INT);", position: 0 },
      { name: "02_seed.sql", sql: "INSERT INTO orders VALUES (1, 100), (2, 250);", position: 1 },
      { name: "03_query.sql", sql: "SELECT id, total FROM orders WHERE total > 50;", position: 2 },
    ]);
    expect(ws.tabsByProject["room-origin-e2e"]).toHaveLength(3);
  });

  test("AC2 & AC3: Đủ 5 fork khóa nút Fork (vi/en); thêm fork 6 bằng API trực tiếp vẫn đếm 6 và giữ nguyên fork cũ", async ({
    page,
  }) => {
    await setupApiMe(page, "u-fork-limit");
    await page.goto("/vi/e2e-fork?userId=u-fork-limit");
    await expect(page.getByTestId("e2e-fork-ready")).toHaveText("ready", { timeout: 20_000 });

    // Tạo 5 fork qua API thật trên trình duyệt.
    const createdIds = await page.evaluate(async () => {
      const api = (window as unknown as {
        __e2eForkApi: {
          forkRoomToWorkspace: (input: unknown) => Promise<{ projectId: string }>;
          room: unknown;
        };
      }).__e2eForkApi;
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await api.forkRoomToWorkspace(api.room);
        ids.push(res.projectId);
      }
      return ids;
    });
    expect(createdIds).toHaveLength(5);

    // AC2: Mở dialog -> hiện 5/5, nút Fork disabled, thông báo tiếng Việt.
    await page.getByTestId("fork-open-button").click();
    await expect(page.getByTestId("fork-active-count")).toContainText("5/5");
    await expect(page.getByTestId("fork-confirm-button")).toBeDisabled();
    await expect(page.getByTestId("fork-limit-alert")).toContainText("5/5");

    // AC3: Chèn fork thứ 6 trực tiếp vào IndexedDB -> countActiveForks trả 6, giữ nguyên 5 fork cũ.
    const countAfter6 = await page.evaluate(async () => {
      const api = (window as unknown as {
        __e2eForkApi: {
          countActiveForks: (scope: { kind: "user"; userId: string }) => Promise<number>;
        };
      }).__e2eForkApi;
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("sqllens-workspace", 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("projects", "readwrite");
          tx.objectStore("projects").put({
            id: "direct-fork-6",
            scopeKey: "user_u-fork-limit",
            name: "Direct Fork 6",
            engine: "postgres",
            createdAt: 9999,
            updatedAt: 9999,
            roomFork: { projectId: "room-origin-e2e", forkedAt: 9999 },
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
      return api.countActiveForks({ kind: "user", userId: "u-fork-limit" });
    });
    expect(countAfter6).toBe(6);

    // Kiểm tra bản tiếng Anh trên cùng IndexedDB (giữ nguyên cả 6 fork, không xóa bản cũ).
    await page.goto("/en/e2e-fork?userId=u-fork-limit");
    await expect(page.getByTestId("e2e-fork-ready")).toHaveText("ready", { timeout: 20_000 });
    await page.getByTestId("fork-open-button").click();
    await expect(page.getByTestId("fork-active-count")).toContainText("6/5");
    await expect(page.getByTestId("fork-confirm-button")).toBeDisabled();
    await expect(page.getByTestId("fork-limit-alert")).toContainText("maximum of 5");
  });

  test("AC4: Tab vượt 512 KB bị chặn với số byte thật và tên tab vi phạm", async ({ page }) => {
    await setupApiMe(page, null);
    await page.goto("/vi/e2e-fork?mode=oversized");
    await expect(page.getByTestId("e2e-fork-ready")).toHaveText("ready", { timeout: 20_000 });

    await page.getByTestId("fork-open-button").click();
    await page.getByTestId("fork-confirm-button").click();

    const alert = page.getByTestId("fork-error-alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("oversized_tab.sql");
    const text = (await alert.textContent()) ?? "";
    const match = text.match(/(\d+)\s*byte/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThan(512 * 1024);
  });

  test("AC6: Mobile 390x844 không tràn ngang khi mở ForkDialog", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await setupApiMe(page, null);
    await page.goto("/vi/e2e-fork");
    await expect(page.getByTestId("e2e-fork-ready")).toHaveText("ready", { timeout: 20_000 });

    await page.getByTestId("fork-open-button").click();
    await expect(page.getByTestId("fork-dialog")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});
