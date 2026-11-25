import { expect, test } from "@playwright/test";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

test.describe("Task169 — Arena Wait-For Graph & 3s Polling Sync", () => {
  test("AC2 & AC3: 2-browser Host -> Viewer đồng bộ trong < 3.5s, 0 byte SQL, nhãn Mô phỏng luôn hiện", async ({
    browser,
  }) => {
    let remoteStep = 0;
    const postedPayloads: string[] = [];

    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const viewerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const setupRoutes = async (context: typeof hostContext) => {
      await context.route(`**/api/v1/cloud/projects/${ROOM_ID}/arena-step`, async (route) => {
        const req = route.request();
        if (req.method() === "POST") {
          const raw = req.postData() ?? "";
          postedPayloads.push(raw);
          const parsed = JSON.parse(raw) as { step: number };
          expect(Object.keys(parsed)).toEqual(["step"]);
          expect(raw).not.toMatch(/SELECT|UPDATE|INSERT|DELETE|BEGIN|COMMIT|accounts/i);
          remoteStep = parsed.step;
          return route.fulfill(json({ step: remoteStep }));
        }
        return route.fulfill(json({ step: remoteStep }));
      });
    };

    await setupRoutes(hostContext);
    await setupRoutes(viewerContext);

    const hostPage = await hostContext.newPage();
    const viewerPage = await viewerContext.newPage();

    await hostPage.goto(`/vi/e2e-arena?role=host&roomId=${ROOM_ID}`);
    await viewerPage.goto(`/vi/e2e-arena?role=viewer&roomId=${ROOM_ID}`);

    // Nhãn Mô phỏng luôn hiện trên cả Host lẫn Viewer
    await expect(hostPage.getByTestId("arena-header-simulation-badge")).toContainText("Mô phỏng");
    await expect(viewerPage.getByTestId("arena-header-simulation-badge")).toContainText("Mô phỏng");
    await expect(viewerPage.getByTestId("arena-viewer-sync-note")).toBeVisible();

    // Host bấm Next Step 3 lần để tới bước 3 (deadlock detected)
    const nextBtn = hostPage.getByTestId("arena-btn-next");
    await nextBtn.click();
    await nextBtn.click();
    await nextBtn.click();

    await expect(hostPage.getByTestId("arena-step-indicator")).toContainText("4");
    await expect(hostPage.getByTestId("arena-wait-graph")).toHaveAttribute("data-deadlock", "true");

    // Viewer poll mỗi 3s -> cập nhật sang bước 4 (stepIndex = 3) và đồ thị deadlock trong < 3.5s
    await expect(viewerPage.getByTestId("arena-step-indicator")).toContainText("4", {
      timeout: 3500,
    });
    const viewerGraph = viewerPage.getByTestId("arena-wait-graph");
    await expect(viewerGraph).toHaveAttribute("data-deadlock", "true");
    await expect(viewerGraph).toHaveAttribute("data-status-a", "aborted");
    await expect(viewerGraph).toHaveAttribute("data-status-b", "waiting");
    await expect(viewerGraph).toHaveAttribute("data-edges", "2");

    // Xác nhận có ít nhất 1 POST đã gửi bước 3 và 0 byte SQL
    expect(postedPayloads.some((p) => p === '{"step":3}')).toBe(true);

    await hostContext.close();
    await viewerContext.close();
  });

  test("AC5: Mobile 390x844 không tràn ngang", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(`**/api/v1/cloud/projects/${ROOM_ID}/arena-step`, (route) =>
      route.fulfill(json({ step: 0 })),
    );

    const page = await context.newPage();
    await page.goto(`/vi/e2e-arena?role=host&roomId=${ROOM_ID}`);
    await expect(page.getByTestId("arena-wait-graph")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await context.close();
  });
});
