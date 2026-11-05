// Quay video demo cho trang /about từ bản chạy thật. Dùng: `npm run build && npm run start -- -p 3100`, rồi
// `node --experimental-strip-types e2e/record-demo.ts` (đặt DEMO_URL nếu cổng khác). Ghi đè public/about/demo-{vi,en}.{webm,jpg}.
// Không có ffmpeg trên máy nên giữ nguyên WebM của Playwright, không nén lại; mỗi file phải dưới 8 MB (script kiểm).
import { mkdirSync, renameSync, statSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.DEMO_URL ?? "http://localhost:3100";
const OUT = new URL("../public/about/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const MAX = 8 * 1024 * 1024;
const T = {
  vi: { run: "Chạy", stage: "Mô phỏng", btree: "B-Tree" },
  en: { run: "Run", stage: "Simulation", btree: "B-Tree" },
} as const;
const SQL = [
  "CREATE TABLE orders(id int PRIMARY KEY, customer_id int, total int);",
  "CREATE INDEX orders_customer_idx ON orders(customer_id);",
  "INSERT INTO orders SELECT g, g % 2000, g FROM generate_series(1, 20000) g;",
  "SELECT * FROM orders WHERE customer_id = 42;",
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const l of ["vi", "en"] as const) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: OUT, size: { width: 1600, height: 900 } } });
  const page = await ctx.newPage();
  await page.route("**/api/me", (r) => r.fulfill({ status: 503, body: "{}" })); // không cần đăng nhập để quay PostgreSQL
  await page.goto(`${BASE}/${l}`);
  const editor = page.locator(".cm-content:visible").first();
  await editor.waitFor();
  await page.waitForTimeout(800);
  await editor.click();
  for (const line of SQL) {
    await page.keyboard.type(line, { delay: 14 });
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: T[l].run, exact: true }).first().click();
  await page.locator("tbody:visible tr").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.locator("#stage").getByRole("tab", { name: T[l].btree, exact: true }).click();
  await page.waitForTimeout(700);
  await page.locator("#stage select").selectOption({ index: 1 }); // index đầu tiên sau mục "Chọn một index"
  await page.waitForTimeout(1200);
  const key = page.locator("#stage input").first(); // thả một key xuống cây
  await key.click();
  await page.keyboard.type("42", { delay: 120 });
  await key.press("Enter");
  await page.waitForTimeout(700);
  await page.locator("#stage").getByRole("button", { name: T[l].run, exact: true }).click(); // chạy animation của cây
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}demo-${l}.jpg`, type: "jpeg", quality: 82 });
  const video = page.video()!;
  await ctx.close();
  const file = `${OUT}demo-${l}.webm`;
  renameSync(await video.path(), file);
  const size = statSync(file).size;
  console.log(`${file}: ${(size / 1024).toFixed(0)} KB`);
  if (size > MAX) throw new Error(`${file} vượt 8 MB`);
}
await browser.close();
