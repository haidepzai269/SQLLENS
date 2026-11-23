// Kiểm SSE có sống qua `rewrites` của Next 16.4.4 hay không, và `compress: true` có giết nó không.
//
// Cách kiểm: mở /viewer?mode=sse, phát một bản tin, đo thời gian từ lúc server phát tới lúc
// trình duyệt nhận sự kiện. Nếu bị gom đệm, sự kiện sẽ không tới (hoặc tới rất trễ / tới một
// cục khi đóng kết nối).
//
// Chạy: node tools/sse-through.mjs <label>
// Yêu cầu: Next đang chạy ở WEB_ORIGIN với cấu hình muốn kiểm (NEXT_COMPRESS=1 hoặc không).
import { launch, save, median, WEB, API, sleep } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LABEL = process.argv[2] ?? "compress-false";
const RUNS = Number(process.env.RUNS ?? 3);
// Kích thước payload mỗi bản tin. Mặc định 3 KB như AC1; đặt SSE_PAYLOAD=300000 để thử
// xem nén có gom đệm khi bản tin lớn hay không.
const PAYLOAD_CHARS = Number(process.env.SSE_PAYLOAD ?? 3000);

const ac1 = JSON.parse(readFileSync(join(process.cwd(), "results", "ac1.json"), "utf8"));
const payload = "g." + "A".repeat(PAYLOAD_CHARS); // payload giả đủ lớn để bị gom đệm nếu có nén

const metrics = async () => (await fetch(`${API}/metrics`)).json();

async function publish(room) {
  const t = Date.now();
  await fetch(`${API}/room/${room}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: 0, payload, sqlBytes: 0, bytes: payload.length, hasPlan: false, rows: 0 }),
  });
  return t;
}

const runs = [];
for (let i = 1; i <= RUNS; i++) {
  const room = `sse-${LABEL}-${Date.now()}-${i}`;
  await publish(room);

  const browser = await launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
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
      }
    };
  });
  await page.goto(`${WEB}/viewer?mode=sse&room=${room}&interval=2000`, { waitUntil: "domcontentloaded" });

  // Chờ hello tới — nếu không tới trong 20 s thì SSE đã bị chặn/gom.
  const tOpen = Date.now();
  let hello = null;
  while (Date.now() - tOpen < 20_000) {
    hello = events.find((e) => e.kind === "hello");
    if (hello) break;
    await sleep(20);
  }
  const helloMs = hello ? hello.at - tOpen : null;

  // Phát 3 bản tin cách nhau 3 s, đo độ trễ từng bản.
  const lat = [];
  for (let k = 0; k < 3; k++) {
    const before = events.length;
    const sentAt = await publish(room);
    let got = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 30_000) {
      const s = events.slice(before).find((e) => e.kind === "snapshot");
      if (s) {
        got = s;
        break;
      }
      await sleep(20);
    }
    lat.push(got ? got.at - sentAt : null);
    await sleep(3_000);
  }
  await browser.close();

  const ok = helloMs !== null && lat.every((x) => x !== null);
  runs.push({ run: i, label: LABEL, helloMs, snapshotLatencyMs: lat, streamed: ok });
  console.log(`lần ${i} [${LABEL}]: hello=${helloMs}ms, snapshot=${lat.join(", ")}ms, stream=${ok}`);
  await sleep(500);
}

save(`sse_through_${LABEL}_${PAYLOAD_CHARS}.json`, {
  label: LABEL,
  webOrigin: WEB,
  runs,
  median: {
    helloMs: median(runs.map((r) => r.helloMs).filter((x) => x !== null)),
    snapshotLatencyMs: median(runs.flatMap((r) => r.snapshotLatencyMs).filter((x) => x !== null)),
  },
  streamed: runs.every((r) => r.streamed),
});
