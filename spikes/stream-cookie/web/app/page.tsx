"use client";
import { useState } from "react";

// BASE đổi được để thử đường Route Handler (/proxy) thay cho rewrites (/api).
export default function Page() {
  const [out, setOut] = useState<Record<string, unknown>>({});
  const base = typeof location === "undefined" ? "/api" : new URLSearchParams(location.search).get("base") ?? "/api";

  async function run() {
    await fetch(`${base}/login`, { credentials: "same-origin" });
    const me = await (await fetch(`${base}/me`, { credentials: "same-origin" })).json();
    const t0 = performance.now();
    const res = await fetch(`${base}/stream`);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const chunks: { at: number; sentAt?: number }[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const m = dec.decode(value).match(/"sentAt":(\d+)/g);
      chunks.push({ at: Math.round(performance.now() - t0), sentAt: m ? Number(m[0].split(":")[1]) : undefined });
    }
    setOut({ me, chunks, spanMs: chunks.length ? chunks[chunks.length - 1].at - chunks[0].at : 0, contentType: res.headers.get("content-type") });
  }

  return (
    <main>
      <button onClick={run}>Chạy</button>
      <pre id="out">{JSON.stringify(out)}</pre>
    </main>
  );
}
