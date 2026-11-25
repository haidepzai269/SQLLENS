import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Task165: UI The Baton — nút Run có trạng thái, tooltip tên người giữ, toast xin/cấp quyền,
 * ẩn nút Run & Xin quyền với viewer, và responsive mobile 390px.
 */

const PROJECT_ID = "proj-baton-e2e";
const NAMES = JSON.stringify({ "u-a": "An", "u-b": "Bình", "u-v": "Cường" });

interface ControlMsg {
  kind: string;
  roomId: string;
  fromUserId: string;
  targetUserId?: string;
  sentAt: number;
}

function createSignalHub() {
  const queues = new Map<string, ControlMsg[]>();
  const push = (userId: string, msg: ControlMsg) => {
    const list = queues.get(userId) ?? [];
    list.push(msg);
    queues.set(userId, list);
  };
  const drain = (userId: string): ControlMsg[] => {
    const list = queues.get(userId) ?? [];
    queues.set(userId, []);
    return list;
  };
  return {
    broadcast(fromUserId: string, msg: ControlMsg) {
      for (const uid of ["u-a", "u-b", "u-v"]) {
        if (uid !== fromUserId) push(uid, msg);
      }
    },
    drain,
  };
}

async function openMember(
  browser: Browser,
  opts: {
    userId: string;
    role: "owner" | "editor" | "viewer";
    holderId: string;
    hub: ReturnType<typeof createSignalHub>;
    viewport?: { width: number; height: number };
  },
): Promise<Page> {
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: opts.userId, name: opts.userId, provider: "google" }),
    });
  });
  await page.route("**/api/e2e-baton/control", async (route) => {
    const body = route.request().postDataJSON() as ControlMsg;
    opts.hub.broadcast(opts.userId, body);
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/e2e-baton/poll*", async (route) => {
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
    projectId: PROJECT_ID,
    userId: opts.userId,
    role: opts.role,
    holderId: opts.holderId,
    names: NAMES,
  });
  await page.goto(`/vi/e2e-baton?${qs.toString()}`);
  return page;
}

test.describe("Task165 — UI The Baton", () => {
  test("AC2: Editor B xin quyền → Driver A thấy tên B và cấp quyền → Baton chuyển sang B", async ({ browser }) => {
    const hub = createSignalHub();
    const pageA = await openMember(browser, { userId: "u-a", role: "owner", holderId: "u-a", hub });
    const pageB = await openMember(browser, { userId: "u-b", role: "editor", holderId: "u-a", hub });

    const runA = pageA.getByTestId("lab-run-button");
    const runB = pageB.getByTestId("lab-run-button");

    // Nhập SQL vào editor của A và B để điều kiện canRun (sql !== "") đạt
    await pageA.locator("#sql-input .cm-content").click();
    await pageA.keyboard.type("SELECT 1;");
    await pageB.locator("#sql-input .cm-content").click();
    await pageB.keyboard.type("SELECT 1;");

    // Ban đầu A giữ Baton: A bật (khi có SQL), B bị disabled và có nút Xin quyền
    await expect(runA).toBeEnabled({ timeout: 20_000 });
    await expect(runB).toBeDisabled({ timeout: 20_000 });
    await expect(pageB.getByTestId("baton-request-bar")).toContainText("An");

    // Hover nút Run bị disabled của B -> tooltip chứa tên người đang giữ ("An")
    await runB.locator("..").hover();
    await expect(pageB.locator("[data-slot=tooltip-content][data-open]")).toContainText("An");

    // B bấm Xin quyền chạy
    await pageB.getByTestId("baton-request-button").click();
    await expect(pageB.getByTestId("baton-request-button")).toContainText("Đã gửi yêu cầu");

    // A thấy toast xin quyền chứa tên "Bình" và bấm Cấp quyền
    const toastA = pageA.getByTestId("baton-request-toast");
    await expect(toastA).toBeVisible({ timeout: 10_000 });
    await expect(toastA).toContainText("Bình");
    await pageA.getByTestId("baton-grant-button").click();

    // Baton chuyển sang B: nút Run của B bật, nút Run của A bị disabled kèm tooltip chứa tên "Bình"
    await expect(runB).toBeEnabled({ timeout: 10_000 });
    await expect(runA).toBeDisabled({ timeout: 10_000 });
    await runA.locator("..").hover();
    await expect(pageA.locator("[data-slot=tooltip-content][data-open]")).toContainText("Bình");

    await pageA.context().close();
    await pageB.context().close();
  });

  test("AC4: Vai trò viewer không thấy nút Run và không thấy nút Xin quyền", async ({ browser }) => {
    const hub = createSignalHub();
    const viewer = await openMember(browser, { userId: "u-v", role: "viewer", holderId: "u-a", hub });

    // Đợi workspace render xong (có ô nhập SQL)
    await expect(viewer.locator("#sql-input")).toBeVisible({ timeout: 20_000 });
    await expect(viewer.getByTestId("lab-run-button")).toHaveCount(0);
    await expect(viewer.getByTestId("baton-request-button")).toHaveCount(0);
    await expect(viewer.getByTestId("baton-request-bar")).toHaveCount(0);

    await viewer.context().close();
  });

  test("AC5: Mobile 390x844 không tràn ngang khi hiện BatonRequestToast", async ({ browser }) => {
    const hub = createSignalHub();
    const pageB = await openMember(browser, {
      userId: "u-b",
      role: "editor",
      holderId: "u-a",
      hub,
      viewport: { width: 390, height: 844 },
    });

    await pageB.getByRole("tab", { name: "SQL", exact: true }).click();
    await expect(pageB.getByTestId("baton-request-bar")).toBeVisible({ timeout: 20_000 });
    const overflow = await pageB.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await pageB.context().close();
  });
});
