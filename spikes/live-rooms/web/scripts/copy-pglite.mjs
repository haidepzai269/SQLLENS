// Copy WASM + data của PGlite vào public/pglite để worker của spike tải được bằng fetch.
// Chạy tự động trước `next build`. Không sửa gì trong node_modules.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = join(root, "node_modules", "@electric-sql", "pglite", "dist");
const dst = join(root, "public", "pglite");

const files = ["pglite.wasm", "initdb.wasm", "pglite.data", "pageinspect.tar.gz"];

if (!existsSync(src)) {
  console.error(`không thấy ${src} — chạy npm install trước`);
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
for (const f of files) {
  copyFileSync(join(src, f), join(dst, f));
  console.log(`copied ${f}`);
}
