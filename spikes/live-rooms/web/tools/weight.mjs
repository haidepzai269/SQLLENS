// Trọng lượng tải trang + xác nhận viewer có tải WASM hay không.
//
// Vì sao phải đo cả trong worker: request do Web Worker phát ra KHÔNG hiện trong CDP session
// của trang. Nếu chỉ đếm ở trang thì trang có bật PGlite cũng báo 0 B WASM — phép đo sẽ
// "chứng minh" đúng cái mình muốn tin, chứ không phải sự thật. Ở đây đọc thẳng
// `performance.getEntriesByType("resource")` bên trong worker (qua Playwright `page.workers()`),
// và dùng /ac1 làm đối chứng: /ac1 CÓ bật engine, nên nó PHẢI ra WASM > 0. Nếu /ac1 ra 0
// thì phép đo hỏng và số của /viewer không được dùng.
import { chromium } from "@playwright/test";
import { save, median, WEB, sleep } from "./lib.mjs";

const RUNS = Number(process.env.RUNS ?? 3);
const PAGES = ["/viewer?mode=poll&room=w&interval=2000", "/ac1"];

const entryOf = (e) => ({
  name: new URL(e.name).pathname,
  transferSize: e.transferSize,
  encodedBodySize: e.encodedBodySize,
  decodedBodySize: e.decodedBodySize,
});

async function measurePage(browser, path) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${WEB}${path}`, { waitUntil: "load" });
  await sleep(10_000); // chờ worker tải xong WASM

  const pageEntries = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((e) => ({
      name: e.name,
      transferSize: e.transferSize,
      encodedBodySize: e.encodedBodySize,
      decodedBodySize: e.decodedBodySize,
    })),
  );

  const workers = page.workers();
  const workerEntries = [];
  for (const w of workers) {
    try {
      const es = await w.evaluate(() =>
        performance.getEntriesByType("resource").map((e) => ({
          name: e.name,
          transferSize: e.transferSize,
          encodedBodySize: e.encodedBodySize,
          decodedBodySize: e.decodedBodySize,
        })),
      );
      workerEntries.push(...es);
    } catch (err) {
      workerEntries.push({ error: String(err.message) });
    }
  }

  await ctx.close();

  const sum = (xs, k) => xs.reduce((a, x) => a + (x[k] ?? 0), 0);
  const isWasm = (x) => /\.wasm|\.data$/.test(x.name ?? "");
  const out = {
    workers: workers.length,
    pageCount: pageEntries.length,
    pageTotal: sum(pageEntries, "transferSize"),
    pageJs: sum(pageEntries.filter((x) => x.name.includes("/_next/static/")), "transferSize"),
    pageWasm: sum(pageEntries.filter(isWasm), "transferSize"),
    workerCount: workerEntries.length,
    workerTotal: sum(workerEntries, "transferSize"),
    workerWasm: sum(workerEntries.filter(isWasm), "transferSize"),
    pageEntries: pageEntries.map(entryOf),
    workerEntries: workerEntries.map((x) => (x.error ? x : entryOf(x))),
  };
  out.total = out.pageTotal + out.workerTotal;
  out.wasm = out.pageWasm + out.workerWasm;
  return out;
}

const runs = [];
for (let i = 1; i <= RUNS; i++) {
  const browser = await chromium.launch({ headless: true });
  const out = {};
  for (const p of PAGES) out[p] = await measurePage(browser, p);
  await browser.close();
  runs.push({ run: i, ...out });
  const v = out[PAGES[0]];
  const a = out[PAGES[1]];
  console.log(
    `lần ${i}: viewer total=${v.total}B wasm=${v.wasm}B workers=${v.workers} | ac1 total=${a.total}B wasm=${a.wasm}B workers=${a.workers} workerWasm=${a.workerWasm}B`,
  );
  await sleep(500);
}

const pick = (p, k) => runs.map((r) => r[p][k]);
const summary = {
  runs,
  median: Object.fromEntries(
    PAGES.flatMap((p) => [
      [`${p}|total`, median(pick(p, "total"))],
      [`${p}|wasm`, median(pick(p, "wasm"))],
      [`${p}|pageTotal`, median(pick(p, "pageTotal"))],
      [`${p}|workerTotal`, median(pick(p, "workerTotal"))],
      [`${p}|workerWasm`, median(pick(p, "workerWasm"))],
      [`${p}|workers`, median(pick(p, "workers"))],
    ]),
  ),
  // Chỉ dùng được số của viewer nếu trang đối chứng CÓ engine thật sự cho ra WASM > 0.
  instrumentProven: runs.every((r) => r[PAGES[1]].wasm > 0),
};
save("weight.json", summary);
console.log(JSON.stringify(summary.median, null, 2));
console.log(`phép đo chứng minh được: ${summary.instrumentProven}`);
