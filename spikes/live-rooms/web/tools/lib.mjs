// Tiện ích chung cho các script đo. Dùng Playwright thật (Chromium của Playwright),
// không dùng `next dev`.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");
export const OUT = join(ROOT, "results");
export const WEB = process.env.WEB_ORIGIN ?? "http://localhost:3159";
export const API = process.env.API_ORIGIN ?? "http://localhost:18160";

mkdirSync(OUT, { recursive: true });

export const save = (name, data) => {
  const p = join(OUT, name);
  writeFileSync(p, JSON.stringify(data, null, 2));
  console.log(`wrote ${p}`);
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(extra = {}) {
  return chromium.launch({ headless: true, ...extra });
}

/** Chờ một biến do trang gán vào window, trả về giá trị. */
export async function waitFor(page, name, timeout = 600_000) {
  await page.waitForFunction((n) => window[n] !== undefined, name, { timeout, polling: 250 });
  return page.evaluate((n) => window[n], name);
}

/** Trung vị của một mảng số. Không làm tròn: trả về số thực, chỗ báo cáo tự quyết định. */
export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Đếm byte THẬT trên dây mà trình duyệt nhận, bằng CDP `Network.dataReceived`.
 *
 * Vì sao không dùng `request.sizes()`: SSE không bao giờ "kết thúc", nên `requestfinished`
 * không bắn và `sizes()` không có số. `dataReceived` bắn theo từng khung nên đếm được cả
 * stream đang mở.
 *
 * `body` là số byte thân phản hồi (encodedDataLength, tức đúng số byte qua dây).
 * `headers` là độ dài thật của khối header phản hồi, dựng lại từ `responseReceived`.
 */
export async function wireCounter(page, filter = "/api/") {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const byReq = new Map();
  const acc = {
    body: 0,
    headers: 0,
    requests: 0,
    byUrl: {},
    byStatus: {},
    openStreams: 0,
  };
  const bucket = (path) => (acc.byUrl[path] ??= { requests: 0, body: 0, headers: 0 });

  cdp.on("Network.requestWillBeSent", (e) => {
    const u = e.request.url;
    if (!u.includes(filter)) return;
    byReq.set(e.requestId, { path: new URL(u).pathname, status: 0 });
    acc.requests++;
    bucket(new URL(u).pathname).requests++;
  });
  cdp.on("Network.responseReceived", (e) => {
    const r = byReq.get(e.requestId);
    if (!r) return;
    r.status = e.response.status;
    acc.byStatus[r.status] = (acc.byStatus[r.status] ?? 0) + 1;
    // Độ dài khối header thật: "HTTP/1.1 200 OK\r\n" + mỗi "k: v\r\n" + "\r\n".
    let n = `HTTP/1.1 ${e.response.status} ${e.response.statusText}\r\n`.length;
    for (const [k, v] of Object.entries(e.response.headers)) n += `${k}: ${v}\r\n`.length;
    n += 2;
    r.headers = n;
    acc.headers += n;
    bucket(r.path).headers += n;
  });
  cdp.on("Network.dataReceived", (e) => {
    const r = byReq.get(e.requestId);
    if (!r) return;
    acc.body += e.encodedDataLength;
    bucket(r.path).body += e.encodedDataLength;
  });
  return acc;
}

/** Đọc RSS (bytes) của một tiến trình Windows theo PID, qua CIM. */
export async function rssOf(pid) {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-Command", `(Get-Process -Id ${Number(pid)}).WorkingSet64`],
      { windowsHide: true },
      (err, stdout) => resolve(err ? null : Number(String(stdout).trim()) || null),
    );
  });
}

export async function getJson(url) {
  const r = await fetch(url);
  return r.json();
}

export async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.text() };
}
