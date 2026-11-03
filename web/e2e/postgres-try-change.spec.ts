import { expect, test } from "@playwright/test";

// Dùng khai báo window.a / createPostgresAdapter của postgres-worker.spec.ts.
type T = { tryChange(c: string, p: string): Promise<{ kind: string; data?: { before: { nodeTypes: string[] }; after: { nodeTypes: string[] } } }> };

test("Task025: tryChange trong worker thật, timeout rồi rebuild thì dữ liệu như trước", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/en/e2e-adapter");
  await page.waitForFunction(() => typeof window.createPostgresAdapter === "function");
  const out = await page.evaluate(async () => {
    const a = (await window.createPostgresAdapter({ timeoutMs: 5000 })) as unknown as Window["a"] & T;
    const sum = async () => (await a.execute("SELECT md5(string_agg(t::text, '' ORDER BY id)), (SELECT count(*) FROM pg_indexes WHERE tablename='orders') FROM orders t")).at(-1)!.rows[0].join();
    await a.execute("CREATE TABLE orders(id int primary key, customer_id int)");
    await a.execute("INSERT INTO orders SELECT g, g % 1000 FROM generate_series(1, 20000) g");
    await a.execute("ANALYZE orders");
    const before = await sum();
    const ok = await a.tryChange("CREATE INDEX ON orders(customer_id)", "SELECT * FROM orders WHERE customer_id = 42");
    const afterOk = await sum();
    let code = "";
    try {
      await a.tryChange("CREATE TABLE zz AS SELECT g FROM generate_series(1, 300000000) g", "SELECT 1");
    } catch (e) {
      code = (e as { code: string }).code;
    }
    await a.rebuild();
    const afterRebuild = await sum();
    const hist = a.history().length;
    return { before, afterOk, afterRebuild, code, ok, hist };
  });
  expect(out.ok, JSON.stringify(out.ok).slice(0, 150)).toMatchObject({ kind: "conclusion" });
  expect(out.ok.data!.before.nodeTypes).toContain("Seq Scan");
  expect(out.afterOk).toBe(out.before);
  expect(out.code).toBe("timeout");
  expect(out.afterRebuild).toBe(out.before);
  expect(out.hist).toBe(6); // 3 câu dựng + 3 lần đo checksum, tryChange không vào history
});
