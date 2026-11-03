import { expect, test } from "@playwright/test";

// Dùng khai báo window.a / createPostgresAdapter của postgres-worker.spec.ts.
// Lỗi qua page.evaluate mất class, nên trả về { code, guard }.
const run = (page: import("@playwright/test").Page, sql: string) =>
  page.evaluate(async (q) => {
    try {
      return { rows: (await window.a.execute(q)).at(-1)?.rows };
    } catch (e) {
      const x = e as { code: string; guard?: unknown };
      return { code: x.code, guard: x.guard };
    }
  }, sql);

test("Task021: role quyền thấp, lớp một, lớp hai và dựng lại trong worker thật", async ({ page }) => {
  await page.goto("/en/e2e-adapter");
  await page.waitForFunction(() => typeof window.createPostgresAdapter === "function");
  await page.evaluate(async () => {
    window.a = await window.createPostgresAdapter();
  });

  expect(await run(page, "SELECT current_user")).toEqual({ rows: [["sqllens_user"]] });
  await run(page, "CREATE TABLE t(id int primary key)");
  await run(page, "INSERT INTO t VALUES (1)");

  // Lớp một: bị chặn, báo đúng số câu.
  expect(await run(page, "SELECT 1; RESET ROLE")).toMatchObject({
    code: "sql",
    guard: { reasonKey: "guard.role", statementIndex: 2 },
  });
  expect(await run(page, "SELECT current_user")).toEqual({ rows: [["sqllens_user"]] });

  // pageinspect: người dùng bị từ chối.
  expect((await run(page, "SELECT * FROM bt_metap('t_pkey')")).code).toBe("sql");

  // Lớp hai: DO + EXECUTE qua mặt parser, phiên được dựng lại từ history, dữ liệu cũ còn.
  const r = await run(page, "DO $$ BEGIN EXECUTE 'SET ROLE postgres'; END $$;");
  expect(r).toMatchObject({ code: "sql", guard: { reasonKey: "guard.escaped", rebuilt: true } });
  expect(await run(page, "SELECT current_user, (SELECT count(*)::int FROM t)")).toEqual({ rows: [["sqllens_user", 1]] });
  expect(await run(page, "SELECT set_config('role', 'postgres', false)")).toMatchObject({ code: "sql" });
  expect(await run(page, "SELECT current_user")).toEqual({ rows: [["sqllens_user"]] });
});

test("Task027 AC4+AC6+AC8: lớp một bật, câu lỗi có statementIndex, câu internal không vào history", async ({ page }) => {
  await page.goto("/en/e2e-adapter");
  await page.waitForFunction(() => typeof window.createPostgresAdapter === "function");
  const r = await page.evaluate(async () => {
    const a = (window.a = await window.createPostgresAdapter()) as unknown as {
      guardActive: boolean;
      execute(sql: string, o?: { internal?: boolean }): Promise<unknown>;
      history(): string[];
    };
    await a.execute("CREATE TABLE t(id int)");
    await a.execute("INSERT INTO t VALUES (1)", { internal: true });
    const err = async (sql: string) => {
      try {
        await a.execute(sql);
      } catch (e) {
        return (e as { statementIndex?: number }).statementIndex ?? null;
      }
    };
    return {
      guardActive: a.guardActive,
      history: a.history(),
      n1: await err("SELECT * FROM nope"),
      n3: await err("SELECT 1;\nSELECT 2;\nSELECT * FROM nope"),
      syn: await err("SELECT 1; SELEC 2"),
      noPos: await err("SELECT 1; SELECT 1/0"),
    };
  });
  expect(r).toEqual({ guardActive: true, history: ["CREATE TABLE t(id int)"], n1: 1, n3: 3, syn: 2, noPos: null });
});
