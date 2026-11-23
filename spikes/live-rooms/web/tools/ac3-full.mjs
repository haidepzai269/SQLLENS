// AC3 phần "payload đầy đủ": snapshot + plan + kết quả + model B-Tree.
//
// Câu hỏi cần trả lời bằng số: để viewer xem được Plan và B-Tree mà KHÔNG có engine, phải
// gửi bao nhiêu byte, và số đó có vượt trần snapshot 32 KB của SP022 không. Nếu vượt thì
// "0 MB WASM cho viewer" chỉ đúng với cây nhỏ, còn cây 100k dòng thì phải nới trần.
//
// Chạy: node tools/ac3-full.mjs
import { launch, save, waitFor, median, WEB, sleep } from "./lib.mjs";

const RUNS = Number(process.env.RUNS ?? 3);
const runs = [];

for (let i = 1; i <= RUNS; i++) {
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(`${WEB}/ac3`, { waitUntil: "domcontentloaded" });
  const r = await waitFor(page, "__ac3full");
  const detail = await waitFor(page, "__ac3detail");
  await browser.close();
  runs.push({ run: i, ...r, detail });
  console.log(
    `lần ${i}: base=${r.basePayloadBytes}B +B-Tree=${r.withTreesPayloadBytes}B (+path ${r.withTreesPathPayloadBytes}B) gzip=${r.withTreesGzipBytes}B json=${r.withTreesJsonBytes}B vượt 32KB=${r.overHardLimit}`,
  );
  await sleep(500);
}

save("ac3_full.json", {
  runs,
  median: {
    basePayloadBytes: median(runs.map((r) => r.basePayloadBytes)),
    withTreesPayloadBytes: median(runs.map((r) => r.withTreesPayloadBytes)),
    withTreesPathPayloadBytes: median(runs.map((r) => r.withTreesPathPayloadBytes)),
    withTreesGzipBytes: median(runs.map((r) => r.withTreesGzipBytes)),
    withTreesJsonBytes: median(runs.map((r) => r.withTreesJsonBytes)),
  },
  hardLimitBytes: 32768,
});
console.log(JSON.stringify(runs[0], null, 2));
