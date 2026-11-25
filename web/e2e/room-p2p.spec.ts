import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Task166: WebRTC DataChannel P2P Result Broadcaster, Baton auto-return & NAT warning.
 */

interface RoutedControlItem {
  fromPeerId: string;
  message: unknown;
}

function createControlHub(userIds: string[]) {
  const queues = new Map<string, RoutedControlItem[]>();
  const push = (uid: string, item: RoutedControlItem) => {
    const list = queues.get(uid) ?? [];
    list.push(item);
    queues.set(uid, list);
  };
  return {
    broadcast(fromUserId: string, item: RoutedControlItem) {
      for (const uid of userIds) {
        if (uid !== fromUserId) push(uid, item);
      }
    },
    drain(uid: string): RoutedControlItem[] {
      const list = queues.get(uid) ?? [];
      queues.set(uid, []);
      return list;
    },
  };
}

async function openP2pMember(
  browser: Browser,
  opts: {
    locale?: "vi" | "en";
    userId: string;
    role: "owner" | "editor" | "viewer";
    ownerId: string;
    holderId: string;
    hub: ReturnType<typeof createControlHub>;
    returnMs?: number;
    natMs?: number;
    simulateNatFail?: boolean;
    viewport?: { width: number; height: number };
  },
): Promise<Page> {
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  await page.route("**/api/e2e-p2p/control", async (route) => {
    const body = route.request().postDataJSON() as RoutedControlItem;
    opts.hub.broadcast(opts.userId, body);
    await route.fulfill({ status: 204, body: "" });
  });

  await page.route("**/api/e2e-p2p/poll*", async (route) => {
    const url = new URL(route.request().url());
    const uid = url.searchParams.get("userId") ?? opts.userId;
    const messages = opts.hub.drain(uid);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages }),
    });
  });

  const qs = new URLSearchParams({
    projectId: "proj-p2p-e2e",
    userId: opts.userId,
    role: opts.role,
    ownerId: opts.ownerId,
    holderId: opts.holderId,
  });
  if (opts.returnMs) qs.set("returnMs", String(opts.returnMs));
  if (opts.natMs) qs.set("natMs", String(opts.natMs));
  if (opts.simulateNatFail) qs.set("simulateNatFail", "1");

  await page.goto(`/${opts.locale ?? "vi"}/e2e-p2p?${qs.toString()}`);
  return page;
}

test.describe("Task166 — P2P Result Broadcaster & NAT Warning", () => {
  test("AC1: Driver bấm Run → Viewer nhận kết quả P2P trong < 1s", async ({ browser }) => {
    const hub = createControlHub(["u-a", "u-v"]);
    const driver = await openP2pMember(browser, {
      userId: "u-a",
      role: "owner",
      ownerId: "u-a",
      holderId: "u-a",
      hub,
    });
    const viewer = await openP2pMember(browser, {
      userId: "u-v",
      role: "viewer",
      ownerId: "u-a",
      holderId: "u-a",
      hub,
    });

    const runBtn = driver.getByTestId("p2p-run-button");
    await expect(runBtn).toBeVisible({ timeout: 20_000 });
    await expect(viewer.getByTestId("p2p-result-view")).toBeVisible({ timeout: 20_000 });

    const startedAt = Date.now();
    await runBtn.click();

    await expect(viewer.getByTestId("p2p-result-view")).toContainText("p2p_ok", { timeout: 1000 });
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(1000);

    await driver.context().close();
    await viewer.context().close();
  });

  test("AC3: Driver mất kết nối → tự động trả Baton về ownerId sau timeout", async ({ browser }) => {
    const hub = createControlHub(["u-a", "u-b"]);
    const owner = await openP2pMember(browser, {
      userId: "u-a",
      role: "owner",
      ownerId: "u-a",
      holderId: "u-b",
      returnMs: 300,
      hub,
    });
    const driver = await openP2pMember(browser, {
      userId: "u-b",
      role: "editor",
      ownerId: "u-a",
      holderId: "u-b",
      returnMs: 300,
      hub,
    });

    await expect(driver.getByTestId("p2p-disconnect-button")).toBeVisible({ timeout: 20_000 });
    await expect(owner.getByTestId("p2p-baton-holder")).toContainText("u-b", { timeout: 20_000 });

    await driver.getByTestId("p2p-disconnect-button").click();

    await expect(owner.getByTestId("p2p-baton-returned")).toContainText("u-a", { timeout: 5000 });
    await expect(owner.getByTestId("p2p-baton-holder")).toContainText("u-a");

    await owner.context().close();
    await driver.context().close();
  });

  test("AC4 & AC5: Hiện NatWarningBanner đúng song ngữ vi/en và không tràn ngang ở 390px", async ({
    browser,
  }) => {
    const hubVi = createControlHub(["u-a"]);
    const pageVi = await openP2pMember(browser, {
      locale: "vi",
      userId: "u-a",
      role: "owner",
      ownerId: "u-a",
      holderId: "u-a",
      natMs: 200,
      simulateNatFail: true,
      viewport: { width: 390, height: 844 },
      hub: hubVi,
    });

    const bannerVi = pageVi.getByTestId("nat-warning-banner");
    await expect(bannerVi).toBeVisible({ timeout: 10_000 });
    await expect(bannerVi).toContainText(
      "Tính năng hoạt động tốt nhất trên cùng mạng LAN hoặc Open NAT.",
    );

    const overflowVi = await pageVi.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflowVi).toBe(false);
    await pageVi.context().close();

    const hubEn = createControlHub(["u-a"]);
    const pageEn = await openP2pMember(browser, {
      locale: "en",
      userId: "u-a",
      role: "owner",
      ownerId: "u-a",
      holderId: "u-a",
      natMs: 200,
      simulateNatFail: true,
      viewport: { width: 390, height: 844 },
      hub: hubEn,
    });

    const bannerEn = pageEn.getByTestId("nat-warning-banner");
    await expect(bannerEn).toBeVisible({ timeout: 10_000 });
    await expect(bannerEn).toContainText("Best experienced on the same LAN or Open NAT.");

    const overflowEn = await pageEn.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflowEn).toBe(false);
    await pageEn.context().close();
  });
});
