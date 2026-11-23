// Kiểm chứng phép đo 3G chậm có thật sự chậm hay không.
//
// `Network.emulateNetworkConditions` của CDP hạn chế băng thông của request MỚI. Nếu nó
// không hạn chế được dữ liệu trên một stream đã mở, thì con số "độ trễ SSE trên 3G" sẽ
// thấp giả tạo và phải nói rõ là CHƯA ĐO ĐƯỢC, không được báo như số thật.
//
// Cách kiểm: tải cùng một file qua cùng kết nối, một lần không hạn chế, một lần hạn chế.
// Nếu chênh lệch đúng bậc độ lớn thì hạn chế có tác dụng với request thường.
import { launch, save, median, WEB, sleep } from "./lib.mjs";

const RUNS = Number(process.env.RUNS ?? 3);
const URL_PATH = "/pglite/initdb.wasm";
const PROFILE = { downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8, latency: 400 };

async function timedFetch(browser, throttle) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  if (throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: PROFILE.latency,
      downloadThroughput: PROFILE.downloadThroughput,
      uploadThroughput: PROFILE.uploadThroughput,
    });
  }
  await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
  const r = await page.evaluate(async (u) => {
    const t0 = performance.now();
    const res = await fetch(u, { cache: "no-store" });
    const buf = await res.arrayBuffer();
    return { ms: performance.now() - t0, bytes: buf.byteLength };
  }, URL_PATH);
  await ctx.close();
  return r;
}

const runs = [];
for (let i = 1; i <= RUNS; i++) {
  const browser = await launch();
  const plain = await timedFetch(browser, false);
  const slow = await timedFetch(browser, true);
  await browser.close();
  runs.push({ run: i, plain, slow, ratio: slow.ms / plain.ms });
  console.log(
    `lần ${i}: không hạn chế ${plain.ms.toFixed(0)}ms cho ${plain.bytes}B; 3G chậm ${slow.ms.toFixed(0)}ms → chậm hơn ${(slow.ms / plain.ms).toFixed(1)}×`,
  );
  await sleep(500);
}

save("throttle_control.json", {
  url: URL_PATH,
  profile: PROFILE,
  runs,
  median: {
    plainMs: median(runs.map((r) => r.plain.ms)),
    slowMs: median(runs.map((r) => r.slow.ms)),
    ratio: median(runs.map((r) => r.ratio)),
  },
});
console.log(JSON.stringify({ plainMs: median(runs.map((r) => r.plain.ms)), slowMs: median(runs.map((r) => r.slow.ms)), ratio: median(runs.map((r) => r.ratio)) }, null, 2));
