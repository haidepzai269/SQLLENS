import { expect, test, type Page, type Route } from "@playwright/test";

// API giả bằng page.route, không cần Gin hay key thật.
const SHOTS = "../_bmad-output/SP005/STR024/Task044";
const port = process.env.E2E_PORT ?? "3100";
const AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20' fill='%23c80'/%3E%3C/svg%3E";
const err = (code: string, key: string) => JSON.stringify({ error: { code, messageKey: `error.${key}` } });

const T = {
  vi: {
    signIn: "Đăng nhập", signOut: "Đăng xuất", reason: /MySQL chạy trên máy chủ thật/, free: /PostgreSQL chạy ngay trong trình duyệt/,
    cancel: "Hủy, dùng PostgreSQL", google: "Tiếp tục với Google", github: "Tiếp tục với GitHub", check: "Kiểm tra quyền dùng MySQL",
    exceeded: "Đã hết lượt tạo phiên MySQL trong ngày", still: "PostgreSQL vẫn dùng được bình thường.",
    unavailable: "MySQL tạm thời không dùng được", notOut: /không phải do bạn hết lượt/, storage: /SQL bạn đang soạn có thể mất/,
    cancelled: "Bạn đã hủy đăng nhập.", failed: "Đăng nhập chưa thành công.", logoutFailed: "Chưa đăng xuất được.", needs: "MySQL cần đăng nhập. Đăng nhập để tiếp tục.",
    ok: "Đã qua cổng đăng nhập và hạn mức.", account: "Tài khoản của An",
  },
  en: {
    signIn: "Sign in", signOut: "Sign out", reason: /MySQL runs on a real server/, free: /PostgreSQL runs in your browser/,
    cancel: "Cancel, use PostgreSQL", google: "Continue with Google", github: "Continue with GitHub", check: "Check MySQL access",
    exceeded: "All MySQL sessions for today are spent", still: "PostgreSQL still works as usual.",
    unavailable: "MySQL is temporarily unavailable", notOut: /not because you ran out/, storage: /SQL you are writing may be lost/,
    cancelled: "You cancelled the sign-in.", failed: "Sign-in did not succeed.", logoutFailed: "Could not sign out.", needs: "MySQL requires sign-in. Sign in to continue.",
    ok: "Passed the sign-in gate and quota.", account: "Account of An",
  },
} as const;

type St = {
  user: boolean;
  me: number;
  starts: string[];
  logoutOrigins: (string | undefined)[];
  ping: (r: Route) => Promise<void>;
  holdMe?: Promise<void>;
  logoutFails?: boolean;
};

async function mock(page: Page, init: Partial<St> = {}) {
  const s: St = { user: false, me: 0, starts: [], logoutOrigins: [], ping: (r) => r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "0123456789abcdef0123456789abcd", expiresAt: "2030-01-01T00:00:00Z" }) }), ...init };
  await page.route("**/api/me", async (r) => {
    s.me++;
    await s.holdMe;
    return s.user
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "1", name: "An", avatarUrl: AVATAR, provider: "google" }) })
      : r.fulfill({ status: 401, contentType: "application/json", body: err("auth_required", "authRequired") });
  });
  // Gin chuyển về trang đích sau đăng nhập; giả lập đúng như vậy.
  await page.route("**/api/auth/*/start*", (r) => {
    const u = new URL(r.request().url());
    s.starts.push(u.search);
    s.user = true;
    return r.fulfill({ status: 302, headers: { location: u.searchParams.get("next") ?? "/" } });
  });
  await page.route("**/api/auth/logout", (r) => {
    s.logoutOrigins.push(r.request().headers()["origin"]);
    if (s.logoutFails) return r.fulfill({ status: 500, body: "{}" });
    s.user = false;
    return r.fulfill({ status: 204 });
  });
  // Từ Task075, "cổng" MySQL là bước tạo phiên khi bấm Chạy; `ping` giờ là bộ xử lý của POST /api/mysql/sessions.
  await page.route("**/api/mysql/sessions", (r) => s.ping(r));
  await page.route(/\/api\/mysql\/sessions\/[0-9a-f]{30}(\/query)?$/, (r) =>
    r.request().method() === "DELETE" ? r.fulfill({ status: 204 }) : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ columns: ["n"], rows: [[1]] }], truncated: false }) }),
  );
  return s;
}

const sqlBox = (p: Page) => p.locator(".cm-content").first();
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const quota = (code: string, key: string, status: number, headers: Record<string, string> = {}) => (r: Route) =>
  r.fulfill({ status, contentType: "application/json", headers, body: err(code, key) });
async function runMysql(p: Page) {
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor();
  if (await tab.isVisible()) await tab.click();
  await p.locator(".cm-content:visible").first().fill("SELECT 1");
  await p.getByRole("button", { name: /^(Chạy|Run)$/ }).first().click();
}
const mysqlTab = (p: Page) => p.getByRole("tab", { name: "MySQL" }).filter({ visible: true });

test.use({ timezoneId: "UTC" });

for (const l of ["vi", "en"] as const) {
  const t = T[l];
  test.describe(`ngôn ngữ ${l}`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("AC1 skeleton khi đang tải, rồi nút đăng nhập mở hộp thoại hai lựa chọn", async ({ page }) => {
      let release!: () => void;
      const s = await mock(page, { holdMe: new Promise<void>((r) => (release = r)) });
      await page.goto(`/${l}`);
      await expect(page.getByTestId("auth-skeleton")).toBeVisible();
      await expect(page.getByRole("button", { name: t.signIn })).toHaveCount(0); // không nháy sai trạng thái
      release();
      await page.getByRole("button", { name: t.signIn }).click();
      const d = page.getByRole("dialog");
      await expect(d.getByRole("link", { name: t.google })).toBeVisible();
      await expect(d.getByRole("link", { name: t.github })).toBeVisible();
      expect(s.me).toBe(1);
      await page.screenshot({ path: `${SHOTS}/anh-dangnhap-${l}-1440.png` });
      await page.setViewportSize({ width: 390, height: 800 });
      await expect(d).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/anh-dangnhap-${l}-390.png` });
    });

    test("AC1 đã đăng nhập: ảnh và tên trong menu, có Đăng xuất", async ({ page }) => {
      await mock(page, { user: true });
      await page.goto(`/${l}`);
      const trigger = page.getByRole("button", { name: t.account });
      await expect(trigger).toBeVisible();
      await expect(page.getByRole("button", { name: t.signIn })).toHaveCount(0);
      await expect(trigger.locator("img")).toHaveAttribute("src", AVATAR);
      await trigger.click();
      await expect(page.getByRole("menuitem", { name: t.signOut })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/anh-menu-${l}-1440.png` });
    });

    test("AC2 chọn MySQL khi chưa đăng nhập: có lý do; hủy thì về PostgreSQL", async ({ page }) => {
      await mock(page);
      await page.goto(`/${l}`);
      await expect(page.getByRole("button", { name: t.signIn })).toBeVisible();
      await mysqlTab(page).click();
      const d = page.getByRole("dialog");
      await expect(d).toContainText(t.reason);
      await expect(d).toContainText(t.free);
      await expect(page).toHaveURL(/engine=mysql/);
      await d.getByRole("button", { name: t.cancel }).click();
      await expect(page).toHaveURL(/engine=postgres/);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "PostgreSQL" })).toHaveAttribute("aria-selected", "true");
      // Esc cũng là hủy
      await mysqlTab(page).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(/engine=postgres/);
    });

    test("AC3/AC4 SQL và engine sống qua vòng đăng nhập, đúng locale, bản lưu bị xóa", async ({ page }) => {
      const s = await mock(page);
      await page.goto(`/${l}`);
      await sqlBox(page).click();
      await page.keyboard.type("SELECT secret_marker FROM t");
      await mysqlTab(page).click();
      await page.getByRole("dialog").getByRole("link", { name: t.google }).click();
      await expect(page).toHaveURL(new RegExp(`/${l}\\?engine=mysql`));
      await expect(page.getByRole("button", { name: t.account })).toBeVisible();
      await expect(sqlBox(page)).toContainText("SELECT secret_marker FROM t");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
      expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("secret_marker");
      // SQL không đi lên server: yêu cầu start chỉ mang next
      expect(s.starts).toHaveLength(1);
      expect(s.starts[0]).not.toContain("secret_marker");
      expect(decodeURIComponent(s.starts[0])).toContain(`next=/${l}?engine=mysql`);
      await page.screenshot({ path: `${SHOTS}/anh-quaylai-${l}-1440.png` });
    });

    test("ca biên: sessionStorage bị chặn vẫn đăng nhập được và có cảnh báo", async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
      });
      const s = await mock(page);
      await page.goto(`/${l}`);
      await sqlBox(page).click();
      await page.keyboard.type("SELECT 1");
      await mysqlTab(page).click();
      const d = page.getByRole("dialog");
      await expect(d).toContainText(t.storage);
      await d.getByRole("link", { name: t.github }).click();
      await expect(page.getByRole("button", { name: t.account })).toBeVisible();
      expect(s.starts).toHaveLength(1);
    });

    test("AC5 quota_exceeded: hạn mức, giờ có lại, PostgreSQL vẫn dùng được", async ({ page }) => {
      await mock(page, {
        user: true,
        ping: quota("quota_exceeded", "quotaExceeded", 429, { "Retry-After": "3600", "X-Quota-Reset": "2030-01-02T03:04:05Z" }),
      });
      await page.goto(`/${l}?engine=mysql`);
      await runMysql(page);
      const a = page.getByTestId("mysql-failure").filter({ visible: true });
      await expect(a).toContainText(t.exceeded);
      await expect(a).toContainText(/3:04/);
      await expect(a).toContainText(/2030|30/);
      await expect(a).toContainText(t.still);
      await page.screenshot({ path: `${SHOTS}/anh-quota-${l}-1440.png` });
    });

    test("AC5 quota_exceeded ở 390 px: terminal là một tab, không tràn ngang", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await mock(page, {
        user: true,
        ping: quota("quota_exceeded", "quotaExceeded", 429, { "Retry-After": "3600", "X-Quota-Reset": "2030-01-02T03:04:05Z" }),
      });
      await page.goto(`/${l}?engine=mysql`);
      await runMysql(page);
      const a = page.getByTestId("mysql-failure").filter({ visible: true });
      await expect(a).toContainText(t.exceeded);
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/anh-quota-${l}-390.png` });
    });

    test("AC5 quota_unavailable: báo tạm thời, không nói hết quota", async ({ page }) => {
      await mock(page, { user: true, ping: quota("quota_unavailable", "quotaUnavailable", 503) });
      await page.goto(`/${l}?engine=mysql`);
      await runMysql(page);
      const a = page.getByTestId("mysql-failure").filter({ visible: true });
      await expect(a).toContainText(t.unavailable);
      await expect(a).toContainText(t.notOut);
      await expect(a).not.toContainText(t.exceeded);
      await page.screenshot({ path: `${SHOTS}/anh-tamthoi-${l}-1440.png` });
    });

    test("qua cổng: tạo phiên 201 thì sẵn sàng", async ({ page }) => {
      await mock(page, { user: true });
      await page.goto(`/${l}?engine=mysql`);
      await runMysql(page);
      await expect(page.getByTestId("mysql-ready")).toBeVisible();
    });

    test("AC6 đăng xuất gửi POST có Origin đúng, rồi về PostgreSQL", async ({ page }) => {
      const s = await mock(page, { user: true });
      await page.goto(`/${l}?engine=mysql`);
      await page.getByRole("button", { name: t.account }).click();
      await page.getByRole("menuitem", { name: t.signOut }).click();
      await expect(page).toHaveURL(/engine=postgres/);
      await expect(page.getByRole("button", { name: t.signIn })).toBeVisible();
      expect(s.logoutOrigins).toEqual([`http://localhost:${port}`]);
      expect(s.starts).toHaveLength(0);
      await expect(page.getByRole("dialog")).toHaveCount(0); // về PostgreSQL thì không mở cổng
    });

    test("đăng xuất lỗi thì báo, vẫn giữ trạng thái đăng nhập", async ({ page }) => {
      await mock(page, { user: true, logoutFails: true });
      await page.goto(`/${l}`);
      await page.getByRole("button", { name: t.account }).click();
      await page.getByRole("menuitem", { name: t.signOut }).click();
      await expect(page.getByRole("status").filter({ hasText: t.logoutFailed })).toBeVisible();
      await expect(page.getByRole("button", { name: t.account })).toBeVisible();
    });

    test("AC8 auth_error=cancelled|failed hiện câu rõ ràng rồi bỏ tham số", async ({ page }) => {
      await mock(page);
      for (const [code, text] of [["cancelled", t.cancelled], ["failed", t.failed]] as const) {
        await page.goto(`/${l}?auth_error=${code}&engine=postgres`);
        await expect(page.getByRole("status").filter({ hasText: text })).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/${l}\\?engine=postgres$`));
      }
      await page.screenshot({ path: `${SHOTS}/anh-loi-${l}-1440.png` });
      // giá trị lạ không hiện gì nhưng vẫn bị bỏ khỏi URL
      await page.goto(`/${l}?auth_error=<script>`);
      await expect(page).not.toHaveURL(/auth_error/);
      // Vùng stage cũng có role status và hiện muộn hơn, nên chỉ kiểm câu lỗi đăng nhập.
      for (const text of [t.cancelled, t.failed]) await expect(page.getByRole("status").filter({ hasText: text })).toHaveCount(0);
    });

    test("ca biên: cookie hết hạn giữa phiên (ping 401) thì về chưa đăng nhập, không vòng lặp", async ({ page }) => {
      const s = await mock(page, { user: true, ping: quota("auth_required", "authRequired", 401) });
      await page.goto(`/${l}?engine=mysql`);
      await runMysql(page);
      await expect(page.getByRole("dialog")).toContainText(t.reason);
      await page.waitForTimeout(500);
      expect(s.me).toBe(1);
      expect(s.starts).toHaveLength(0); // không tự chuyển hướng
    });

    test("ca biên: /me lỗi mạng hoặc 5xx không mở cổng, vẫn dùng được PostgreSQL", async ({ page }) => {
      await page.route("**/api/me", (r) => r.abort());
      await page.goto(`/${l}?engine=mysql`);
      await expect(page.getByRole("button", { name: t.signIn })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText(t.needs).filter({ visible: true })).toBeVisible();
    });

    test("ảnh chụp 390 px: thanh trên và MySQL đã đăng nhập", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await mock(page, { user: true });
      await page.goto(`/${l}`);
      await expect(page.getByRole("button", { name: t.account })).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/anh-thanhtren-${l}-390.png` });
    });
  });
}
