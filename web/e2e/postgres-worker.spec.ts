import { expect, test, type Page } from "@playwright/test";

type A = {
  execute(sql: string): Promise<{ rows: unknown[][] }[]>;
  cancel(): Promise<void>;
  rebuild(): Promise<void>;
  history(): string[];
  dispose(): Promise<void>;
};
declare global {
  interface Window {
    createPostgresAdapter(o?: { onProgress?: (p: { phase: string }) => void; timeoutMs?: number }): Promise<A>;
    a: A;
  }
}

// Lỗi qua page.evaluate mất class, nên trả về { code } để assert.
const code = `(e) => e && e.code`;
async function open(page: Page) {
  await page.goto("/en/e2e-adapter");
  await page.waitForFunction(() => typeof window.createPostgresAdapter === "function");
}
const make = (page: Page, timeoutMs = 30_000) =>
  page.evaluate(async (t) => {
    window.a = await window.createPostgresAdapter({ timeoutMs: t });
  }, timeoutMs);

test("AC1 tải trong worker, có progress download và init", async ({ page }) => {
  const wasm: string[] = [];
  page.on("request", (r) => /\.wasm/.test(r.url()) && wasm.push(r.url()));
  await open(page);
  expect(wasm).toEqual([]);
  const phases = await page.evaluate(async () => {
    const seen: string[] = [];
    window.a = await window.createPostgresAdapter({ onProgress: (p) => seen.push(p.phase) });
    return seen;
  });
  expect(phases).toContain("download");
  expect(phases).toContain("init");
  expect(wasm.length).toBeGreaterThan(0);
  expect(page.workers().length).toBe(1);
});

test("AC2 câu nặng không chặn main thread", async ({ page }) => {
  await open(page);
  await make(page, 120_000);
  const maxGap = await page.evaluate(async () => {
    let last = performance.now();
    let max = 0;
    let stop = false;
    const tick = (t: number) => {
      max = Math.max(max, t - last);
      last = t;
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await window.a.execute("SELECT count(*) FROM generate_series(1, 30000000)");
    stop = true;
    return max;
  });
  expect(maxGap).toBeLessThan(200);
});

test("AC3/4/5 timeout, cancel, rebuild, history", async ({ page }) => {
  await open(page);
  await make(page, 2000);
  await page.evaluate(() => window.a.execute("CREATE TABLE t(id int); INSERT INTO t SELECT generate_series(1,1000)"));
  // lỗi SQL giữ thông báo, không vào history
  const sqlErr = await page.evaluate(async (c) => window.a.execute("SELEC 1").catch(eval(c)), code);
  expect(sqlErr).toBe("sql");
  // timeout
  const t0 = Date.now();
  expect(await page.evaluate(async (c) => window.a.execute("SELECT pg_sleep(60)").catch(eval(c)), code)).toBe("timeout");
  expect(Date.now() - t0).toBeLessThan(3000); // timeoutMs 2s + dư; AC: sát thời điểm hết hạn
  // execute trước rebuild báo lỗi rõ
  expect(await page.evaluate(async (c) => window.a.execute("SELECT 1").catch(eval(c)), code)).toBe("worker_crashed");
  await page.evaluate(() => window.a.rebuild());
  expect(await page.evaluate(async () => (await window.a.execute("SELECT count(*)::int FROM t"))[0].rows[0][0])).toBe(1000);
  // cancel giữa chừng
  const c0 = Date.now();
  const res = await page.evaluate(async (c) => {
    const p = window.a.execute("SELECT pg_sleep(60)").catch(eval(c));
    await new Promise((r) => setTimeout(r, 300));
    await window.a.cancel();
    return p;
  }, code);
  expect(res).toBe("cancelled");
  expect(Date.now() - c0).toBeLessThan(1500);
  await page.evaluate(() => window.a.rebuild());
  expect(await page.evaluate(() => window.a.history())).toEqual([
    "CREATE TABLE t(id int); INSERT INTO t SELECT generate_series(1,1000)",
    "SELECT count(*)::int FROM t",
  ]);
});

test("ca biên: hai execute liên tiếp chạy đúng thứ tự, SQL vài MB", async ({ page }) => {
  await open(page);
  await make(page);
  const out = await page.evaluate(async () => {
    const big = "SELECT 1 /*" + "x".repeat(3_000_000) + "*/ AS n";
    const [a, b, c] = await Promise.all([
      window.a.execute("CREATE TABLE s(v int); INSERT INTO s VALUES (1)"),
      window.a.execute("INSERT INTO s VALUES (2); SELECT v FROM s ORDER BY v"),
      window.a.execute(big),
    ]);
    return [b[1].rows.length, c[0].rows[0][0], a.length];
  });
  expect(out).toEqual([2, 1, 2]);
});

test("AC6 tải WASM lỗi trả load_failed, gọi lại thì thành công", async ({ page }) => {
  let fail = true;
  await page.route(/\.wasm/, (route) => (fail ? route.abort() : route.continue()));
  await open(page);
  const err = await page.evaluate(async (c) => window.createPostgresAdapter().catch(eval(c)), code);
  expect(err).toBe("load_failed");
  fail = false;
  await make(page);
  expect(await page.evaluate(async () => (await window.a.execute("SELECT 1"))[0].rows[0][0])).toBe(1);
});

test("AC7 dispose dừng worker", async ({ page }) => {
  await open(page);
  await make(page);
  expect(page.workers().length).toBe(1);
  const closed = new Promise<void>((r) => page.workers()[0].on("close", () => r()));
  await page.evaluate(() => window.a.dispose());
  await closed;
  expect(page.workers().length).toBe(0);
});
