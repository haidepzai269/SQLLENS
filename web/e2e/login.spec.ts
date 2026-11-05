import { expect, test, type Page } from "@playwright/test";

// /api/me và /api/auth/* giả bằng page.route, không cần Gin hay OAuth thật.
const SHOTS = "../_bmad-output/SP005/STR024/Task066/anh";

const T = {
  vi: {
    run: "Chạy", signIn: "Đăng nhập", google: "Tiếp tục với Google", github: "Tiếp tục với GitHub", trial: "Dùng thử không đăng nhập",
    about: "Xem SQLLens làm được gì", left: (n: number) => `Còn ${n}/2 lượt chạy thử`, limit: /đã dùng hết 2 lượt chạy thử/i,
    blocked: /Câu lệnh này cần đăng nhập/, cancelled: "Bạn đã hủy đăng nhập.", failed: "Đăng nhập chưa thành công.",
    locked: /cần đăng nhập\. Khi chưa đăng nhập bạn xem được Sơ đồ, Plan và Tranh chấp/, tabs: ["B-Tree", "Thử sửa", "Capacity", "Mentor"],
  },
  en: {
    run: "Run", signIn: "Sign in", google: "Continue with Google", github: "Continue with GitHub", trial: "Try without signing in",
    about: "See what SQLLens can do", left: (n: number) => `${n} of 2 trial runs left`, limit: /used all 2 trial runs/i,
    blocked: /This statement needs sign-in/, cancelled: "You cancelled the sign-in.", failed: "Sign-in did not succeed.",
    locked: /tab needs sign-in\. Without signing in you can view Schema, Plan and Conflicts/, tabs: ["B-Tree", "Try a fix", "Capacity", "Mentor"],
  },
} as const;

type Me = "anon" | "user" | "503" | "abort";
async function mock(page: Page, me: Me) {
  const s = { starts: [] as string[], me: 0, user: me === "user", ai: 0 };
  await page.route("**/api/me", (r) => {
    s.me++;
    if (me === "abort") return r.abort();
    if (me === "503") return r.fulfill({ status: 503, body: "{}" });
    return s.user
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "1", name: "An", provider: "google" }) })
      : r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "auth_required", messageKey: "error.authRequired" } }) });
  });
  // Gin chuyển về trang đích sau đăng nhập; giả lập đúng như vậy.
  await page.route("**/api/auth/*/start*", (r) => {
    const u = new URL(r.request().url());
    s.starts.push(u.searchParams.get("next") ?? "");
    s.user = true;
    return r.fulfill({ status: 302, headers: { location: u.searchParams.get("next") ?? "/" } });
  });
  await page.route("**/api/ai/**", (r) => (s.ai++, r.fulfill({ status: 500, body: "{}" })));
  return s;
}

const overflow = (p: Page) => p.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }));
const sqlBox = (p: Page) => p.locator(".cm-content:visible");
const sqlText = (p: Page) => sqlBox(p).evaluate((el) => (el as HTMLElement).innerText.replace(/​/g, ""));
const runBtn = (p: Page, l: "vi" | "en") => p.getByRole("button", { name: T[l].run, exact: true });
const left = (p: Page) => p.getByTestId("guest-left").filter({ visible: true });

async function setSql(p: Page, sql: string) {
  const tab = p.getByRole("tab", { name: "SQL", exact: true });
  await tab.or(sqlBox(p)).first().waitFor();
  if (await tab.isVisible()) await tab.click();
  await sqlBox(p).fill(sql);
}
// Bấm Chạy rồi đợi xong: kết luận "Thật" hiện, hoặc một lời chặn của khách.
async function run(p: Page, l: "vi" | "en", sql: string) {
  await setSql(p, sql);
  await runBtn(p, l).click();
}
const done = (p: Page) => p.locator('[data-testid="conclusion"]:visible');
const stageTab = (p: Page, name: string) => p.getByRole("tab", { name }).filter({ visible: true });

for (const l of ["vi", "en"] as const) {
  const t = T[l];
  test.describe(`ngôn ngữ ${l}`, () => {
    test("AC1 trang /login không có khung ứng dụng, không cuộn, không tải WASM, ở 1440 và 390", async ({ page }) => {
      await mock(page, "anon");
      const wasm: string[] = [];
      page.on("request", (r) => /\.wasm/.test(r.url()) && wasm.push(r.url()));
      for (const [w, h] of [[1440, 900], [390, 844]] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`/${l}/login?next=%2F${l}%3Fengine%3Dpostgres`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("header")).toHaveCount(0); // khung ứng dụng có <header>
        await expect(page.getByRole("tab", { name: "MySQL" })).toHaveCount(0);
        const g = page.getByRole("link", { name: t.google });
        const gh = page.getByRole("link", { name: t.github });
        await expect(g).toHaveAttribute("href", `/api/auth/google/start?next=${encodeURIComponent(`/${l}/login?next=${encodeURIComponent(`/${l}?engine=postgres`)}`)}`);
        await expect(gh).toHaveAttribute("href", /^\/api\/auth\/github\/start\?next=/);
        await expect(page.getByRole("link", { name: t.about })).toHaveAttribute("href", `/${l}/about`);
        await expect(page.getByRole("link", { name: t.trial })).toHaveAttribute("href", `/${l}`);
        await expect(page.locator("svg[data-ui] [data-chip]")).toHaveCount(1); // cảnh B-Tree có mặt
        await page.waitForTimeout(1800); // để cảnh chạy được một lúc
        await page.screenshot({ path: `${SHOTS}/login-${l}-${w}.png` });
        const o = await overflow(page);
        expect(o.x, `ngang ${w}x${h}`).toBeLessThanOrEqual(0);
        expect(o.y, `dọc ${w}x${h}`).toBeLessThanOrEqual(0);
      }
      expect(wasm).toEqual([]);
    });

    test("AC1 bàn phím: Tab đi qua Google, GitHub, dùng thử; focus thấy được", async ({ page }) => {
      await mock(page, "anon");
      await page.goto(`/${l}/login`);
      const g = page.getByRole("link", { name: t.google });
      await g.focus();
      await expect(g).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: t.github })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: t.trial })).toBeFocused();
      expect(await page.getByRole("link", { name: t.trial }).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    });

    test("giảm chuyển động: trang vẫn đủ nội dung, cây có đường đi vẽ sẵn", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mock(page, "anon");
      await page.goto(`/${l}/login`);
      await expect(page.getByRole("link", { name: t.google })).toBeVisible();
      expect(await page.locator("svg[data-ui] [data-lit-n]").evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity === "1").length)).toBe(4);
    });

    test("AC2 next lạ không thành open redirect: về trang chủ theo ngôn ngữ", async ({ page }) => {
      await mock(page, "anon");
      const home = `/api/auth/google/start?next=${encodeURIComponent(`/${l}/login?next=${encodeURIComponent(`/${l}`)}`)}`;
      for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "%2F%09%2Fevil.example", "javascript:alert(1)", "", `/${l}/login?next=%2Fx`]) {
        await page.goto(`/${l}/login?next=${bad.startsWith("%") ? bad : encodeURIComponent(bad)}`);
        await expect(page.getByRole("link", { name: t.google }), bad).toHaveAttribute("href", home);
      }
      await page.goto(`/${l}/login`);
      await expect(page.getByRole("link", { name: t.google })).toHaveAttribute("href", home);
    });

    test("AC2 nút Đăng nhập trên header dẫn tới /login giữ next, ngôn ngữ, engine; đăng nhập xong SQL còn nguyên", async ({ page }) => {
      const s = await mock(page, "anon");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${l}?engine=postgres`);
      await setSql(page, "SELECT secret_marker FROM t");
      await page.getByRole("link", { name: t.signIn, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${l}/login\\?next=%2F${l}%3Fengine%3Dpostgres`));
      await page.getByRole("link", { name: t.google }).click();
      // Gin (giả) đưa về /login?next=..., trang này thấy đã đăng nhập và chuyển tiếp về next
      await expect(page).toHaveURL(new RegExp(`/${l}\\?engine=postgres$`));
      await expect(sqlBox(page)).toContainText("SELECT secret_marker FROM t");
      expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("secret_marker");
      expect(s.starts).toHaveLength(1);
      expect(s.starts[0]).not.toContain("secret_marker");
      expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
    });

    test("ca biên: sessionStorage bị chặn thì báo trước, bấm lần hai mới đi", async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
      });
      await mock(page, "anon");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${l}`);
      await setSql(page, "SELECT 1");
      const link = page.getByRole("link", { name: t.signIn, exact: true });
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/${l}(\\?.*)?$`));
      await expect(page.getByRole("status").filter({ hasText: /chặn lưu tạm|blocks temporary storage/ })).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/${l}/login`));
    });

    test("AC3 đã đăng nhập mà vào /login thì chuyển về next hoặc /", async ({ page }) => {
      await mock(page, "user");
      await page.goto(`/${l}/login?next=%2F${l}%3Fengine%3Dpostgres`);
      await expect(page).toHaveURL(new RegExp(`/${l}\\?engine=postgres$`));
      await page.goto(`/${l}/login`);
      await expect(page).toHaveURL(new RegExp(`/${l}$`));
      await page.goto(`/${l}/login?next=https%3A%2F%2Fevil.example`);
      await expect(page).toHaveURL(new RegExp(`/${l}$`));
    });

    test("AC3 auth_error hiện câu rõ ràng ở trang đăng nhập", async ({ page }) => {
      await mock(page, "anon");
      for (const [code, text] of [["cancelled", t.cancelled], ["failed", t.failed]] as const) {
        await page.goto(`/${l}/login?auth_error=${code}`);
        await expect(page.getByTestId("login-error")).toContainText(text);
      }
      await page.screenshot({ path: `${SHOTS}/login-loi-${l}-1440.png` });
      await page.goto(`/${l}/login?auth_error=%3Cscript%3E`);
      await expect(page.getByTestId("login-error")).toHaveCount(0);
    });

    test("AC8 ba trạng thái /api/me: 401 chặn, 200 không giới hạn, 503 và lỗi mạng không chặn, không đếm", async ({ page }) => {
      for (const me of ["503", "abort"] as const) {
        await mock(page, me);
        await page.goto(`/${l}`);
        for (let i = 0; i < 3; i++) {
          await run(page, l, "SELECT 1 AS a");
          await expect(done(page)).toBeVisible({ timeout: 60_000 });
        }
        await expect(page.getByTestId("guest-note")).toHaveCount(0);
        await expect(page.getByTestId("locked-tab")).toHaveCount(0);
        await page.unrouteAll();
      }
    });

    test("AC4 khách chạy được 2 lần, luôn thấy số lượt; lần 3 không chạy, SQL còn nguyên; tải lại vẫn giữ lượt", async ({ page }) => {
      await mock(page, "anon");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${l}`);
      await expect(left(page)).toHaveText(t.left(2) + (l === "vi" ? " không cần đăng nhập." : " without signing in."));
      await run(page, l, "SELECT 1 AS a");
      await expect(done(page)).toBeVisible({ timeout: 60_000 });
      await expect(left(page)).toContainText(t.left(1));
      await run(page, l, "SELECT 2 AS a");
      await expect(left(page)).toContainText(t.left(0));
      await page.screenshot({ path: `${SHOTS}/het-luot-truoc-${l}-1440.png` });
      await page.reload();
      await expect(left(page)).toContainText(t.left(0)); // lượt giữ qua lần tải lại
      await run(page, l, "SELECT 3 AS keep_me");
      await expect(page.getByTestId("guest-limit")).toContainText(t.limit);
      await expect(page.getByTestId("guest-limit").getByRole("link", { name: t.signIn })).toBeVisible();
      expect(await sqlText(page)).toContain("keep_me");
      await expect(done(page)).toHaveCount(0); // lần 3 không chạy gì
      await page.screenshot({ path: `${SHOTS}/het-luot-${l}-1440.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("tab", { name: "SQL", exact: true }).click(); // điện thoại: ô SQL và lời mời nằm trong tab SQL
      await expect(page.getByTestId("guest-limit")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/het-luot-${l}-390.png` });
    });

    test("AC4 lời mời hết lượt dẫn tới /login giữ SQL; sau đăng nhập không còn giới hạn", async ({ page }) => {
      await mock(page, "anon");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${l}`);
      await page.evaluate(() => localStorage.setItem("sqllens.guestRuns", "2"));
      await page.reload();
      await run(page, l, "SELECT 9 AS back_again");
      await page.getByTestId("guest-limit").getByRole("link", { name: t.signIn }).click();
      await expect(page).toHaveURL(new RegExp(`/${l}/login\\?next=`));
      await page.getByRole("link", { name: t.github }).click();
      await expect(page).toHaveURL(new RegExp(`/${l}$`));
      await expect(sqlBox(page)).toContainText("back_again");
      await expect(page.getByTestId("guest-note")).toHaveCount(0);
      await runBtn(page, l).click();
      await expect(done(page)).toBeVisible({ timeout: 60_000 });
    });

    test("AC5 câu ngoài nhóm cơ bản: không chạy, không tính lượt, báo cần đăng nhập; lô có một câu lạ cũng bị chặn", async ({ page }) => {
      await mock(page, "anon");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${l}`);
      for (const sql of ["DROP TABLE t", "CREATE INDEX i ON t(id)", "BEGIN", "DO $$ BEGIN PERFORM 1; END $$", "SELECT 1; DROP TABLE t"]) {
        await run(page, l, sql);
        await expect(page.getByTestId("guest-blocked"), sql).toContainText(t.blocked);
        await expect(left(page)).toContainText(t.left(2));
        await expect(done(page)).toHaveCount(0);
      }
      await page.screenshot({ path: `${SHOTS}/bi-chan-${l}-1440.png` });
      await page.reload();
      await expect(left(page)).toContainText(t.left(2));
    });

    test("AC5 lỗi cú pháp không tính lượt", async ({ page }) => {
      await mock(page, "anon");
      await page.goto(`/${l}`);
      await run(page, l, "SELEC 1");
      await expect(page.locator('[data-testid="error"]:visible')).toBeVisible({ timeout: 60_000 });
      await expect(left(page)).toContainText(t.left(2));
    });

    test("AC6 khách bấm các tab khóa: lời mời đăng nhập, không gọi readBTree, tryChange, /api/ai", async ({ page }) => {
      const s = await mock(page, "anon");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${l}`);
      await run(page, l, "CREATE TABLE t(id int PRIMARY KEY, v int); CREATE TABLE u(id int); INSERT INTO t VALUES (1,1); SELECT * FROM t;");
      await expect(done(page)).toBeVisible({ timeout: 60_000 });
      await expect(stageTab(page, "Plan")).toBeVisible();
      for (const name of t.tabs) {
        await stageTab(page, name).click();
        await expect(page.getByTestId("locked-tab").filter({ visible: true })).toContainText(t.locked);
        await expect(page.getByTestId("locked-tab").filter({ visible: true }).getByRole("link", { name: t.signIn })).toBeVisible();
      }
      await stageTab(page, "Mentor").click();
      await page.screenshot({ path: `${SHOTS}/tab-khoa-${l}-1440.png` });
      expect(s.ai).toBe(0);
      // Sơ đồ và Plan vẫn mở được
      await stageTab(page, "Plan").click();
      await expect(page.getByTestId("locked-tab").filter({ visible: true })).toHaveCount(0);
    });

    test("AC5/AC6 Thử lại sau lỗi tải đi qua cùng cổng; Sinh dữ liệu khóa cho khách; tab Tranh chấp mở", async ({ page }) => {
      await mock(page, "anon");
      await page.setViewportSize({ width: 1440, height: 900 });
      let fail = true;
      await page.route(/.wasm/, (r) => (fail ? r.abort() : r.continue()));
      await page.goto(`/${l}`);
      await run(page, l, "SELECT 1");
      await expect(page.locator([data-testid=error]:visible)).toBeVisible({ timeout: 60_000 });
      fail = false;
      await setSql(page, "DROP TABLE t");
      await page.getByRole("button", { name: l === "vi" ? "Thử lại" : "Retry" }).click();
      await expect(page.getByTestId("guest-blocked")).toContainText(t.blocked);
      await expect(left(page)).toContainText(t.left(2)); // không chạy, không tính lượt
      const gen = page.getByRole("button", { name: l === "vi" ? "Sinh dữ liệu" : "Generate data" });
      await expect(gen).toBeEnabled();
      await gen.click();
      await expect(page.getByTestId("locked-tab")).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      // Tab Tranh chấp không tốn gì nên khách dùng được
      await run(page, l, "CREATE TABLE t(id int); SELECT * FROM t;");
      await expect(done(page)).toBeVisible({ timeout: 60_000 });
      await stageTab(page, l === "vi" ? "Tranh chấp" : "Conflicts").click();
      await expect(page.getByTestId("locked-tab").filter({ visible: true })).toHaveCount(0);
    });

    test("AC5 hết lượt rồi Thử lại cũng bị chặn", async ({ page }) => {
      await mock(page, "anon");
      await page.goto(`/${l}`);
      await page.evaluate(() => localStorage.setItem("sqllens.guestRuns", "2"));
      await page.reload();
      let fail = true;
      await page.route(/.wasm/, (r) => (fail ? r.abort() : r.continue()));
      // lượt đã hết nên bị chặn ngay ở lần Chạy; dùng lượt còn 1 để vào được lỗi tải
      await page.evaluate(() => localStorage.setItem("sqllens.guestRuns", "1"));
      await page.reload();
      await run(page, l, "SELECT 1");
      await expect(page.locator([data-testid=error]:visible)).toBeVisible({ timeout: 60_000 });
      await page.evaluate(() => localStorage.setItem("sqllens.guestRuns", "2")); // tab khác dùng nốt lượt
      fail = false;
      await page.getByRole("button", { name: l === "vi" ? "Thử lại" : "Retry" }).click();
      await expect(page.getByTestId("guest-limit")).toBeVisible();
      await expect(done(page)).toHaveCount(0);
    });

    test("AC6 đã đăng nhập: các tab mở, không còn giới hạn lượt", async ({ page }) => {
      await mock(page, "user");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${l}`);
      await run(page, l, "CREATE TABLE t(id int PRIMARY KEY, v int); SELECT * FROM t;");
      await expect(done(page)).toBeVisible({ timeout: 60_000 });
      for (const name of t.tabs) {
        await stageTab(page, name).click();
        await expect(page.getByTestId("locked-tab")).toHaveCount(0);
      }
      await expect(page.getByTestId("guest-note")).toHaveCount(0);
    });

    test("ca biên: localStorage bị chặn thì đếm trong bộ nhớ của tab", async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
      });
      await mock(page, "anon");
      await page.goto(`/${l}`);
      for (const n of [2, 1]) {
        await expect(left(page)).toContainText(t.left(n));
        await run(page, l, `SELECT ${n} AS a`);
        await expect(left(page)).toContainText(t.left(n - 1), { timeout: 60_000 });
      }
      await run(page, l, "SELECT 3 AS a");
      await expect(page.getByTestId("guest-limit")).toBeVisible();
    });

    test("ca biên: SQL rất dài khi lưu tạm lỗi thì báo, không mất SQL", async ({ page }) => {
      await page.addInitScript(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k: string, v: string) {
          if (k === "sqllens.sqlStash") throw new DOMException("full", "QuotaExceededError");
          return set.call(this, k, v);
        };
      });
      await mock(page, "anon");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${l}`);
      await setSql(page, "SELECT 'x' AS keep_long");
      await page.getByRole("link", { name: t.signIn, exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: /chặn lưu tạm|blocks temporary storage/ })).toBeVisible();
      await expect(page).not.toHaveURL(/login/);
      expect(await sqlText(page)).toContain("keep_long");
    });

    test("ca biên: xóa localStorage giữa chừng thì số lượt đếm lại từ đầu, không lỗi", async ({ page }) => {
      await mock(page, "anon");
      await page.goto(`/${l}`);
      await run(page, l, "SELECT 1 AS a");
      await expect(left(page)).toContainText(t.left(1), { timeout: 60_000 });
      await page.evaluate(() => localStorage.clear());
      await run(page, l, "SELECT 2 AS a");
      await expect(done(page)).toBeVisible({ timeout: 60_000 });
      await expect(left(page)).toContainText(t.left(1));
    });
  });
}

test("ca biên: đăng xuất khi đang ở lab thì quay lại là khách, tab khóa lại", async ({ page }) => {
  const s = await mock(page, "user");
  await page.route("**/api/auth/logout", (r) => ((s.user = false), r.fulfill({ status: 204 })));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/vi");
  await run(page, "vi", "CREATE TABLE t(id int PRIMARY KEY); SELECT * FROM t;");
  await expect(done(page)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Tài khoản của An" }).click();
  await page.getByRole("menuitem", { name: "Đăng xuất" }).click();
  await stageTab(page, "B-Tree").click();
  await expect(page.getByTestId("locked-tab").filter({ visible: true })).toBeVisible();
});

test("ca biên: /login?next= rỗng dùng trang chủ", async ({ page }) => {
  await mock(page, "anon");
  await page.goto("/en/login?next=");
  await expect(page.getByRole("link", { name: T.en.google })).toHaveAttribute("href", /start\?next=%2Fen%2Flogin%3Fnext%3D%252Fen$/);
});

test("ca biên: hai tab cùng lúc, tab kia dùng hết lượt thì tab này thấy số lượt giảm", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  await mock(a, "anon");
  await mock(b, "anon");
  await a.goto("/vi");
  await b.goto("/vi");
  await expect(left(a)).toContainText("Còn 2/2");
  await run(b, "vi", "SELECT 1 AS a");
  await expect(left(b)).toContainText("Còn 1/2", { timeout: 60_000 });
  await expect(left(a)).toContainText("Còn 1/2"); // sự kiện storage
  await ctx.close();
});
