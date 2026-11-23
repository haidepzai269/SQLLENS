// Ca biên của AC4:
//   1) Viewer bị giết đột ngột (tiến trình Chromium chết, không đóng socket) — server có nhả
//      kết nối SSE không, sau bao lâu.
//   2) Mạng 3G chậm (CDP Network.emulateNetworkConditions) — SSE có bị gom đệm không, trễ
//      bao nhiêu ms so với lúc server phát.
//
// Chạy: node tools/edge.mjs kill|slow3g
import { launch, save, wireCounter, median, WEB, API, sleep } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const WHAT = process.argv[2] ?? "kill";
const RUNS = Number(process.env.RUNS ?? 3);

const ac1 = JSON.parse(readFileSync(join(process.cwd(), "results", "ac1.json"), "utf8"));
const meta = ac1.runs[0];

async function fetchPayload() {
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(`${WEB}/host?room=src&every=999999`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__hostReady !== undefined, null, { timeout: 300_000 });
  const p = await page.evaluate(() => window.__hostPayload);
  const m = await page.evaluate(() => window.__host);
  await browser.close();
  return { payload: p, meta: m };
}

const { payload, meta: hostMeta } = await fetchPayload();

async function publish(room) {
  const t = Date.now();
  await fetch(`${API}/room/${room}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      v: 0,
      payload,
      sqlBytes: hostMeta.sqlBytes,
      bytes: payload.length,
      hasPlan: true,
      rows: hostMeta.rows,
    }),
  });
  return t;
}

const metrics = async () => (await fetch(`${API}/metrics`)).json();

async function waitSseOpen(n, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const m = await metrics();
    if (m.sseOpen >= n) return m;
    await sleep(100);
  }
  return metrics();
}

async function waitSseZero(timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const m = await metrics();
    if (m.sseOpen === 0) return { ms: Date.now() - t0, m };
    await sleep(200);
  }
  return { ms: null, m: await metrics() };
}

const runs = [];

if (WHAT === "kill") {
  // Giết tiến trình Chromium bằng `taskkill /F` để socket đóng kiểu TCP RST, không có
  // FIN sạch — đúng cảnh người dùng đóng tab / mất mạng / hết pin.
  for (let i = 1; i <= RUNS; i++) {
    const room = `kill-${Date.now()}-${i}`;
    await publish(room);
    await fetch(`${API}/metrics/reset`, { method: "POST" });

    const browser = await launch();
    const page = await browser.newPage();
    await page.goto(`${WEB}/viewer?mode=sse&room=${room}&interval=2000`, { waitUntil: "domcontentloaded" });
    const opened = await waitSseOpen(1);
    await sleep(3_000); // để kết nối chắc chắn đã ổn định

    // Playwright 1.64 không có `browser.process()`. Lấy PID tiến trình Chromium thật qua
    // CDP `SystemInfo.getProcessInfo`, rồi `taskkill /T /F` để cả cây tiến trình chết ngay,
    // không có FIN sạch — đúng cảnh đóng tab / mất mạng / hết pin.
    let pid = null;
    try {
      const bs = await browser.newBrowserCDPSession();
      const info = await bs.send("SystemInfo.getProcessInfo");
      pid = info.processInfo.find((p) => p.type === "browser")?.id ?? null;
      await bs.detach();
    } catch (e) {
      console.error("không lấy được pid Chromium:", e.message);
    }
    const tKill = Date.now();
    if (pid) {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      await browser.close();
    }
    // Không gọi browser.close(): socket phải chết theo tiến trình.
    const rel = await waitSseZero();
    const m = await metrics();
    const last = m.closes[m.closes.length - 1];

    runs.push({
      run: i,
      pid,
      sseOpenBeforeKill: opened.sseOpen,
      killedAt: tKill,
      releasedMs: rel.ms,
      sseOpenAfter: m.sseOpen,
      closeEvents: m.closes.length,
      lastClose: last ?? null,
      goroutines: m.goroutines,
    });
    console.log(
      `lần ${i}: giết Chromium pid=${pid}, sseOpen trước=${opened.sseOpen}, nhả sau ${rel.ms}ms, sseOpen sau=${m.sseOpen}, sự kiện close=${m.closes.length}, livedMs=${last?.livedMs}`,
    );
    await sleep(1_000);
  }
} else {
  // 3G chậm: 400 kbps xuống, 400 ms RTT — mức Playwright hay dùng cho "Slow 3G".
  const PROFILE = { downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8, latency: 400 };
  for (let i = 1; i <= RUNS; i++) {
    const room = `slow-${Date.now()}-${i}`;
    await publish(room);

    const browser = await launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: PROFILE.latency,
      downloadThroughput: PROFILE.downloadThroughput,
      uploadThroughput: PROFILE.uploadThroughput,
    });

    // Trang viewer ghi lại thời điểm nhận từng sự kiện.
    const events = [];
    await page.exposeFunction("__mark", (kind, at) => events.push({ kind, at }));
    await page.addInitScript(() => {
      const Orig = window.EventSource;
      // @ts-ignore
      window.EventSource = class extends Orig {
        constructor(url) {
          super(url);
          this.addEventListener("snapshot", () => window.__mark("snapshot", Date.now()));
          this.addEventListener("hello", () => window.__mark("hello", Date.now()));
          this.addEventListener("ping", () => window.__mark("ping", Date.now()));
        }
      };
    });
    await page.goto(`${WEB}/viewer?mode=sse&room=${room}&interval=2000`, { waitUntil: "domcontentloaded" });
    await waitSseOpen(1);
    await sleep(3_000);

    const samples = [];
    for (let k = 0; k < 5; k++) {
      await sleep(4_000);
      const before = events.length;
      const sentAt = await publish(room);
      // Chờ tới khi sự kiện snapshot xuất hiện.
      let got = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 60_000) {
        const s = events.slice(before).find((e) => e.kind === "snapshot");
        if (s) {
          got = s;
          break;
        }
        await sleep(20);
      }
      samples.push({
        latencyMs: got ? got.at - sentAt : null,
        bodyBytes: payload.length,
        arrived: !!got,
      });
    }

    await browser.close();
    const lat = samples.map((s) => s.latencyMs).filter((x) => x !== null);
    runs.push({ run: i, profile: PROFILE, samples, latencyMedianMs: median(lat), eventsSeen: events.length });
    console.log(`lần ${i}: độ trễ SSE trên 3G chậm = ${lat.join(", ")} ms; trung vị ${median(lat)} ms`);
    await sleep(1_000);
  }
}

const key = WHAT === "kill" ? "releasedMs" : "latencyMedianMs";
save(`edge_${WHAT}.json`, {
  what: WHAT,
  runs,
  median: { [key]: median(runs.map((r) => r[key])) },
});
console.log(`trung vị ${key} = ${median(runs.map((r) => r[key]))}`);
