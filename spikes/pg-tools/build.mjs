// Bundle parser code for the browser and copy the static page + libpg-query wasm into dist/.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
const common = { bundle: true, format: "esm", platform: "browser", minify: true, external: ["node:*"], logLevel: "warning" };
await build({ ...common, entryPoints: { "pg-parser": "src/pg-parser.js" }, outdir: "dist" });
await build({ ...common, entryPoints: { "my-parser": "src/my-parser.js" }, outdir: "dist" });
cpSync("src/index.html", "dist/index.html");
cpSync("src/app.js", "dist/app.js");
// libpg-query resolves its wasm next to the page (ESM script => no currentScript), so copy it beside index.html.
cpSync("node_modules/libpg-query/wasm/libpg-query.wasm", "dist/libpg-query.wasm");
