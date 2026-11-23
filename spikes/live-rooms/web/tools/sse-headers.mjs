// Kiểm header thật của phản hồi SSE qua `rewrites`: Next có nén `text/event-stream` hay không,
// và có đệm hay không. Đây là bằng chứng cho câu "compress: false có bắt buộc không".
//
// Chạy: node tools/sse-headers.mjs <label>
import { launch, save, WEB, API, sleep } from "./lib.mjs";

const LABEL = process.argv[2] ?? "unknown";

const room = `hdr-${Date.now()}`;
await fetch(`${API}/room/${room}/publish`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ v: 0, payload: "g." + "A".repeat(3000), sqlBytes: 0, bytes: 3002, hasPlan: false, rows: 0 }),
});

const browser = await launch();
const page = await browser.newPage();
const seen = [];
page.on("response", (r) => {
  if (r.url().includes("/events")) {
    seen.push({ url: r.url(), status: r.status(), headers: r.headers() });
  }
});
await page.goto(`${WEB}/viewer?mode=sse&room=${room}&interval=2000`, { waitUntil: "domcontentloaded" });
await sleep(5_000);

// Đọc thêm thời điểm nhận byte đầu tiên (TTFB của stream) và số byte đã tới trong 3 s.
const wire = await page.evaluate(async (roomId) => {
  const ctrl = new AbortController();
  const t0 = performance.now();
  const res = await fetch(`/api/room/${roomId}/events`, { signal: ctrl.signal });
  const firstByte = performance.now() - t0;
  const reader = res.body.getReader();
  let bytes = 0;
  let chunks = 0;
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise((r) => setTimeout(() => r({ done: true, timeout: true }), deadline - performance.now())),
    ]);
    if (done || !value) break;
    bytes += value.byteLength;
    chunks++;
  }
  ctrl.abort();
  return { firstByte, bytes, chunks, contentType: res.headers.get("content-type"), encoding: res.headers.get("content-encoding") };
}, room);

await browser.close();

const out = { label: LABEL, webOrigin: WEB, pageResponses: seen, manualFetch: wire };
save(`sse_headers_${LABEL}.json`, out);
console.log(JSON.stringify(out, null, 2));
