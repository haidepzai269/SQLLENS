// Serves page.html + pglite dist, runs each level 3x on a fresh page (normal and 4x CPU throttle).
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "node_modules/@electric-sql/pglite/dist");
const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  const f = u === "/" ? path.join(here, "page.html") : u.startsWith("/pglite/") && !u.includes("..") ? path.join(dist, u.slice(8)) : null;
  if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  // COOP/COEP so measureUserAgentSpecificMemory is allowed
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream", "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const ps = (cmd) => execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();
// Renderers descending from OUR browser only (other Playwright browsers may run on the machine); largest by peak working set.
const token = "pgs" + process.pid;
function renderer() {
  const cmd = 'Set-StrictMode -Off; $all=Get-CimInstance Win32_Process; $ids=@(($all|?{$_.CommandLine -like "*--spike-token=' + token + '*" -and $_.CommandLine -notlike "*--type=*"}).ProcessId); do{$n=@($all|?{$ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId}|%{$_.ProcessId}); $ids+=$n}while($n.Count); $all|?{$ids -contains $_.ProcessId -and $_.CommandLine -like "*--type=renderer*"}|%{$p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if($p){"$($p.WorkingSet64) $($p.PeakWorkingSet64)"}}';
  const rows = ps(cmd).split(/\r?\n/).filter(Boolean).map((l) => l.split(" ").map(Number));
  return rows.sort((a, b) => b[1] - a[1])[0] || [null, null];
}

const browser = await chromium.launch({ args: ["--spike-token=" + token] });
const version = browser.version();
const LIMIT_MS = 120000;
const results = [];
for (const throttle of [1, 4]) for (const n of [10000, 100000, 500000]) for (let i = 1; i <= 3; i++) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const rec = { throttle, n, run: i };
  let crashed = false;
  const crash = new Promise((_, j) => page.on("crash", () => { crashed = true; j(new Error("TAB CRASHED")); }));
  try {
    await page.exposeFunction("hold", () => renderer()); // renderer [workingSet, peakWorkingSet] sampled from node while the page waits
    await page.goto(url);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await cdp.send("Performance.enable");
    const t0 = Date.now();
    const out = await Promise.race([
      page.evaluate((n) => window.run(n), n),
      new Promise((_, j) => setTimeout(() => j(new Error(`TIMEOUT >${LIMIT_MS / 1000}s`)), LIMIT_MS)),
      crash,
    ]);
    Object.assign(rec, out, { total_ms: Date.now() - t0 });
    const m = await cdp.send("Performance.getMetrics");
    rec.cdp_jsheap_used = m.metrics.find((x) => x.name === "JSHeapUsedSize")?.value;
    [rec.renderer_ws, rec.renderer_peak_ws] = renderer();
  } catch (e) { rec.error = String(e.message || e); rec.crashed = crashed; }
  results.push(rec);
  console.error(`[${throttle}x n=${n} #${i}]`, rec.error || `init ${Math.round(rec.init_ms)} ins ${Math.round(rec.insert_ms)} idx ${Math.round(rec.index_ms)} lvl ${rec.btree_level} peakWS ${Math.round(rec.renderer_peak_ws / 1e6)}MB`);
  await ctx.close();
}
await browser.close();
server.close();

const cpu = os.cpus();
const cfg = { cpu: `${cpu[0].model} x${cpu.length}`, ram_gb: (os.totalmem() / 2 ** 30).toFixed(1), chromium: version, node: process.version, os: `${os.type()} ${os.release()}`, pglite: "0.5.14" };
fs.writeFileSync(path.join(here, "results.json"), JSON.stringify({ cfg, results }, null, 1));
const med = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const f = (x, d = 0) => (x == null ? "-" : (+x).toFixed(d));
console.log(JSON.stringify(cfg));
console.log("cpu | rows | ok | init ms med/max | insert ms med/max | index ms med/max | level | idx KB | idxQ ms | idxQ pages | seqQ ms | seqQ pages | peakWS MB med/max | WS init cur/peak MB | WS after index cur/peak MB | uasm MB | cdpJS MB");
for (const th of [1, 4]) for (const n of [10000, 100000, 500000]) {
  const g = results.filter((r) => r.throttle === th && r.n === n), ok = g.filter((r) => !r.error);
  const mm = (k, d = 0, s = 1) => `${f(med(ok.map((r) => r[k] / s)), d)}/${f(ok.length ? Math.max(...ok.map((r) => r[k] / s)) : null, d)}`;
  console.log([`${th}x`, n, `${ok.length}/3${g.filter((r) => r.error).map((r) => " " + r.error).join("")}`, mm("init_ms"), mm("insert_ms"), mm("index_ms"), ok.map((r) => r.btree_level).join(","), f(ok[0]?.index_bytes / 1024), f(med(ok.map((r) => r.q_index.median_ms)), 2), ok[0]?.q_index.pages_total, f(med(ok.map((r) => r.q_seq.median_ms)), 1), ok[0]?.q_seq.pages_total, mm("renderer_peak_ws", 0, 1e6), `${f(med(ok.map((r) => r.mem_after_init[0] / 1e6)))}/${f(med(ok.map((r) => r.mem_after_init[1] / 1e6)))}`, `${f(med(ok.map((r) => r.mem_after_index[0] / 1e6)))}/${f(med(ok.map((r) => r.mem_after_index[1] / 1e6)))}`, ok.length && ok.every((r) => r.uasm != null) ? f(med(ok.map((r) => r.uasm / 1e6))) : "n/a", f(med(ok.map((r) => r.cdp_jsheap_used / 1e6)))].join(" | "));
}
