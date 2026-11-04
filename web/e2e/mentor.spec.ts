import { expect, test, type Page } from "@playwright/test";

// /api/ai/chat giả: stream điều khiển được bằng tay (fetch ghi đè trong trang) hoặc page.route. Không gọi model thật.
const SHOTS = "../_bmad-output/SP012/STR056/Task061";
const SELECT = "SELECT * FROM orders WHERE customer_id = 42";
const INDEX = "CREATE INDEX ON orders(customer_id)";
const err = (code: string, key: string) => JSON.stringify({ error: { code, messageKey: `error.${key}` } });
const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const delta = (text: string) => sse({ type: "delta", text });
const fence = (sql: string) => "```sql\n" + sql + "\n```\n";

type Rec = { push(s: string): void; close(): void; aborted: boolean };
type Win = { __s: { reqs: Rec[] }; __xss?: number; mentor: { stats: Record<string, number>; checksum(): Promise<string>; indexCount(): Promise<number> } };

async function setup(page: Page, user = true, pass = false) {
  await page.addInitScript((passThrough) => {
    const orig = window.fetch;
    const s = { reqs: [] as unknown[] };
    (window as unknown as { __s: unknown }).__s = s;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith("/api/ai/chat") || passThrough) return orig(input, init);
      const enc = new TextEncoder();
      let ctrl!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) });
      const rec = {
        push: (x: string) => ctrl.enqueue(enc.encode(x)),
        close: () => { try { ctrl.close(); } catch { /* panel đã đóng sau done */ } },
        aborted: false,
      };
      init?.signal?.addEventListener("abort", () => {
        rec.aborted = true;
        try { ctrl.error(new DOMException("a", "AbortError")); } catch { /* đã đóng */ }
      });
      s.reqs.push(rec);
      return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    };
  }, pass);
  let loggedIn = user;
  await page.route("**/api/me", (r) =>
    loggedIn
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "1", name: "An", provider: "google" }) })
      : r.fulfill({ status: 401, contentType: "application/json", body: err("auth_required", "authRequired") }),
  );
  await page.route("**/api/auth/*/start*", (r) => {
    loggedIn = true;
    return r.fulfill({ status: 302, headers: { location: new URL(r.request().url()).searchParams.get("next") ?? "/" } });
  });
}
const open = async (p: Page, l = "en") => {
  await p.goto(`/${l}/e2e-mentor`);
  await p.getByTestId("mentor-question").waitFor({ timeout: 90_000 });
  await p.waitForFunction(() => (window as unknown as { mentor?: unknown }).mentor !== undefined);
};
const ask = async (p: Page, q: string) => {
  await p.getByTestId("mentor-question").fill(q);
  await p.getByTestId("mentor-send").click();
};
const rec = (p: Page, i = 0) => p.waitForFunction((n) => (window as unknown as Win).__s.reqs.length > n, i);
const push = (p: Page, s: string, i = 0) => p.evaluate(([x, n]) => (window as unknown as Win).__s.reqs[n as number].push(x as string), [s, i]);
const close = (p: Page, i = 0) => p.evaluate((n) => (window as unknown as Win).__s.reqs[n].close(), i);
const aborted = (p: Page, i = 0) => p.evaluate((n) => (window as unknown as Win).__s.reqs[n].aborted, i);
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const stats = (p: Page) => p.evaluate(() => (window as unknown as Win).mentor.stats);
const snap = (p: Page) => p.evaluate(async () => { const m = (window as unknown as Win).mentor; return { sum: await m.checksum(), idx: await m.indexCount() }; });
const phase = (p: Page, ph: string, timeout = 60_000) => expect(p.getByTestId("mentor-turn")).toHaveAttribute("data-phase", ph, { timeout });

test.describe("Task061: AI Mentor", () => {
  test.setTimeout(120_000);

  test("AC1: chưa đăng nhập được mời đăng nhập, quay lại không mất câu hỏi, chưa gửi gì", async ({ page }) => {
    await setup(page, false, true);
    let calls = 0;
    await page.route("**/api/ai/chat", (r) => { calls++; return r.abort(); });
    await open(page);
    await page.getByTestId("mentor-question").fill("Why so slow?");
    await page.getByTestId("mentor-send").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("link", { name: /Google/ }).click();
    await page.getByTestId("mentor-question").waitFor({ timeout: 90_000 });
    await expect(page.getByTestId("mentor-question")).toHaveValue("Why so slow?");
    expect(calls).toBe(0);
  });

  test("AC2, AC3, AC4: stream dần, SQL chỉ hiện sau chạy thử, cảnh báo, Áp dụng mở so sánh không commit", async ({ page }) => {
    await setup(page);
    await open(page);
    const before = await snap(page);
    await ask(page, "Fix it?");
    await rec(page);
    await push(page, delta("Try this:\n"));
    await phase(page, "streaming");
    await push(page, delta("```sql\n" + SELECT));
    await expect(page.getByTestId("mentor-sql-pending")).toBeVisible();
    await expect(page.getByTestId("mentor-answer")).not.toContainText("customer_id");
    await push(page, delta("\n```\nThen\n"));
    await push(page, delta(fence(INDEX) + fence("DROP TABLE orders") + "It reads 73 pages. The design is fine."));
    await expect(page.getByTestId("mentor-answer")).not.toContainText("DROP");
    await expect(page.getByTestId("mentor-answer")).not.toContainText("CREATE INDEX");
    await push(page, sse({ type: "done" }));
    await close(page);
    await phase(page, "done");
    await expect(page.getByTestId("mentor-sql-ok")).toHaveCount(2);
    await expect(page.getByTestId("mentor-label")).toHaveText(["Real", "Real"]);
    await expect(page.getByTestId("mentor-pages")).toHaveCount(2);
    await expect(page.getByTestId("mentor-sql-hidden")).toHaveCount(1);
    await expect(page.getByTestId("mentor-answer")).not.toContainText("DROP");
    await expect(page.getByTestId("mentor-unknown-numbers")).toContainText("73");
    await expect(page.getByTestId("mentor-banned")).toContainText("design is fine");
    // AC4
    await page.getByTestId("mentor-apply").nth(1).click();
    await expect(page.getByTestId("whatif")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText(INDEX);
    await expect(page.getByTestId("whatif-result")).toHaveCount(0);
    await page.getByTestId("whatif-run").click();
    await expect(page.getByTestId("whatif-result")).toBeVisible({ timeout: 60_000 });
    expect(await snap(page)).toEqual(before);
    expect(await page.getByTestId("mentor").innerText()).not.toMatch(/\d\s?ms\b|execution time/i);
  });

  test("AC5: HTML và liên kết trong câu trả lời chỉ là chữ, không chạy, không gọi mạng", async ({ page }) => {
    await setup(page);
    const hits: string[] = [];
    page.on("request", (r) => { if (r.url().includes("evil.example")) hits.push(r.url()); });
    await page.route("**/evil.example/**", (r) => { hits.push(r.request().url()); return r.abort(); });
    await open(page);
    await ask(page, "x");
    await rec(page);
    const bad = '<img src=x onerror="window.__xss=1"> [click](http://evil.example/x) <a href="http://evil.example/y">y</a> <script>window.__xss=2</script> http://evil.example/z';
    await push(page, delta(bad) + sse({ type: "done" }));
    await close(page);
    await phase(page, "done");
    await expect(page.getByTestId("mentor-text")).toContainText("<img src=x onerror");
    await expect(page.getByTestId("mentor-answer").locator("img, a, script")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as Win).__xss)).toBeUndefined();
    expect(hits).toEqual([]);
  });

  test("AC6: 401, 429 có Retry-After, 503, đứt giữa stream, sự kiện error", async ({ page }) => {
    await setup(page, true, true);
    let mode = "401";
    await page.route("**/api/ai/chat", (r) => {
      if (mode === "401") return r.fulfill({ status: 401, contentType: "application/json", body: err("auth_required", "authRequired") });
      if (mode === "429") return r.fulfill({ status: 429, headers: { "Retry-After": "7" }, contentType: "application/json", body: err("rate_limited", "rateLimited") });
      if (mode === "503") return r.fulfill({ status: 503, contentType: "application/json", body: err("ai_unavailable", "aiUnavailable") });
      if (mode === "cut") return r.fulfill({ status: 200, contentType: "text/event-stream", body: delta("Partial answer") });
      return r.fulfill({ status: 200, contentType: "text/event-stream", body: delta("Partial answer") + sse({ type: "error", messageKey: "error.aiTooLong" }) });
    });
    await open(page);
    const kind = (k: string) => expect(page.getByTestId("mentor-error")).toHaveAttribute("data-kind", k);
    await ask(page, "q");
    await kind("auth");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // 401 đưa trạng thái về anon, nên tải lại (cookie giả vẫn còn) trước khi thử các lỗi khác.
    mode = "429";
    await page.reload();
    await page.getByTestId("mentor-question").waitFor({ timeout: 90_000 });
    await ask(page, "q");
    await kind("limit");
    await expect(page.getByTestId("mentor-retry")).toContainText("7");
    mode = "503";
    await page.getByTestId("mentor-send").click();
    await kind("unavailable");
    mode = "cut";
    await page.getByTestId("mentor-send").click();
    await kind("interrupted");
    await expect(page.getByTestId("mentor-incomplete")).toBeVisible();
    await expect(page.getByTestId("mentor-text")).toHaveText("Partial answer");
    mode = "event";
    await page.getByTestId("mentor-send").click();
    await kind("tooLong");
    await expect(page.getByTestId("mentor-incomplete")).toBeVisible();
  });

  test("AC6: nút dừng hủy yêu cầu đang stream và cả bước chạy thử", async ({ page }) => {
    await setup(page);
    await open(page);
    await ask(page, "q");
    await rec(page);
    await push(page, delta("Partial"));
    await expect(page.getByTestId("mentor-text")).toHaveText("Partial");
    await page.getByTestId("mentor-stop").click();
    await phase(page, "stopped");
    expect(await aborted(page)).toBe(true);
    await expect(page.getByTestId("mentor-incomplete")).toBeVisible();
    expect((await stats(page)).cancels).toBe(0);
    // dừng giữa lúc chạy thử
    await page.getByTestId("mentor-send").click();
    await rec(page, 1);
    await push(page, delta(fence(`${SELECT} -- hang`)) + sse({ type: "done" }), 1);
    await phase(page, "verifying");
    await page.getByTestId("mentor-stop").click();
    await phase(page, "stopped");
    await expect.poll(async () => (await stats(page)).rebuilds, { timeout: 60_000 }).toBe(1);
    expect((await stats(page)).cancels).toBe(1);
    await expect(page.getByTestId("mentor-sql-ok")).toHaveCount(0);
  });

  test("Ca biên: hai câu liên tiếp, trả lời rỗng, quá 2.000 ký tự, tải lại giữa chừng", async ({ page }) => {
    await setup(page);
    await open(page);
    await ask(page, "first");
    await rec(page);
    await push(page, delta("OLD"));
    await page.getByTestId("mentor-question").fill("second");
    await page.getByTestId("mentor-send").click();
    await rec(page, 1);
    expect(await aborted(page, 0)).toBe(true);
    await push(page, delta("NEW") + sse({ type: "done" }), 1);
    await close(page, 1);
    await phase(page, "done");
    await expect(page.getByTestId("mentor-asked")).toHaveText("second");
    await expect(page.getByTestId("mentor-answer")).not.toContainText("OLD");
    await expect(page.getByTestId("mentor-text")).toHaveText("NEW");
    // rỗng
    await page.getByTestId("mentor-send").click();
    await rec(page, 2);
    await push(page, sse({ type: "done" }), 2);
    await close(page, 2);
    await expect(page.getByTestId("mentor-empty-answer")).toBeVisible({ timeout: 60_000 });
    // dài quá
    await page.getByTestId("mentor-question").fill("a".repeat(2001));
    await expect(page.getByTestId("mentor-send")).toBeDisabled();
    await expect(page.getByTestId("mentor-count")).toContainText("2001");
    await page.getByTestId("mentor-question").fill("a".repeat(2000));
    await expect(page.getByTestId("mentor-send")).toBeEnabled();
    // tải lại giữa chừng
    await page.getByTestId("mentor-send").click();
    await rec(page, 3);
    await push(page, delta("half"), 3);
    await page.reload();
    await page.getByTestId("mentor-question").waitFor({ timeout: 90_000 });
    await expect(page.getByTestId("mentor-empty")).toBeVisible();
  });

  for (const locale of ["vi", "en"]) {
    test(`Giao diện ${locale}: không cuộn ngang ở 390 và 1440, ảnh chụp`, async ({ page }) => {
      await setup(page);
      await open(page, locale);
      await ask(page, "Vì sao truy vấn này đọc nhiều trang? ".repeat(8));
      await rec(page);
      await push(page, delta("Tạo index trên customer_id, khoảng 73 trang: https://example.invalid/" + "x".repeat(120) + "\n" + fence(INDEX) + fence("DROP TABLE orders") + "The design is fine.") + sse({ type: "done" }));
      await close(page);
      await phase(page, "done");
      await expect(page.getByTestId("mentor-sql-ok")).toHaveCount(1);
      for (const [w, h] of [[1440, 900], [390, 844]]) {
        await page.setViewportSize({ width: w, height: h });
        expect(await noHScroll(page)).toBe(true);
        await page.getByTestId("mentor-apply").scrollIntoViewIfNeeded(); // 390 px: ảnh phải thấy khối SQL đã chạy thử
        await page.screenshot({ path: `${SHOTS}/anh-${locale}-${w}.png`, fullPage: false });
      }
    });
  }
});
