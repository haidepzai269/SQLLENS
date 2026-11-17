// Turbopack không bundle được `new Worker(new URL(proxyUri, import.meta.url))` trong
// @sqlite.org/sqlite-wasm/dist/sqlite3-worker1.mjs (URL động → "Can't resolve <dynamic>").
// Ứng dụng dùng database SQLite trong bộ nhớ (Task132/133), không dùng OPFS, nên file này chỉ cần
// tồn tại để build qua; loader thay nội dung bằng một module rỗng.
module.exports = function sqliteOpfsStub() {
  return "export default function opfsProxyUnavailable() {\n  throw new Error('OPFS proxy worker is not bundled; SQLite runs in memory.');\n}\n";
};
