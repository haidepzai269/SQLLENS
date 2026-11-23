// AC4 — fan-out: 30 viewer đồng thời trong 10 phút, cả polling và SSE.
//
// Đo:
//   - số request mỗi route (từ /metrics của Gin, đếm phía server)
//   - byte ra (từ /metrics, byte thân phản hồi thật đã ghi ra socket)
//   - RAM tiến trình Gin và tiến trình Next ở các mốc 0 / 1 / 30 viewer
//   - rò kết nối: sau khi đóng hết viewer, sseOpen phải về 0; ghi thời gian nhả
//
// Chạy: node tools/ac4.mjs sse|poll [viewers] [minutes]
import { launch, save, wireCounter, median, WEB, API, sleep, rssOf } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const MODE = process.argv[2] ?? "sse";
const VIEWERS = Number(process.argv[3] ?? 30);
const MINUTES = Number(process.argv[4] ?? 10);
const RUNS = Number(process.env.RUNS ?? 3);
const POLL_MS = Number(process.env.POLL_MS ?? 2_000);
const EVERY_MS = Number(process.env.EVERY_MS ?? 10_000);
const HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS ?? 15_000);

const ac1 = JSON.parse(readFileSync(join(process.cwd(), "results", "ac1.json"), "utf8"));
const SQL_SHARE = ac1.runs[0].sqlAttributableLive / ac1.runs[0].livePayloadBytes;

/** PID đang nghe một cổng TCP (Windows). */
function listenerPid(port) {
  const out = execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
  ]).toString().trim();
  return out ? Number(out) : null;
}

const ginPid = listenerPid(18160);
const nextPid = listenerPid(3159);
if (!ginPid || !nextPid) {
  console.error(`không thấy tiến trình: gin=${ginPid} next=${nextPid}`);
  process.exit(1);
}
console.log(`gin pid=${ginPid}, next pid=${nextPid}`);

const metrics = async () => (await fetch(`${API}/metrics`)).json();
const reset = async () => fetch(`${API}/metrics/reset`, { method: "POST" });

// Payload thật, lấy từ trang host.
async function fetchPayload() {
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(`${WEB}/host?room=src&every=999999`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__hostReady !== undefined, null, { timeout: 300_000 });
  const p = await page.evaluate(() => window.__hostPayload);
  const meta = await page.evaluate(() => window.__host);
  await browser.close();
  return { payload: p, meta };
}

const { payload, meta } = await fetchPayload();
const room = `ac4-${MODE}-${Date.now()}`;

async function publish() {
  await fetch(`${API}/room/${room}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: 0, payload, sqlBytes: meta.sqlBytes, bytes: payload.length, hasPlan: true, rows: meta.rows }),
  });
}

const runs = [];

for (let i = 1; i <= RUNS; i++) {
  await reset();
  await publish();

  const browser = await launch();
  const contexts = [];
  const pages = [];
  const wires = [];

  // Mốc RAM: 0 viewer.
  const ram0 = { gin: await rssOf(ginPid), next: await rssOf(nextPid) };

  const url = `${WEB}/viewer?mode=${MODE}&room=${room}&interval=${POLL_MS}`;
  const openViewer = async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const w = await wireCounter(page, "/api/");
    await page.goto(url, { waitUntil: "domcontentloaded" });
    contexts.push(ctx);
    pages.push(page);
    wires.push(w);
    return page;
  };

  // Mốc RAM: 1 viewer (sau khi kết nối đã ổn định).
  await openViewer();
  await sleep(5_000);
  const ram1 = { gin: await rssOf(ginPid), next: await rssOf(nextPid) };

  const t0 = Date.now();
  await Promise.all(Array.from({ length: VIEWERS - 1 }, openViewer));
  const openMs = Date.now() - t0;
  await sleep(5_000);
  const ram30 = { gin: await rssOf(ginPid), next: await rssOf(nextPid) };
  const m30 = await metrics();

  console.log(
    `lần ${i} [${MODE}]: mở ${VIEWERS} viewer trong ${openMs}ms; RAM gin ${(ram0.gin / 1e6).toFixed(1)}→${(ram1.gin / 1e6).toFixed(1)}→${(ram30.gin / 1e6).toFixed(1)} MB, next ${(ram0.next / 1e6).toFixed(1)}→${(ram1.next / 1e6).toFixed(1)}→${(ram30.next / 1e6).toFixed(1)} MB; sseOpen=${m30.sseOpen}`,
  );

  // Đo 10 phút: host phát mỗi 10 s.
  const windowMs = MINUTES * 60_000;
  const winStart = Date.now();
  let publishing = true;
  const pubLoop = (async () => {
    while (publishing) {
      await sleep(EVERY_MS);
      if (!publishing) break;
      await publish();
    }
  })();
  await sleep(windowMs);
  publishing = false;
  await pubLoop;
  const elapsed = Date.now() - winStart;

  const mEnd = await metrics();
  const ramEnd = { gin: await rssOf(ginPid), next: await rssOf(nextPid) };
  const viewerStats = await pages[0].evaluate(() => ({ ...window.__viewer }));

  // Rò kết nối: đóng hết viewer rồi xem sseOpen có về 0, mất bao lâu.
  const closeStart = Date.now();
  for (const p of pages) {
    await p.evaluate(() => window.__viewerStop && window.__viewerStop());
  }
  for (const c of contexts) await c.close();
  await browser.close();

  let releasedMs = null;
  let openAfter = null;
  for (let t = 0; t < 60_000; t += 250) {
    const m = await metrics();
    openAfter = m.sseOpen;
    if (m.sseOpen === 0) {
      releasedMs = Date.now() - closeStart;
      break;
    }
    await sleep(250);
  }
  const mAfter = await metrics();

  const totalBytes = Object.values(mEnd.bytes).reduce((a, b) => a + b, 0);
  const run = {
    run: i,
    mode: MODE,
    viewers: VIEWERS,
    windowMs: elapsed,
    openMs,
    requests: mEnd.requests,
    bytesByRoute: mEnd.bytes,
    statusByRoute: mEnd.status,
    totalBytes,
    bytesPerMinuteAllViewers: (totalBytes / elapsed) * 60_000,
    bytesPerViewerPerMinute: (totalBytes / elapsed) * 60_000 / VIEWERS,
    // CẢNH BÁO: hai dòng dưới SAI, giữ lại chỉ để đối chiếu.
    //  - chia tổng byte (gồm route `publish` do HOST gọi) cho số viewer
    //  - nhân tỉ lệ SQL với toàn bộ byte thân, kể cả `hello`/`ping` không chở SQL
    // Số đúng: `tools/ac4-recompute.mjs` (byte mỗi viewer) và `tools/sql-line.mjs` (dòng SQL).
    sqlBytesPerViewerPerMinute_naiveWrong: ((totalBytes / elapsed) * 60_000 / VIEWERS) * SQL_SHARE,
    sseOpenAt30: m30.sseOpen,
    sseTotal: mEnd.sseTotal,
    sseEvents: mEnd.sseEvents,
    goroutinesAt30: m30.goroutines,
    goroutinesEnd: mEnd.goroutines,
    heapAllocAt30: m30.heapAlloc,
    heapAllocEnd: mEnd.heapAlloc,
    ram0,
    ram1,
    ram30,
    ramEnd,
    viewerEvents: viewerStats.events,
    viewerPolls: viewerStats.polls,
    viewerErrors: viewerStats.errors,
    wireFirstViewer: { requests: wires[0].requests, body: wires[0].body, headers: wires[0].headers },
    connectionRelease: {
      releasedMs,
      sseOpenAfterClose: openAfter,
      closesRecorded: mAfter.closes.length,
      livedMs: mAfter.closes.map((c) => c.livedMs),
    },
  };
  runs.push(run);
  console.log(
    `lần ${i}: ${elapsed}ms, tổng byte ra=${totalBytes}, ${(run.bytesPerViewerPerMinute).toFixed(1)} B/viewer/phút, SQL≈${run.sqlBytesPerViewerPerMinute.toFixed(1)}; nhả kết nối sau ${releasedMs}ms (sseOpen=${openAfter}); goroutines ${m30.goroutines}→${mEnd.goroutines}`,
  );
  await sleep(2_000);
}

const pick = (k) => runs.map((r) => r[k]);
const summary = {
  mode: MODE,
  config: { viewers: VIEWERS, minutes: MINUTES, pollMs: POLL_MS, publishEveryMs: EVERY_MS, heartbeatMs: HEARTBEAT_MS, payloadBytes: payload.length },
  runs,
  median: {
    openMs: median(pick("openMs")),
    totalBytes: median(pick("totalBytes")),
    bytesPerMinuteAllViewers: median(pick("bytesPerMinuteAllViewers")),
    bytesPerViewerPerMinute: median(pick("bytesPerViewerPerMinute")),
    sqlBytesPerViewerPerMinute: median(pick("sqlBytesPerViewerPerMinute")),
    goroutinesAt30: median(pick("goroutinesAt30")),
    goroutinesEnd: median(pick("goroutinesEnd")),
    releasedMs: median(pick("connectionRelease").map((c) => c.releasedMs)),
  },
};
save(`ac4_${MODE}.json`, summary);
console.log(JSON.stringify(summary.median, null, 2));
