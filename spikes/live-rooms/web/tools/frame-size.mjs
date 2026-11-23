// Đo kích thước thật của từng khung SSE và từng phản hồi polling,
// để tách khoảng chênh AC2 (SSE vs polling) thành phần nào là gì.
//
// Chạy khi server Gin đang chạy: node tools/frame-size.mjs
const API = process.env.API_ORIGIN ?? "http://localhost:18160";
const room = "frame-size-" + Date.now();

const payload = "x".repeat(3894);
const snap = { v: 1, payload, sqlBytes: 3629, bytes: payload.length, hasPlan: true, rows: 100 };

// 1) Kích thước phản hồi polling 200 (JSON của struct snapshot).
const r = await fetch(`${API}/room/${room}/publish`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(snap),
});
const pubText = await r.text();
const poll = await fetch(`${API}/room/${room}/poll?v=0`);
const pollText = await poll.text();

// 2) Kích thước một khung SSE `snapshot`: dựng đúng như gin c.SSEvent.
// gin render: "event:" + name + "\ndata:" + json + "\n\n"
const sseFrame = (name, obj) => `event:${name}\ndata:${JSON.stringify(obj)}\n\n`;

const helloObj = { v: 1 };
const pingObj = { t: Date.now() };

const out = {
  note: "payload giả 3894 B để khớp AC2; đo kích thước khung, không đo nội dung",
  pollResponse200Bytes: Buffer.byteLength(pollText),
  publishResponseBytes: Buffer.byteLength(pubText),
  sseSnapshotFrameBytes: Buffer.byteLength(sseFrame("snapshot", snap)),
  sseHelloFrameBytes: Buffer.byteLength(sseFrame("hello", helloObj)),
  ssePingFrameBytes: Buffer.byteLength(sseFrame("ping", pingObj)),
  heartbeatMs: 15000,
};
out.sseOverheadPerEvent = out.sseSnapshotFrameBytes - payload.length;
out.pollOverheadPerEvent = out.pollResponse200Bytes - payload.length;
console.log(JSON.stringify(out, null, 2));
