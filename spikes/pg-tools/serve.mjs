// Tiny static server: / -> dist, /pglite/ -> pglite dist (pglite loads wasm/data/tar.gz relative to its own URL).
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".gz": "application/gzip", ".data": "application/octet-stream" };
const roots = [["/pglite/", "node_modules/@electric-sql/pglite/dist/"], ["/", "dist/"]];
createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const [prefix, dir] = roots.find(([p]) => path.startsWith(p));
  const file = normalize(join(dir, path.slice(prefix.length) || "index.html"));
  if (!file.startsWith(normalize(dir)) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(4173, "127.0.0.1");
