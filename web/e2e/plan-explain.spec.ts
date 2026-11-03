import { expect, test } from "@playwright/test";

// Dùng khai báo window.createPostgresAdapter của postgres-worker.spec.ts; ở đây chỉ cần kiểu hẹp.
type X = {
  execute(sql: string): Promise<{ rows: unknown[][] }[]>;
  explain(sql: string): Promise<{ kind: string; label?: string; reasonKey?: string; data?: { analyzed: boolean; root: { kind: string; index?: string; table?: string; pagesRead?: number } } }>;
  history(): string[];
  dispose(): Promise<void>;
};

test("Task046: explain trong worker thật, UPDATE không đổi dữ liệu và history", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/en/e2e-adapter");
  await page.waitForFunction(() => typeof (window as unknown as { createPostgresAdapter?: unknown }).createPostgresAdapter === "function");
  const out = await page.evaluate(async () => {
    const a = (await (window as unknown as { createPostgresAdapter(): Promise<X> }).createPostgresAdapter()) as X;
    const sum = async () => (await a.execute("SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM t t")).at(-1)!.rows[0][0];
    await a.execute("CREATE TABLE t(id int primary key, v int)");
    await a.execute("INSERT INTO t SELECT g, g % 10 FROM generate_series(1, 10000) g");
    await a.execute("ANALYZE t");
    const hist = a.history().length;
    const before = await sum();
    const hist2 = a.history().length;
    const idx = await a.explain("SELECT * FROM t WHERE id = 1");
    const seq = await a.explain("SELECT * FROM t WHERE v = 3");
    const upd = await a.explain("UPDATE t SET v = 99");
    const multi = await a.explain("SELECT 1; SELECT 2");
    let err = "";
    try {
      await a.explain("SELEC 1");
    } catch (e) {
      err = (e as { code: string }).code;
    }
    const after = await sum();
    return { before, after, hist2, histAfter: a.history().length, idx, seq, upd, multi, err };
  });
  expect(out.idx.label).toBe("real");
  expect(["index_scan", "index_only_scan"]).toContain(out.idx.data!.root.kind);
  expect(out.seq.data!.root.kind).toBe("seq_scan");
  expect(out.seq.data!.root.pagesRead!).toBeGreaterThan(out.idx.data!.root.pagesRead!);
  expect(out.upd.kind).toBe("conclusion");
  expect(out.multi.kind).toBe("not_simulated");
  expect(out.err).toBe("sql");
  expect(out.after).toBe(out.before);
  expect(out.histAfter).toBe(out.hist2 + 1); // chỉ lần sum() thứ hai vào history, explain không
});
