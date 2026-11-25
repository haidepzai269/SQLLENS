import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Task162: mời cộng tác và tham gia phòng (AC2).
 *
 * Backend thật không chạy trong E2E, nên ba endpoint phòng được mock đúng hợp đồng Task161:
 * `POST /invite`, `GET /members`, `POST /join`, cộng `GET /projects/:id` mà `pullProject` gọi.
 * Test kiểm hành vi giao diện thật trên Chromium, không kiểm server (server có test Go riêng).
 */

const CLOUD_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "tok-abc";

const meA = { id: "u-a", name: "An", provider: "google" };
const meB = { id: "u-b", name: "Bình", provider: "google" };

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

async function memberPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await context.route("**/api/me", (r) => r.fulfill(json(meB)));
  await context.route(`**/api/v1/cloud/projects/${CLOUD_ID}`, (r) =>
    r.fulfill(
      json({
        project: {
          id: CLOUD_ID,
          name: "Phòng thử",
          engine: "postgres",
          tabCount: 1,
          createdAt: "2026-11-24T00:00:00Z",
          updatedAt: "2026-11-24T00:00:00Z",
          tabs: [{ name: "01_hello.sql", sql: "SELECT 1;", position: 0 }],
        },
      }),
    ),
  );
  return context.newPage();
}

test.describe("Task162 — Mời cộng tác", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC2: chủ tạo liên kết, người nhận vào phòng, chủ thấy thành viên mới", async ({ browser }) => {
    // Trạng thái server giả: B chỉ xuất hiện sau khi gọi /join.
    let joined = false;

    const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const owner = await ownerContext.newPage();
    await owner.route("**/api/me", (r) => r.fulfill(json(meA)));
    await owner.route(`**/api/v1/cloud/projects/${CLOUD_ID}/members`, (r) =>
      r.fulfill(
        json({
          members: [
            { userId: meA.id, name: meA.name, avatarUrl: null, role: "owner" },
            ...(joined ? [{ userId: meB.id, name: meB.name, avatarUrl: null, role: "editor" }] : []),
          ],
        }),
      ),
    );
    await owner.route(`**/api/v1/cloud/projects/${CLOUD_ID}/invite`, (r) =>
      r.fulfill(json({ token: TOKEN, role: "editor", expiresAt: "2026-11-25T10:00:00Z" })),
    );

    await owner.goto("/vi/e2e-room");
    await owner.getByTestId("room-invite-trigger").click();
    await expect(owner.getByTestId("room-member-row")).toHaveCount(1);
    await expect(owner.getByTestId("room-member-list")).toContainText("An");
    await expect(owner.getByTestId("room-member-list")).toContainText("Chủ phòng");

    await owner.getByTestId("room-invite-create").click();
    const link = owner.getByTestId("room-invite-link");
    await expect(link).toHaveValue(new RegExp(`/vi/join\\?token=${TOKEN}`));

    await owner.getByTestId("room-invite-copy").click();
    await expect(owner.getByTestId("room-invite-copy")).toContainText("Đã sao chép");
    const copied = await owner.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`/vi/join?token=${TOKEN}`);

    // Người nhận mở đúng liên kết vừa tạo.
    const member = await memberPage(browser);
    await member.route("**/api/v1/cloud/projects/join", (r) => {
      joined = true;
      return r.fulfill(json({ projectId: CLOUD_ID, role: "editor", alreadyMember: false }));
    });
    await member.goto(`/vi/join?token=${TOKEN}`);
    await member.getByTestId("room-join-button").click();
    await member.waitForURL(/\/vi$/, { timeout: 30_000 });
    // Dự án cloud được kéo về và mở sẵn: tab của phòng hiện trong workspace.
    await expect(member.getByText("01_hello.sql")).toBeVisible({ timeout: 30_000 });

    // Chủ mở lại hộp thoại: refetch mỗi lần mở, nên thấy thành viên mới.
    await owner.getByTestId("room-invite-dialog").getByRole("button", { name: "Đóng" }).click();
    await owner.getByTestId("room-invite-trigger").click();
    await expect(owner.getByTestId("room-member-row")).toHaveCount(2);
    await expect(owner.getByTestId("room-member-list")).toContainText("Bình");
    await expect(owner.getByTestId("room-member-list")).toContainText("Biên tập");

    await ownerContext.close();
    await member.context().close();
  });

  test("liên kết hết hạn: câu riêng, không mời thử lại", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/api/me", (r) => r.fulfill(json(meB)));
    await page.route("**/api/v1/cloud/projects/join", (r) =>
      r.fulfill(json({ error: { code: "token_expired", messageKey: "error.notFound" } }, 410)),
    );
    await page.goto(`/vi/join?token=${TOKEN}`);
    await page.getByTestId("room-join-button").click();
    await expect(page.getByTestId("room-join-error")).toContainText("đã hết hạn");
    await expect(page.getByTestId("room-join-error").getByRole("button", { name: "Thử lại" })).toHaveCount(0);
    await context.close();
  });

  test("chưa đăng nhập mở link mời: sang /login với next giữ nguyên token", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/api/me", (r) => r.fulfill(json({ error: { code: "auth_required" } }, 401)));

    await page.goto(`/vi/join?token=${TOKEN}`);
    await page.waitForURL(/\/vi\/login\?next=/, { timeout: 30_000 });
    const next = new URL(page.url()).searchParams.get("next");
    expect(next).toBe(`/vi/join?token=${TOKEN}`);

    await context.close();
  });

  test("link thiếu token: nói rõ thiếu mã và khoá nút tham gia", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/api/me", (r) => r.fulfill(json(meB)));

    await page.goto("/vi/join");
    await expect(page.getByTestId("room-join-missing-token")).toBeVisible();
    await expect(page.getByTestId("room-join-button")).toBeDisabled();

    await context.close();
  });

  test("tài liệu /join không rò token qua referrer", async ({ page }) => {
    const response = await page.goto(`/vi/join?token=${TOKEN}`);
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  });

  test("AC3: 390px không tràn ngang khi mở hộp thoại mời", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.route("**/api/me", (r) => r.fulfill(json(meA)));
    await page.route(`**/api/v1/cloud/projects/${CLOUD_ID}/members`, (r) =>
      r.fulfill(json({ members: [{ userId: meA.id, name: "Tên rất dài ".repeat(8), avatarUrl: null, role: "owner" }] })),
    );
    await page.route(`**/api/v1/cloud/projects/${CLOUD_ID}/invite`, (r) =>
      r.fulfill(json({ token: "x".repeat(120), role: "editor", expiresAt: "2026-11-25T10:00:00Z" })),
    );
    await page.goto("/vi/e2e-room");
    await page.getByTestId("room-invite-trigger").click();
    await page.getByTestId("room-invite-create").click();
    await expect(page.getByTestId("room-invite-link")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});
