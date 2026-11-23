// Tính dòng "trong đó bao nhiêu byte là SQL của người dùng" cho AC2 và AC4.
//
// CÁCH TÍNH: AC1 đo `sqlAttributableLive` = 1.700 B, là phần payload quy được cho
// SQL của người dùng (đo bằng phép trừ: payload có SQL so với payload thay SQL bằng
// chuỗi rỗng). Mỗi `snapshot` chở đúng một payload, nên:
//
//     byte SQL mỗi phút = số snapshot × 1.700 / cửa sổ × 60.000
//
// Chỉ nhân với các sự kiện `snapshot`. `hello` và `ping` KHÔNG chở SQL, và khung
// `event:…\ndata:…\n\n` cũng không. Vì vậy không nhân tỉ lệ với toàn bộ byte thân.
//
// Chạy: node tools/sql-line.mjs   (đọc results/*.json, ghi results/sql_line.json)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const B = join(process.cwd(), "results");
const read = (n) => JSON.parse(readFileSync(join(B, n), "utf8"));
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const ac1 = read("ac1.json");
// Byte SQL trong MỘT payload, đo trực tiếp ở AC1 (phép trừ, không phải tỉ lệ).
const SQL_PER_SNAPSHOT = ac1.runs[0].sqlAttributableLive; // 1700
const PAYLOAD = ac1.runs[0].livePayloadBytes; // 3909, chỉ dùng để đối chiếu

const sqlBpmOf = (snapshots, windowMs) => ((snapshots * SQL_PER_SNAPSHOT) / windowMs) * 60_000;

const out = {
  method: "số snapshot × 1.700 B / cửa sổ × 60.000",
  sqlPerSnapshot: SQL_PER_SNAPSHOT,
  ac1PayloadBytes: PAYLOAD,
  note: "chỉ nhân byte SQL với sự kiện snapshot; hello/ping/khung SSE không chở SQL",
  ac2: {},
  ac4: {},
};

// ---------- AC2 ----------
const sse = read("ac2_sse_publish.json");
const poll = read("ac2_poll_publish.json");
const idle = read("ac2_sse_idle.json");

// SSE: `viewerEvents` đếm cả `hello` (trang viewer tăng biến đếm trong cả hai
// handler), nên số snapshot = viewerEvents − 1. Đây là số đo từ trình duyệt.
out.ac2.sse = sse.runs.map((r) => {
  const snapshots = Math.max(0, r.viewerEvents - 1);
  const sqlBpm = sqlBpmOf(snapshots, r.windowMs);
  const naive = r.bodyPerMinute * (SQL_PER_SNAPSHOT / PAYLOAD);
  return {
    run: r.run,
    windowMs: r.windowMs,
    bodyBytes: r.bodyBytes,
    viewerEvents: r.viewerEvents,
    snapshots,
    sqlBpm,
    sqlBpmNaiveWrong: naive,
    overstatePct: (naive / sqlBpm - 1) * 100,
  };
});

// Polling: mỗi phản hồi 200 chở đúng một payload; 304 không có thân.
out.ac2.poll = poll.runs.map((r) => {
  const snapshots = r.byStatus["200"] ?? 0;
  const sqlBpm = sqlBpmOf(snapshots, r.windowMs);
  const naive = r.bodyPerMinute * (SQL_PER_SNAPSHOT / PAYLOAD);
  return {
    run: r.run,
    windowMs: r.windowMs,
    bodyBytes: r.bodyBytes,
    snapshots,
    sqlBpm,
    sqlBpmNaiveWrong: naive,
    overstatePct: (naive / sqlBpm - 1) * 100,
  };
});

// Phòng đứng yên: không có snapshot nào -> 0 byte SQL. Không suy từ byte nền.
out.ac2.idle = {
  runs: idle.runs.map((r) => ({ run: r.run, bodyBytes: r.bodyBytes, snapshots: 0, sqlBpm: 0 })),
  sqlBpm: 0,
  note: "thân 162 B là hello+ping, không chở SQL",
};

// ---------- AC4 ----------
// `sseEvents` cộng dồn qua các lần chạy (reset endpoint không xóa nó), nên số mỗi
// lần là hiệu hai lần liền kề; lần 1 không suy được -> dùng hiệu của lần 2 (=1.770),
// và ghi rõ là suy từ lần sau.
const ac4sse = read("ac4_sse.json");
const deltas = [];
for (let i = 1; i < ac4sse.runs.length; i++) {
  deltas.push(ac4sse.runs[i].sseEvents - ac4sse.runs[i - 1].sseEvents);
}
out.ac4.sseEventDeltas = deltas;

out.ac4.sse = ac4sse.runs.map((r, i) => {
  const snapsTotal = i === 0 ? deltas[0] : deltas[i - 1];
  const snapshots = snapsTotal / r.viewers;
  const sqlBpm = sqlBpmOf(snapshots, r.windowMs);
  const perViewer = r.bytesByRoute.events / r.viewers;
  const naive = ((perViewer / r.windowMs) * 60_000) * (SQL_PER_SNAPSHOT / PAYLOAD);
  return {
    run: r.run,
    windowMs: r.windowMs,
    perViewerBytes: perViewer,
    snapshotsPerViewer: snapshots,
    sqlBpm,
    sqlBpmNaiveWrong: naive,
    overstatePct: (naive / sqlBpm - 1) * 100,
  };
});

const ac4poll = read("ac4_poll.json");
out.ac4.poll = ac4poll.runs.map((r) => {
  const snapshots = r.statusByRoute.poll_200 / r.viewers;
  const sqlBpm = sqlBpmOf(snapshots, r.windowMs);
  const perViewer = r.bytesByRoute.poll / r.viewers;
  const naive = ((perViewer / r.windowMs) * 60_000) * (SQL_PER_SNAPSHOT / PAYLOAD);
  return {
    run: r.run,
    windowMs: r.windowMs,
    perViewerBytes: perViewer,
    snapshotsPerViewer: snapshots,
    sqlBpm,
    sqlBpmNaiveWrong: naive,
    overstatePct: (naive / sqlBpm - 1) * 100,
  };
});

out.ac2.sseMedian = { sqlBpm: med(out.ac2.sse.map((x) => x.sqlBpm)), sqlBpmNaiveWrong: med(out.ac2.sse.map((x) => x.sqlBpmNaiveWrong)) };
out.ac2.pollMedian = { sqlBpm: med(out.ac2.poll.map((x) => x.sqlBpm)), sqlBpmNaiveWrong: med(out.ac2.poll.map((x) => x.sqlBpmNaiveWrong)) };
out.ac4.sseMedian = { sqlBpm: med(out.ac4.sse.map((x) => x.sqlBpm)), sqlBpmNaiveWrong: med(out.ac4.sse.map((x) => x.sqlBpmNaiveWrong)) };
out.ac4.pollMedian = { sqlBpm: med(out.ac4.poll.map((x) => x.sqlBpm)), sqlBpmNaiveWrong: med(out.ac4.poll.map((x) => x.sqlBpmNaiveWrong)) };

const text = JSON.stringify(out, null, 2);
writeFileSync(join(B, "sql_line.json"), text + "\n");
console.log(text);
