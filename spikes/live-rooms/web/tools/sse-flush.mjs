// SSE có bị Next gom đệm hay không — tách hai biến: `compress` của Next và header
// `Cache-Control: no-transform` của server.
//
// Vì sao phải tách: lần đo đầu chỉ thấy "compress-true vẫn stream", nhưng như vậy chưa nói
// được `compress: false` có bắt buộc hay không, vì server luôn gửi `no-transform`. Ở đây đo
// bốn tổ hợp (compress on/off × no-transform on/off) bằng cùng một phép: mở stream bằng
// `fetch` trong trang thật, đọc từng chunk, ghi lại thời điểm chunk đầu và từng sự kiện.
//
// Chạy: node tools/sse-flush.mjs <label>   (label chỉ để đặt tên file; Next đã khởi động sẵn)
import { launch, save, median, WEB, API, sleep } from "./lib.mjs";

const LABEL = process.argv[2] ?? "unknown";
const RUNS = Number(process.env.RUNS ?? 3);
const PAYLOAD_CHARS = Number(process.env.SSE_PAYLOAD ?? 3000);
const payload = "g." + "A".repeat(PAYLOAD_CHARS);

const variants = [
  { name: "no-transform=1", q: "" },
  { name: "no-transform=0", q: "?nt=0" },
];

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

for (const v of variants) {
  for (let i = 1; i <= RUNS; i++) {
    const room = `flush-${LABEL}-${v.name.replace(/\W/g, "")}-${Date.now()}-${i}`;
    await publish(room);

    const browser = await launch();
    const page = await browser.newPage();
    await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });

    // Mở stream, đọc chunk, rồi phát bản tin từ Node và xem chunk có tới ngay không.
    const start = await page.evaluate(
      async ({ roomId, q }) => {
        const ctrl = new AbortController();
        const t0 = performance.now();
        const res = await fetch(`/api/room/${roomId}/events${q}`, { signal: ctrl.signal });
        const ttfb = performance.now() - t0;
        const enc = res.headers.get("content-encoding");
        const cc = res.headers.get("cache-control");
        const reader = res.body.getReader();
        const chunks = [];
        const dec = new TextDecoder();
        let text = "";
        (async () => {
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              chunks.push({ at: performance.now() - t0, n: value.byteLength });
              text += dec.decode(value, { stream: true });
            }
          } catch {
            /* abort */
          }
        })();
        window.__sse = { ctrl, chunks, text: () => text, t0, ttfb, enc, cc };
        return { ttfb, enc, cc };
      },
      { roomId: room, q: v.q },
    );

    await sleep(1_000);
    const before = await page.evaluate(() => window.__sse.chunks.length);
    const sentAt = await publish(room);

    // Chờ tối đa 20 s để chunk mang sự kiện `snapshot` tới.
    let arrivedAt = null;
    const tWait = Date.now();
    while (Date.now() - tWait < 20_000) {
      const r = await page.evaluate((n) => ({ n: window.__sse.chunks.length, t: window.__sse.text() }), before);
      if (r.n > before && r.t.includes("event:snapshot")) {
        arrivedAt = Date.now() - sentAt;
        break;
      }
      await sleep(20);
    }
    const chunkInfo = await page.evaluate(() => window.__sse.chunks.slice(0, 6));
    await page.evaluate(() => window.__sse.ctrl.abort());
    await browser.close();

    runs.push({
      variant: v.name,
      run: i,
      ttfbMs: start.ttfb,
      contentEncoding: start.enc,
      cacheControl: start.cc,
      firstChunks: chunkInfo,
      snapshotArrivedMs: arrivedAt,
      streamed: arrivedAt !== null && arrivedAt < 5_000,
    });
    console.log(
      `[${LABEL} ${v.name}] lần ${i}: ttfb=${start.ttfb.toFixed(0)}ms enc=${start.enc} cc="${start.cc}" snapshot=${arrivedAt}ms stream=${arrivedAt !== null && arrivedAt < 5000}`,
    );
    await sleep(500);
  }
}

const byVariant = {};
for (const v of variants) {
  const rs = runs.filter((r) => r.variant === v.name);
  byVariant[v.name] = {
    ttfbMs: median(rs.map((r) => r.ttfbMs)),
    snapshotArrivedMs: median(rs.map((r) => r.snapshotArrivedMs).filter((x) => x !== null)),
    streamed: rs.every((r) => r.streamed),
    contentEncoding: rs.map((r) => r.contentEncoding),
  };
}

save(`sse_flush_${LABEL}.json`, { label: LABEL, webOrigin: WEB, payloadChars: PAYLOAD_CHARS, runs, byVariant });
console.log(JSON.stringify(byVariant, null, 2));
