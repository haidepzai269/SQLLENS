// Kiểm `NEXT_COMPRESS=1` có thật sự bật nén hay không.
//
// Nếu bật mà trang HTML vẫn không có `content-encoding: gzip`, thì phép thử SSE với
// "compress-true" không chứng minh được gì (nén chưa từng chạy), và phải ghi là CHƯA ĐO ĐƯỢC
// chứ không được kết luận "compress: false không cần thiết".
//
// Chạy: node tools/compress-check.mjs <label>
import { save, WEB } from "./lib.mjs";

const LABEL = process.argv[2] ?? "unknown";

async function probe(path, headers) {
  const res = await fetch(`${WEB}${path}`, { headers });
  // Đọc hết để server có cơ hội ghi xong.
  const buf = await res.arrayBuffer();
  return {
    path,
    status: res.status,
    contentEncoding: res.headers.get("content-encoding"),
    contentType: res.headers.get("content-type"),
    transferEncoding: res.headers.get("transfer-encoding"),
    contentLength: res.headers.get("content-length"),
    bytesOnWire: buf.byteLength,
  };
}

const gzipAsk = { "accept-encoding": "gzip, deflate, br" };
const out = {
  label: LABEL,
  html: await probe("/", gzipAsk),
  chunk: null,
  api: await probe("/api/healthz", gzipAsk),
};
// Một file JS tĩnh để so: nếu cả HTML và JS đều không nén thì nén đang tắt.
try {
  const home = await (await fetch(`${WEB}/`, gzipAsk)).text();
  const m = home.match(/\/_next\/static\/chunks\/[^"']+\.js/);
  if (m) out.chunk = await probe(m[0], gzipAsk);
} catch {
  /* không quan trọng */
}

save(`compress_check_${LABEL}.json`, out);
console.log(JSON.stringify(out, null, 2));
