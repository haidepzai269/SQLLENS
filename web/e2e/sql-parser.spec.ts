import { expect, test, type Page } from "@playwright/test";

type Out = { ok: boolean; statements?: { kind: string; start: number; end: number; tables: string[] }[]; error?: { message: string; position?: number; line?: number; column?: number } };
declare global {
  interface Window {
    parseSql(sql: string, engine: "postgres" | "mysql"): Promise<Out>;
    disposeParser(): void;
  }
}

async function open(page: Page) {
  await page.goto("/en/e2e-parser");
  await page.waitForFunction(() => typeof window.parseSql === "function");
}
const parse = (page: Page, sql: string, engine: "postgres" | "mysql") =>
  page.evaluate(([s, e]) => window.parseSql(s, e as "postgres" | "mysql"), [sql, engine]);

test("AC1 chỉ tải parser của engine được gọi", async ({ page }) => {
  const reqs: string[] = [];
  page.on("request", (r) => reqs.push(r.url()));
  await open(page);
  const heavy = () => reqs.filter((u) => /\.wasm|pgsql|libpg|sql-parser/i.test(u));
  expect(heavy()).toEqual([]);
  expect((await parse(page, "SELECT 1", "mysql")).ok).toBe(true);
  expect(reqs.some((u) => u.endsWith(".wasm"))).toBe(false);
  const afterMysql = reqs.length;
  expect((await parse(page, "SELECT 1", "postgres")).ok).toBe(true);
  const added = reqs.slice(afterMysql).filter((u) => /wasm/i.test(u));

  expect(added.length).toBeGreaterThan(0);
  expect(added.some((u) => u.includes("/media/libpg-query"))).toBe(true);
  expect(added.length).toBeLessThanOrEqual(2); // thêm một lần fetch thất bại vào /chunks/, xem bàn giao
});

test("AC1b mysql không tải wasm của postgres", async ({ page }) => {
  const wasm: string[] = [];
  page.on("request", (r) => r.url().includes(".wasm") && wasm.push(r.url()));
  await open(page);
  await parse(page, "SELECT 1", "mysql");
  expect(wasm).toEqual([]);
});

test("AC2 AC3 AC5 trên trình duyệt thật", async ({ page }) => {
  await open(page);
  const sql = "-- tiếng Việt\nSELECT 'đường'; SELECT * FROM public.t JOIN u ON t.id = u.id";
  for (const e of ["postgres", "mysql"] as const) {
    const r = await parse(page, sql, e);
    expect(r.statements?.map((s) => [s.kind, sql.slice(s.start, s.end)])).toEqual([
      ["select", "SELECT 'đường'"],
      ["select", "SELECT * FROM public.t JOIN u ON t.id = u.id"],
    ]);
  }
  expect((await parse(page, "SELEC 1", "postgres")).error).toMatchObject({ position: 0, line: 1, column: 1 });
  const bad = "SELECT 1;\nSELECT 'é';\nSELECT * FORM t";
  expect((await parse(page, bad, "postgres")).error).toMatchObject({ position: bad.indexOf("FORM"), line: 3, column: 10 });
});

test("AC4 FORCE INDEX trả ok false, không ném", async ({ page }) => {
  await open(page);
  const r = await parse(page, "SELECT * FROM t FORCE INDEX (i)", "mysql");
  expect(r.ok).toBe(false);
  expect(r.error?.message).toBeTruthy();
});

test("AC6 SQL 1 MB không chặn khung hình quá 200 ms", async ({ page }) => {
  await open(page);
  await parse(page, "SELECT 1", "postgres");
  const res = await page.evaluate(async () => {
    const stmt = "INSERT INTO t (a, b) VALUES (1, 'xin chào thế giới');\n";
    const sql = stmt.repeat(Math.ceil(1_000_000 / stmt.length));
    let last = performance.now();
    let maxGap = 0;
    let run = true;
    const tick = () => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
      if (run) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const t0 = performance.now();
    const out = await window.parseSql(sql, "postgres");
    const ms = performance.now() - t0;
    run = false;
    return { ok: out.ok, n: out.statements?.length, ms, maxGap, len: sql.length };
  });
  console.log("AC6 1MB parse:", JSON.stringify(res));
  expect(res.ok).toBe(true);
  expect(res.maxGap).toBeLessThan(200);
});

test("AC7 parser không tải được thì báo lỗi, gọi lại thì tải lại", async ({ page }) => {
  await open(page);
  let block = true;
  await page.route(/libpg-query.*\.wasm/, (route) => (block ? route.abort() : route.continue()));
  const first = await parse(page, "SELECT 1", "postgres");
  expect(first.ok).toBe(false);
  expect(first.error?.message).toMatch(/load/i);
  block = false;
  expect((await parse(page, "SELECT 1", "postgres")).ok).toBe(true);
});

test("AC8 hai lần gọi liên tiếp trả đúng kết quả từng lần", async ({ page }) => {
  await open(page);
  await parse(page, "SELECT 1", "mysql");
  const r = await page.evaluate(async () => {
    const big = "SELECT 1;\n".repeat(20000);
    const slow = window.parseSql(big, "mysql"); // xong sau
    const fast = window.parseSql("DELETE FROM x", "mysql");
    const [a, b] = await Promise.all([slow, fast]);
    return [a.statements?.length, b.statements?.[0].kind];
  });
  expect(r).toEqual([20000, "delete"]);
});
