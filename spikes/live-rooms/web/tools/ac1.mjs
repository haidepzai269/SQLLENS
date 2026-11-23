// AC1 — byte mỗi lần phát. Chạy 3 lần, mỗi lần một trang mới, ghi cả 3 và trung vị.
//
// Mọi con số đều do chính codec SP022 tính trên dữ liệu thật PGlite sinh ra trong Chromium.
// Script chỉ thu thập, không tính lại, không làm tròn.
import { launch, save, waitFor, median, WEB, sleep } from "./lib.mjs";

const runs = [];
const N = Number(process.env.RUNS ?? 3);

for (let i = 1; i <= N; i++) {
  const browser = await launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  const t0 = Date.now();
  await page.goto(`${WEB}/ac1`, { waitUntil: "domcontentloaded" });
  const r = await waitFor(page, "__ac1");
  const wallMs = Date.now() - t0;
  await browser.close();

  if (r.error) {
    console.error(`lần ${i}: LỖI ${r.error}\n${errors.join("\n")}`);
    process.exitCode = 1;
    continue;
  }
  const live = r.rows[0];
  const share = r.rows[1];
  const run = {
    run: i,
    wallMs,
    livePayloadBytes: live.payloadBytes,
    liveJsonBytes: live.jsonBytes,
    liveGzipBytes: live.gzipBytes,
    sharePayloadBytes: share.payloadBytes,
    shareJsonBytes: share.jsonBytes,
    rawSqlBytes: r.meta.sqlAttributable.rawSqlBytes,
    sqlAttributableLive: r.meta.sqlAttributable.live.delta,
    sqlAttributableShare: r.meta.sqlAttributable.share.delta,
    planJsonBytes: r.meta.planJsonBytes,
    resultBytes: r.meta.resultBytes,
    resultRowCount: r.meta.resultRowCount,
    tabSqlBytes: r.meta.tabSqlBytes,
    limits: r.meta.limits,
    edges: r.meta.edges,
    errors,
  };
  runs.push(run);
  console.log(
    `lần ${i}: live=${run.livePayloadBytes}B share=${run.sharePayloadBytes}B sql=${run.rawSqlBytes}B wall=${wallMs}ms`,
  );
  await sleep(500);
}

const pick = (k) => runs.map((r) => r[k]);
const summary = {
  runs,
  median: {
    livePayloadBytes: median(pick("livePayloadBytes")),
    liveJsonBytes: median(pick("liveJsonBytes")),
    liveGzipBytes: median(pick("liveGzipBytes")),
    sharePayloadBytes: median(pick("sharePayloadBytes")),
    shareJsonBytes: median(pick("shareJsonBytes")),
    rawSqlBytes: median(pick("rawSqlBytes")),
    sqlAttributableLive: median(pick("sqlAttributableLive")),
    sqlAttributableShare: median(pick("sqlAttributableShare")),
    planJsonBytes: median(pick("planJsonBytes")),
    resultBytes: median(pick("resultBytes")),
    wallMs: median(pick("wallMs")),
  },
  // Trần: payload live so với 32 KB. Không làm tròn xuống.
  ratio: runs.length
    ? {
        liveOverShare: runs[0].livePayloadBytes / runs[0].sharePayloadBytes,
        liveOverHardLimitPct: (runs[0].livePayloadBytes / 32768) * 100,
        liveOverWarnLimitPct: (runs[0].livePayloadBytes / 8192) * 100,
      }
    : null,
};
save("ac1.json", summary);
console.log(JSON.stringify(summary.median, null, 2));
