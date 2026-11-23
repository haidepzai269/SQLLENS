// AC2 — byte mỗi viewer mỗi phút, tách riêng dòng "byte là SQL của người dùng".
//
// Cách đo: viewer là một tab Chromium thật, tải trang /viewer của bản `next build` +
// `next start`; mọi request đi qua `rewrites` của Next sang Gin. Byte được đếm bằng CDP
// `Network.dataReceived` (byte thân phản hồi thật qua dây, kể cả SSE đang mở) cộng độ dài
// khối header phản hồi dựng lại từ `Network.responseReceived`.
//
// Host phát payload thật (do codec SP022 tạo ra ở AC1) lên Gin mỗi `EVERY` ms.
// Chạy: node tools/ac2.mjs sse|poll
import { launch, save, waitFor, median, wireCounter, WEB, API, sleep } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MODE = process.argv[2] ?? "poll";
const RUNS = Number(process.env.RUNS ?? 3);
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 60_000);
const EVERY_MS = Number(process.env.EVERY_MS ?? 10_000);
const POLL_MS = Number(process.env.POLL_MS ?? 2_000);
// PUBLISH=0: đo lúc phòng đứng yên (chỉ có nhịp thăm dò / heartbeat). Đây mới là chi phí nền
// của một phòng đang mở, và là con số quan trọng nhất cho hoá đơn.
const PUBLISH = process.env.PUBLISH !== "0";

// Payload thật: lấy từ lần đo AC1 (cùng máy, cùng codec). Nếu chưa có thì dừng, không bịa.
let ac1;
try {
  ac1 = JSON.parse(readFileSync(join(process.cwd(), "results", "ac1.json"), "utf8"));
} catch {
  console.error("chưa có results/ac1.json — chạy tools/ac1.mjs trước");
  process.exit(1);
}
const PAYLOAD_BYTES = ac1.runs[0].livePayloadBytes;
const SQL_BYTES = ac1.runs[0].rawSqlBytes;

// Payload thật cần chuỗi thật, không chỉ độ dài. Lấy lại từ trang host.
async function fetchPayload() {
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(`${WEB}/host?room=payloadsrc&every=999999`, { waitUntil: "domcontentloaded" });
  await waitFor(page, "__hostReady");
  const p = await page.evaluate(() => window.__hostPayload);
  const meta = await page.evaluate(() => window.__host);
  await browser.close();
  return { payload: p, meta };
}

const { payload, meta } = await fetchPayload();
console.log(`payload thật: ${payload.length} B, sqlBytes=${meta.sqlBytes}, rows=${meta.rows}`);

const room = `ac2-${MODE}`;
const publish = async () =>
  fetch(`${API}/room/${room}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      v: 0,
      payload,
      sqlBytes: meta.sqlBytes,
      bytes: payload.length,
      hasPlan: true,
      rows: meta.rows,
    }),
  });

await fetch(`${API}/metrics/reset`, { method: "POST" });
await publish(); // phiên bản đầu để viewer có gì đó ngay

const runs = [];
for (let i = 1; i <= RUNS; i++) {
  const browser = await launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const wire = await wireCounter(page, "/api/");

  // Cửa sổ đo bắt đầu NGAY trước khi mở trang, để tính cả chi phí mở kết nối (với SSE,
  // header và request chỉ trả một lần lúc nối; nếu bắt đầu đếm sau khi nối thì phần đó
  // biến mất khỏi phép đo và con số sẽ thấp hơn thực tế).
  const t0 = Date.now();
  const url = `${WEB}/viewer?mode=${MODE}&room=${room}&interval=${POLL_MS}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(3_000); // để kết nối/EventSource ổn định rồi mới bắt đầu phát

  // Host phát đều trong cửa sổ đo (nếu PUBLISH bật).
  // Đếm số lần phát THẬT SỰ xảy ra, không suy từ thời gian: ở chế độ đứng yên
  // không có lần phát nào, mà suy theo `elapsed / EVERY_MS` lại ra 6.
  let publishing = PUBLISH;
  let publishesDone = 0;
  const pubLoop = (async () => {
    while (publishing) {
      await sleep(EVERY_MS);
      if (!publishing) break;
      await publish();
      publishesDone++;
    }
  })();

  await sleep(WINDOW_MS);
  publishing = false;
  await pubLoop;

  const elapsed = Date.now() - t0;
  const viewer = await page.evaluate(() => ({ ...window.__viewer }));
  await browser.close();

  const run = {
    run: i,
    mode: MODE,
    publishing: PUBLISH,
    windowMs: elapsed,
    requests: wire.requests,
    bodyBytes: wire.body,
    headerBytes: wire.headers,
    totalBytes: wire.body + wire.headers,
    byStatus: wire.byStatus,
    byUrl: wire.byUrl,
    viewerEvents: viewer.events,
    viewerPolls: viewer.polls,
    viewerNotModified: viewer.notModified,
    viewerErrors: viewer.errors,
    publishesInWindow: publishesDone,
    errors,
  };
  run.bytesPerMinute = (run.totalBytes / elapsed) * 60_000;
  run.bodyPerMinute = (run.bodyBytes / elapsed) * 60_000;
  // Byte quy được cho SQL. CHỈ nhân tỉ lệ SQL với byte của sự kiện `snapshot`, KHÔNG nhân
  // với toàn bộ byte thân: thân còn chứa `hello` (một lần khi nối) và `ping` (heartbeat
  // 15 giây), hai loại này không chở SQL. Nhân lên toàn bộ thổi số lên 3,1-3,9 %.
  // Xem tools/sql-line.mjs để biết cách tính đầy đủ (gồm cả AC4).
  run.sqlShareOfPayload = ac1.runs[0].sqlAttributableLive / PAYLOAD_BYTES;
  if (!PUBLISH) {
    // Phòng đứng yên: không có snapshot nào -> không có byte SQL nào.
    run.sqlBytesPerMinute = 0;
  } else if (MODE === "sse") {
    // Số snapshot thật = số lần phát trong cửa sổ trừ lần phát đầu (xảy ra trước cửa sổ).
    const snapshots = Math.max(0, run.publishesInWindow - 1);
    run.sqlBytesPerMinute = ((snapshots * PAYLOAD_BYTES * run.sqlShareOfPayload) / elapsed) * 60_000;
  } else {
    // Polling: mỗi phản hồi 200 chở đúng một payload; 304 không có thân.
    const n200 = run.byStatus["200"] ?? 0;
    run.sqlBytesPerMinute = ((n200 * PAYLOAD_BYTES * run.sqlShareOfPayload) / elapsed) * 60_000;
  }
  // Giữ lại con số cũ để đối chiếu, đánh dấu rõ là SAI.
  run.sqlBytesPerMinute_naiveWrong = run.bodyPerMinute * run.sqlShareOfPayload;
  runs.push(run);
  console.log(
    `lần ${i} [${MODE}]: ${run.requests} req, body=${run.bodyBytes}B head=${run.headerBytes}B tổng=${run.totalBytes}B/${elapsed}ms -> ${run.bytesPerMinute.toFixed(1)} B/phút; SQL≈${run.sqlBytesPerMinute.toFixed(1)} B/phút; status=${JSON.stringify(run.byStatus)}`,
  );
  await sleep(1_000);
}

const pick = (k) => runs.map((r) => r[k]);
const summary = {
  mode: MODE,
  config: {
    windowMs: WINDOW_MS,
    publishEveryMs: PUBLISH ? EVERY_MS : null,
    pollMs: POLL_MS,
    payloadBytes: payload.length,
    sqlBytes: SQL_BYTES,
  },
  sqlShareOfPayload: ac1.runs[0].sqlAttributableLive / PAYLOAD_BYTES,
  runs,
  median: {
    requests: median(pick("requests")),
    bodyBytes: median(pick("bodyBytes")),
    headerBytes: median(pick("headerBytes")),
    totalBytes: median(pick("totalBytes")),
    bytesPerMinute: median(pick("bytesPerMinute")),
    bodyPerMinute: median(pick("bodyPerMinute")),
    sqlBytesPerMinute: median(pick("sqlBytesPerMinute")),
    viewerEvents: median(pick("viewerEvents")),
  },
};
save(`ac2_${MODE}_${PUBLISH ? "publish" : "idle"}.json`, summary);
console.log(JSON.stringify(summary.median, null, 2));
