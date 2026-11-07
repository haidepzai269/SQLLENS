/// <reference lib="webworker" />
import type { EngineErrorData } from "@/contracts/engine";
import { readBTreeAdmin } from "./btree-read";
import { loadGuard, statementAt } from "./guard";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { createSession, GuardError } from "./roles";
import { runExplain } from "./explain";
import { runTryChange } from "./try-rollback";

const post = (m: WorkerResponse) => postMessage(m);
let guardActive = false;
let session: Awaited<ReturnType<typeof createSession>> | undefined;

// Tải tay cả ba file: PGlite 0.5.14 treo mãi, không báo lỗi, khi tải file WASM thất bại.
async function get(url: URL, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${res.status} ${url.pathname}`);
  const chunks: Uint8Array[] = [];
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.length);
  }
  // Ghép tay thay vì đi qua Blob: Chromium có thể trả NotReadableError ("The requested file could not be read") khi đọc lại Blob lúc máy thiếu bộ nhớ.
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

async function init(id: number) {
  const { PGlite } = await import("@electric-sql/pglite");
  let loadedBytes = 0;
  const report = (n: number) => {
    loadedBytes += n;
    post({ id, type: "progress", progress: { phase: "download", loadedBytes } });
  };
  post({ id, type: "progress", progress: { phase: "download", loadedBytes: 0 } });
  const [pgliteWasm, initdbWasm, data, pageinspect, guardOk] = await Promise.all([
    get(new URL("../../../node_modules/@electric-sql/pglite/dist/pglite.wasm", import.meta.url), report),
    get(new URL("../../../node_modules/@electric-sql/pglite/dist/initdb.wasm", import.meta.url), report),
    get(new URL("../../../node_modules/@electric-sql/pglite/dist/pglite.data", import.meta.url), report),
    get(new URL("../../../node_modules/@electric-sql/pglite/dist/pageinspect.tar.gz", import.meta.url), report),
    loadGuard(new URL("../../../node_modules/libpg-query/wasm/libpg-query.wasm", import.meta.url)),
  ]);
  guardActive = guardOk;
  post({ id, type: "progress", progress: { phase: "init", loadedBytes, totalBytes: loadedBytes } });
  // Tải tay cả pageinspect rồi đưa qua blob URL, để lỗi tải báo ra thay vì treo như WASM.
  const bundlePath = new URL(URL.createObjectURL(new Blob([pageinspect])));
  const db = await PGlite.create({
    pgliteWasmModule: await WebAssembly.compile(pgliteWasm),
    initdbWasmModule: await WebAssembly.compile(initdbWasm),
    fsBundle: new Blob([data]),
    extensions: { pageinspect: { name: "pageinspect", setup: async () => ({ bundlePath }) } },
  });
  URL.revokeObjectURL(bundlePath.href);
  session = await createSession(db);
}

const toError = (e: unknown, code: EngineErrorData["code"], sql?: string): EngineErrorData => ({
  code,
  message: e instanceof Error ? e.message : String(e),
  // PGlite gắn `position` (chuỗi số từ PostgreSQL) vào lỗi SQL.
  position: Number((e as { position?: string }).position) || undefined,
  statementIndex: sql === undefined || e instanceof GuardError ? undefined : statementAt(sql, Number((e as { position?: string }).position) || undefined),
  guard: e instanceof GuardError ? { reasonKey: e.reasonKey, statementIndex: e.statementIndex, rebuilt: e.rebuild } : undefined,
});

onmessage = async ({ data: m }: MessageEvent<WorkerRequest>) => {
  try {
    if (m.type === "init") {
      await init(m.id);
      post({ id: m.id, type: "done", guardActive });
      return;
    }
    if (!session) throw new Error("not initialised");
    if (m.type === "explain") {
      post({ id: m.id, type: "done", explained: await runExplain(session.run, m.sql) });
      return;
    }
    if (m.type === "try") {
      post({ id: m.id, type: "done", tried: await runTryChange(session.run, m.change, m.probe) });
      return;
    }
    if (m.type === "btree") {
      const { adminSession } = session;
      post({ id: m.id, type: "done", btree: await readBTreeAdmin(adminSession, m.index, m) });
      return;
    }
    const results = await session.run(m.sql);
    post({ id: m.id, type: "done", results });
  } catch (e) {
    post({ id: m.id, type: "error", error: toError(e, m.type === "init" ? "load_failed" : "sql", m.type === "exec" || m.type === "explain" ? m.sql : undefined) });
  }
};
