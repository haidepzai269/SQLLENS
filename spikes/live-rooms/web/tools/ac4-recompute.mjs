// Tính lại số "byte mỗi viewer mỗi phút" chỉ từ byte thuộc về viewer.
//
// Vì sao cần: `ac4.mjs` chia tổng byte (gồm cả route `publish` do HOST gọi) cho số viewer.
// Route publish không phải lưu lượng của viewer, nên số đó cao hơn thực tế. Ở đây tách:
//   - byte chỉ của viewer = bytes.events + bytes.poll
//   - rồi mới chia cho 30 viewer và cho số phút
//
// Script này KHÔNG tính dòng SQL. Dòng SQL cần số `snapshot` thật, mà tỉ lệ phần trăm
// SQL trong payload là cách tính sai (xem tools/sql-line.mjs). Muốn số SQL: chạy
// tools/sql-line.mjs.
// Chạy: node tools/ac4-recompute.mjs
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
const SQL_SHARE = ac1.runs[0].sqlAttributableLive / ac1.runs[0].livePayloadBytes;

const out = { sqlShareOfPayload: SQL_SHARE, modes: {} };
for (const [mode, fn] of [
  ["sse", "ac4_sse.json"],
  ["poll", "ac4_poll.json"],
]) {
  const a = read(fn);
  const rows = a.runs.map((r) => {
    const viewerBytes = (r.bytesByRoute.events ?? 0) + (r.bytesByRoute.poll ?? 0);
    const hostBytes = r.bytesByRoute.publish ?? 0;
    const bpmViewer = ((viewerBytes / r.windowMs) * 60_000) / 30;
    return {
      run: r.run,
      viewerBytes,
      hostBytes,
      bpmViewer,
      // Tên mang chữ `_naiveWrong` để không ai đọc nhầm đây là số đúng.
      sqlBpm_naiveWrong: bpmViewer * SQL_SHARE,
      requests: r.requests,
      status: r.statusByRoute,
    };
  });
  out.modes[mode] = {
    runs: rows,
    median: {
      viewerBytes: med(rows.map((x) => x.viewerBytes)),
      bpmViewer: med(rows.map((x) => x.bpmViewer)),
      sqlBpm_naiveWrong: med(rows.map((x) => x.sqlBpm_naiveWrong)),
    },
  };
}

const text = JSON.stringify(out, null, 2);
writeFileSync(join(B, "ac4_recompute.json"), text + "\n");
console.log(text);
