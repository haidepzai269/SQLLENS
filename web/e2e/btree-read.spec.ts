import { expect, test } from "@playwright/test";

type Node = { page: number; level: number; keys: string[]; totalKeys: number };
type R = {
  model: { kind: string; reasonKey?: string; data?: { height: number; rootPage: number; totalPages: number; nodes: Node[]; hidden: { level: number; count: number }[] } };
  path?: { pages: number[]; heapPage?: number };
};
type A = {
  execute(sql: string): Promise<{ rows: unknown[][] }[]>;
  readBTree(i: string, o?: { probeKey?: string; maxNodes?: number }): Promise<R>;
  history(): string[];
};
type W = { createPostgresAdapter(o?: { timeoutMs?: number }): Promise<A>; b: A };

async function load(page: import("@playwright/test").Page, rows: number) {
  await page.goto("/en/e2e-adapter");
  await page.waitForFunction(() => typeof (window as unknown as W).createPostgresAdapter === "function");
  await page.evaluate(async (n) => {
    (window as unknown as W).b = await (window as unknown as W).createPostgresAdapter({ timeoutMs: 60_000 });
    await (window as unknown as W).b.execute(`CREATE TABLE t(id int primary key, v int); INSERT INTO t SELECT g, g FROM generate_series(1, ${n}) g; CREATE INDEX t_v ON t(v)`);
  }, rows);
}

test("Task039 AC1 + AC2 + AC6: 100k dòng đọc qua adapter thật", async ({ page }) => {
  test.setTimeout(120_000);
  await load(page, 100_000);
  const out = await page.evaluate(async () => {
    const b = (window as unknown as W).b;
    const hist = b.history().length;
    const r = await b.readBTree("t_pkey", { probeKey: "54321", maxNodes: 1000 });
    const meta = (await b.execute("SELECT 1"))[0].rows; // vẫn chạy được sau khi đọc
    const ctid = String((await b.execute("SELECT ctid::text FROM t WHERE id = 54321"))[0].rows[0][0]);
    const who = String((await b.execute("SELECT current_user"))[0].rows[0][0]);
    return { r, ctid, who, meta, histDelta: b.history().length - hist - 3 };
  });
  const d = out.r.model.data!;
  expect(out.r.model.kind).toBe("conclusion");
  expect(d.height).toBe(out.r.path!.pages.length);
  expect(out.r.path!.pages[0]).toBe(d.rootPage);
  expect(out.r.path!.heapPage).toBe(Number(/\((\d+),/.exec(out.ctid)![1]));
  for (const n of d.nodes.filter((x) => x.level === 0)) {
    const k = n.keys.map(Number);
    expect(k).toEqual([...k].sort((a, b) => a - b));
  }
  expect(out.who).toBe("sqllens_user");
  expect(out.histDelta).toBe(0); // chỉ ba execute của chính test, readBTree không vào history
});

test("Task039 AC3 + AC5: 500k dòng, đọc dưới 1 giây, phần còn lại vào hidden", async ({ page }) => {
  test.setTimeout(180_000);
  await load(page, 500_000);
  const out = await page.evaluate(async () => {
    const b = (window as unknown as W).b;
    const t0 = performance.now();
    const r = await b.readBTree("t_pkey", { probeKey: "54321" });
    const ms = performance.now() - t0;
    const bad = await Promise.all(["t_hash_nope", "t", "x'; DROP TABLE t; --"].map((n) => b.readBTree(n)));
    const cnt = Number((await b.execute("SELECT count(*) FROM t"))[0].rows[0][0]);
    return { r, ms, bad: bad.map((x) => x.model.reasonKey), cnt };
  });
  console.log(`Task039 AC3: readBTree 500k dòng mất ${Math.round(out.ms)} ms`);
  const d = out.r.model.data!;
  expect(out.ms).toBeLessThan(1000);
  expect(d.nodes.length + d.hidden.reduce((a, h) => a + h.count, 0)).toBe(d.totalPages - 1);
  expect(d.hidden.length).toBeGreaterThan(0);
  expect(out.r.path!.pages).toHaveLength(d.height);
  expect(out.bad).toEqual(["btreeRead.notFound", "btreeRead.notIndex", "btreeRead.notFound"]);
  expect(out.cnt).toBe(500_000);
});
