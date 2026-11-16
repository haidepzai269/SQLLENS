// Script đo tự động cho Task131: chạy Chrome thật qua Playwright, phục vụ harness
// với COOP/COEP (để có OPFS) và gzip (giống CDN thật), in ra JSON số đo.
// Chạy: node spikes/sqlite-wasm/measure.mjs
// Không phải code sản phẩm; không thêm dependency vào web/.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { chromium } = require("playwright");

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const URL_BASE = `http://127.0.0.1:${PORT}`;
// Tắt VFS `opfs`/`opfs-wl` cổ điển: harness dùng SAH pool, và hai VFS kia kéo thêm
// sqlite3-opfs-async-proxy.js mà không dùng được trong cách phục vụ file này.
const HARNESS_URL = `${URL_BASE}/?autostart=1&opfs-disable&opfs-wl-disable`;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
};

const STARTED = Date.now();
const step = (msg) => console.error(`[${((Date.now() - STARTED) / 1000).toFixed(1)}s] ${msg}`);
const MB = (bytes) => (bytes == null ? null : Number((bytes / 1048576).toFixed(2)));
const gzipCache = new Map();

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, URL_BASE).pathname);
    const rel = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^([/\\])+/, "");
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    const headers = {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      // COOP/COEP: bắt buộc cho OPFS.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      // Cho phép đo "lần sau" bằng cache thật của trình duyệt.
      "Cache-Control": rel.startsWith("vendor/") ? "public, max-age=3600" : "no-store",
    };

    // CDN thật nén JS/WASM; không nén ở đây sẽ đo sai thời gian tải lần đầu.
    const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
    if (acceptsGzip && /\.(mjs|js|wasm)$/.test(file)) {
      let gz = gzipCache.get(file);
      if (!gz) {
        gz = gzipSync(await readFile(file));
        gzipCache.set(file, gz);
      }
      res.writeHead(200, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
      res.end(gz);
      return;
    }

    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

const waitReady = (page, timeout = 240000) =>
  page.waitForFunction(() => window.__harnessReady === true, null, { timeout });

// Gộp entry của trang và worker, khử trùng theo tên (index.mjs có thể xuất hiện ở cả hai).
function mergeResources(entries) {
  const byName = new Map();
  for (const e of entries ?? []) {
    const prev = byName.get(e.name);
    if (!prev || (e.decodedBodySize ?? 0) > (prev.decodedBodySize ?? 0)) byName.set(e.name, e);
  }
  return [...byName.values()];
}

function summarizeBundle(entries) {
  const files = mergeResources(entries).filter((e) => /^(index\.mjs|sqlite3\.wasm)$/.test(e.name));
  const sum = (key) => files.reduce((acc, f) => acc + (f[key] ?? 0), 0);
  return {
    files,
    decodedKB: Number((sum("decodedBodySize") / 1024).toFixed(1)),
    gzipKB: Number((sum("encodedBodySize") / 1024).toFixed(1)),
  };
}

let browser = null;

async function main() {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  step(`server ${URL_BASE}`);

  browser = await chromium
    .launch({ channel: "chrome", headless: true })
    .catch(() => chromium.launch({ headless: true }));
  const browserVersion = browser.version();
  step(`browser ${browserVersion}`);

  const report = {
    measuredAt: new Date().toISOString(),
    machine: {
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model?.trim(),
      cores: os.cpus().length,
      totalRamGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
      freeRamGB: Number((os.freemem() / 1024 ** 3).toFixed(1)),
    },
    browser: browserVersion,
    bundle: null,
    load: {},
    rows: {},
    twentyColumns: null,
    memoryVfs500k: null,
    opfs: null,
    storage: null,
    baseline: null,
  };

  // ---------- 1. Tải lần đầu trên mạng thường (cache tắt) ----------
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    void page.on("pageerror", (e) => console.error("[pageerror]", e.message));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

    const t0 = Date.now();
    await page.goto(HARNESS_URL, { waitUntil: "load", timeout: 240000 });
    step("cold fast: wait ready");
    await waitReady(page);
    const resources = await page.evaluate(() => window.__harness.resources());
    report.load.coldFast = {
      note: "Chrome thật, mạng local, cache tắt, server gzip như CDN",
      readyPerformanceNowMs: Math.round(await page.evaluate(() => window.__readyMs)),
      wallClockMs: Date.now() - t0,
      resources: mergeResources(resources),
    };
    report.bundle = summarizeBundle(resources);

    // ---------- 2. Tải lần sau (cache thật, mạng local) ----------
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
    step("warm reload");
    await page.reload({ waitUntil: "load" });
    await waitReady(page);
    report.load.warm = {
      note: "Chrome thật, cache bật, mạng local",
      readyPerformanceNowMs: Math.round(await page.evaluate(() => window.__readyMs)),
    };
    await ctx.close();
  }

  // ---------- 3. Tải lần đầu trên Slow 3G (cache tắt) ----------
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    void page.on("pageerror", (e) => console.error("[pageerror]", e.message));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 400,
      downloadThroughput: Math.round((400 * 1024) / 8),
      uploadThroughput: Math.round((400 * 1024) / 8),
    });

    const t0 = Date.now();
    await page.goto(HARNESS_URL, { waitUntil: "load", timeout: 240000 });
    step("cold 3G: wait ready");
    await waitReady(page);
    report.load.coldSlow3G = {
      note: "Chrome thật, cache tắt, Slow 3G (400ms latency, 400kbps), server gzip như CDN",
      readyPerformanceNowMs: Math.round(await page.evaluate(() => window.__readyMs)),
      wallClockMs: Date.now() - t0,
    };
    await ctx.close();
  }

  // ---------- 4. RAM theo số dòng (OPFS nếu có) ----------
  step("scenario context");
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    void page.on("pageerror", (e) => console.error("[pageerror]", e.message));
    await page.goto(HARNESS_URL, { waitUntil: "load", timeout: 240000 });
    await waitReady(page);
    step("scenario ready");

    const lib = await page.evaluate(() => window.__harness.libInfo);
    report.opfs = { available: lib.opfsAvailable, vfs: lib.vfs, crossOriginIsolated: lib.crossOriginIsolated };
    report.storage = await page.evaluate(() => window.__harness.storageInfo());

    const baseline = await page.evaluate(() => window.__harness.memory());
    report.baseline = {
      wasmHeapMB: baseline.worker.wasmMemoryMB,
      pageAgentMB: MB(baseline.page.totalBytes),
      pageMethod: baseline.page.method,
    };

    await page.evaluate(() => window.__harness.reset(0));

    const measureAt = async (label, insertRows) => {
      step(`insert ${label}`);
      const res = await page.evaluate((n) => window.__harness.insert(n), insertRows);
      step(`inserted ${label} in ${Math.round(res.ms)}ms`);
      const mem = await page.evaluate(() => window.__harness.memory());
      const count = await page.evaluate(() => window.__harness.count());
      const exported = await page.evaluate(() => window.__harness.exportDb());
      report.rows[label] = {
        rows: count.rows,
        insertMs: Math.round(res.ms),
        wasmHeapMB: mem.worker.wasmMemoryMB,
        pageAgentMB: MB(mem.page.totalBytes),
        pageMethod: mem.page.method,
        pageError: mem.page.error ?? null,
        exportMB: MB(exported.bytes),
      };
    };

    await measureAt("10k", 10000);
    await measureAt("100k", 90000);
    await measureAt("500k", 400000);

    // ---------- 5. OPFS còn dữ liệu sau khi tải lại? ----------
    step("reload persistence");
    await page.reload({ waitUntil: "load" });
    await waitReady(page);
    step("persistence ready");
    const libAfterReload = await page.evaluate(() => window.__harness.libInfo);
    try {
      const afterReload = await page.evaluate(() => window.__harness.count());
      report.opfs.persistenceAfterReload = { rows: afterReload.rows, vfs: libAfterReload.vfs };
    } catch (err) {
      // Ghi rõ là mất dữ liệu thay vì làm sập cả lượt đo.
      report.opfs.persistenceAfterReload = { rows: null, vfs: libAfterReload.vfs, error: String(err) };
    }

    // ---------- 6. Ca biên: bảng 20 cột × 100k ----------
    step("20 columns / 100k");
    const wideInsert = await page.evaluate(async () => {
      await window.__harness.reset(15);
      return window.__harness.insert(100000, 15);
    });
    const wideMem = await page.evaluate(() => window.__harness.memory());
    const wideCount = await page.evaluate(() => window.__harness.count());
    report.twentyColumns = {
      rows: wideCount.rows,
      insertMs: Math.round(wideInsert.ms),
      wasmHeapMB: wideMem.worker.wasmMemoryMB,
      pageAgentMB: MB(wideMem.page.totalBytes),
    };

    await ctx.close();
  }

  // ---------- 7. So sánh: không có OPFS thì 500k nằm hết trong RAM ----------
  step("memory VFS 500k");
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    void page.on("pageerror", (e) => console.error("[pageerror]", e.message));
    await page.goto(`${HARNESS_URL}&memory=1`, { waitUntil: "load", timeout: 240000 });
    await waitReady(page);
    const lib = await page.evaluate(() => window.__harness.libInfo);
    await page.evaluate(() => window.__harness.reset(0));
    const res = await page.evaluate(() => window.__harness.insert(500000));
    const mem = await page.evaluate(() => window.__harness.memory());
    const exported = await page.evaluate(() => window.__harness.exportDb());
    report.memoryVfs500k = {
      vfs: lib.vfs,
      insertMs: Math.round(res.ms),
      wasmHeapMB: mem.worker.wasmMemoryMB,
      pageAgentMB: MB(mem.page.totalBytes),
      exportMB: MB(exported.bytes),
    };
    await ctx.close();
  }

  // ---------- 8. WebKit của Playwright — KHÔNG phải Safari, chỉ là điểm tham chiếu ----------
  step("webkit");
  try {
    const { webkit } = require("playwright");
    const wb = await webkit.launch({ headless: true });
    const page = await wb.newPage();
    await page.goto(HARNESS_URL, { waitUntil: "load", timeout: 120000 });
    await waitReady(page, 120000);
    const lib = await page.evaluate(() => window.__harness.libInfo);
    await page.evaluate(() => window.__harness.reset(0));
    await page.evaluate(() => window.__harness.insert(10000));
    report.webkit = {
      note: "Playwright WebKit (KHÔNG phải Safari thật) — chỉ để tham chiếu OPFS/khởi động",
      version: wb.version(),
      vfs: lib.vfs,
      opfsAvailable: lib.opfsAvailable,
      crossOriginIsolated: lib.crossOriginIsolated,
      initMs: Math.round(lib.initMs),
    };
    await wb.close();
  } catch (err) {
    report.webkit = {
      note: "Playwright WebKit (KHÔNG phải Safari thật) — chỉ để tham chiếu OPFS/khởi động",
      error: String(err).split("\n")[0].slice(0, 300),
    };
  }

  await browser.close();
  server.close();
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  // Không đóng browser thì tiến trình Node treo mãi sau lỗi giữa đường.
  await browser?.close().catch(() => undefined);
  server.close();
  process.exit(1);
});
