import { test, expect } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

const PG = [
  "CREATE TABLE orders (id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id), total numeric)",
  "CREATE INDEX idx_orders_user ON orders (user_id)",
  "SELECT o.id, u.name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.total > 10",
  "WITH recent AS (SELECT * FROM orders WHERE total > 100) SELECT count(*) FROM recent",
  "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)",
  "SELECT * FROM users WHERE name LIKE '%son'",
  "SELECT * FROM users WHERE lower(email) = 'a@b.c'",
  "UPDATE accounts SET balance = balance - 10 WHERE id = 1",
  "SELECT * FROM",
  "SELEC id FROM users",
];
const MY = [
  "CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, total DECIMAL(10,2), FOREIGN KEY (user_id) REFERENCES users(id))",
  "CREATE INDEX idx_orders_user ON orders (user_id)",
  "SELECT o.id, u.name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.total > 10",
  "WITH recent AS (SELECT * FROM orders WHERE total > 100) SELECT count(*) FROM recent",
  "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)",
  "SELECT * FROM users WHERE name LIKE '%son'",
  "SELECT * FROM users WHERE LOWER(email) = 'a@b.c'",
  "SELECT * FROM orders FORCE INDEX (idx_orders_user) WHERE user_id = 5",
  "SELECT * FROM orders USE INDEX (idx_orders_user) WHERE user_id = 5",
  "UPDATE accounts SET balance = balance - 10 WHERE id = 1 LIMIT 1",
];
const R: Record<string, unknown> = {};
const log = (ac: string, v: unknown) => {
  R[ac] = v;
  console.log(`\n[${ac}] ` + JSON.stringify(v, null, 1));
};

test("check-tools", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction("window.spikeReady === true", null, { timeout: 30_000 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = (fn: string, ...a: unknown[]): Promise<any> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.evaluate(([f, args]) => (window as any).spike[f as string](...(args as unknown[])), [fn, a] as const);

  log("init", await call("init"));

  // AC1
  log("AC1.seed10k", await call("seed", "t10k", 10000, false));
  const a1 = await call("inspect", "t10k");
  log("AC1.int10k", a1);
  expect(a1.meta.level).toBe(1);
  expect(a1.root.type).toBe("r");
  expect(a1.leaf.type).toBe("l");
  log("AC1.seedWide10k", await call("seed", "w10k", 10000, true));
  const a1w = await call("inspect", "w10k");
  log("AC1.wide10k", a1w);
  expect(a1w.internal, "internal page exists with wide keys").toBeTruthy();

  // AC2 + AC3. Int keys: 100k rows is still level 1 (root -> leaf); 300k reaches level 2 (root -> internal -> leaf).
  const paths = [];
  for (const [name, n, levels] of [["t100k", 100000, [1, 0]], ["t300k", 300000, [2, 1, 0]]] as const) {
    log(`AC3.seed${name}`, await call("seed", name, n, false));
    const m = await call("inspect", name);
    log(`AC3.meta${name}`, { meta: m.meta, pages: m.pages });
    expect(m.meta.level).toBe(levels[0]);
    for (const k of [1, 4242, Math.floor(n / 2), n - 1, n]) {
      const d = await call("descend", name, k);
      paths.push({ table: name, key: k, ...d });
      expect(d.found, `${name} key ${k} found in leaf`).toBe(true);
      expect(d.match, `${name} key ${k} htid equals heap ctid`).toBe(true);
      expect(d.path.map((p: { level: number }) => p.level)).toEqual(levels);
    }
    log(`AC3.readAll${name}`, await call("readAll", name));
  }
  log("AC2.paths", paths);

  // AC4
  const sec = await call("security", "t10k");
  log("AC4", sec);
  expect(sec.low_bt_metap).toMatch(/^ERR/);
  expect(sec.low_bt_page_stats).toMatch(/^ERR/);
  expect(sec.low_bt_page_items).toMatch(/^ERR/);
  expect(sec.low_get_raw_page).toMatch(/^ERR/);
  expect(sec.granted_bt_metap).toMatch(/^ERR/);
  expect(sec.pg_monitor_bt_metap).toMatch(/^ERR/);
  // Finding: SET ROLE / RESET ROLE escape works because session_user is the superuser.
  expect(sec.low_reset_role_then_call).toBe("OK");
  expect(sec.user_after_escape).toBe("postgres");

  // AC5
  const pg = [];
  for (const s of PG) pg.push({ sql: s.slice(0, 60), ...(await call("pgParse", s)) });
  log("AC5", pg);
  expect(pg.filter((r) => r.ok).length).toBe(8);
  expect(pg.slice(8).map((r) => [r.ok, r.pos])).toEqual([[false, 13], [false, 0]]);
  expect(await page.evaluate("1+1")).toBe(2); // page still responsive
  const js = readFileSync("dist/pg-parser.js");
  const wasm = readFileSync("dist/libpg-query.wasm");
  log("AC5.gzip", { js_bytes: js.length, js_gzip: gzipSync(js).length, wasm_bytes: wasm.length, wasm_gzip: gzipSync(wasm).length });

  // AC6
  const my = [];
  for (const s of MY) my.push({ sql: s.slice(0, 60), ...(await call("myParse", s)) });
  log("AC6", my);
  expect(my.map((r) => r.ok)).toEqual([true, true, true, true, true, true, true, false, false, true]);
  const myJs = readFileSync("dist/my-parser.js");
  log("AC6.gzip", { js_bytes: myJs.length, js_gzip: gzipSync(myJs).length });

  expect(errors, "no uncaught page errors").toEqual([]);
  writeFileSync("results.json", JSON.stringify(R, null, 1));
});
