import { EngineError, type EngineAdapter, type LoadProgress } from "@/contracts/engine";
import type { WorkerRequest, WorkerResponse } from "./protocol";

type Options = { onProgress?: (p: LoadProgress) => void; timeoutMs?: number };
type Done = Extract<WorkerResponse, { type: "done" }>;
type Pending = { resolve: (r: Done) => void; reject: (e: EngineError) => void; onProgress?: (p: LoadProgress) => void };
type Req = { type: "init" } | { type: "exec"; sql: string };

// PGlite chạy trong Web Worker, chỉ nạp khi gọi hàm này, nên mở trang không tải WASM.
// shortcut: role mặc định có quyền cao, đổi sang role quyền thấp ở Task021.
export async function createPostgresAdapter({ onProgress, timeoutMs = 30_000 }: Options = {}): Promise<EngineAdapter> {
  let worker: Worker | undefined;
  let nextId = 1;
  let needsRebuild = false;
  let disposed = false;
  let chain: Promise<unknown> = Promise.resolve();
  let activeExec: number | undefined; // id của exec đang chạy, để cancel biết có gì để dừng
  const pending = new Map<number, Pending>();
  const ran: string[] = [];

  // Dừng worker và hủy mọi promise đang chờ: không promise nào được treo.
  function kill(err: EngineError) {
    worker?.terminate();
    worker = undefined;
    needsRebuild = true;
    const all = [...pending.values()];
    pending.clear();
    all.forEach((p) => p.reject(err));
  }

  function spawn() {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = ({ data: m }: MessageEvent<WorkerResponse>) => {
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === "progress") return p.onProgress?.(m.progress);
      pending.delete(m.id);
      if (m.type === "done") p.resolve(m);
      else p.reject(new EngineError(m.error.code, m.error.message, m.error.position));
    };
    const crashed = (msg: string) => w === worker && kill(new EngineError("worker_crashed", msg));
    w.onerror = (e) => crashed(e.message || "worker error");
    w.onmessageerror = () => crashed("worker message error");
    worker = w;
  }

  function call(req: Req, timeoutCode: "timeout" | "load_failed", onProg?: (p: LoadProgress) => void) {
    const id = nextId++;
    return new Promise<Done>((resolve, reject) => {
      if (!worker) return reject(new EngineError("worker_crashed", "Engine stopped, call rebuild()"));
      // timeoutMs chỉ áp cho câu SQL; tải và khởi tạo có hạn riêng 30 giây (AC6).
      const ms = req.type === "init" ? 30_000 : timeoutMs;
      const timer = setTimeout(() => kill(new EngineError(timeoutCode, `No response after ${ms} ms`)), ms);
      pending.set(id, {
        resolve: (r) => (clearTimeout(timer), resolve(r)),
        reject: (e) => (clearTimeout(timer), reject(e)),
        onProgress: onProg,
      });
      if (req.type === "exec") activeExec = id;
      worker.postMessage({ ...req, id } satisfies WorkerRequest);
    }).finally(() => {
      if (activeExec === id) activeExec = undefined;
    });
  }

  async function start() {
    spawn();
    try {
      await call({ type: "init" }, "load_failed", onProgress);
      needsRebuild = false;
    } catch (e) {
      worker?.terminate();
      worker = undefined;
      needsRebuild = true;
      throw e instanceof EngineError && e.code === "load_failed" ? e : new EngineError("load_failed", (e as Error).message);
    }
  }

  // Hàng đợi: execute và rebuild chạy tuần tự đúng thứ tự gọi.
  const enqueue = <T,>(fn: () => Promise<T>) => {
    const r = chain.then(fn);
    chain = r.catch(() => {});
    return r;
  };

  await start();

  return {
    engine: "postgres",
    execute: async (sql, options) => {
      const aborted = () => options?.signal?.aborted && new EngineError("cancelled", "Cancelled");
      let e = aborted();
      if (e) throw e;
      return enqueue(async () => {
        if (disposed) throw new EngineError("worker_crashed", "Engine disposed");
        if (needsRebuild) throw new EngineError("worker_crashed", "Engine stopped, call rebuild() first");
        e = aborted();
        if (e) throw e;
        const p = call({ type: "exec", sql }, "timeout");
        const id = activeExec;
        const onAbort = () => activeExec === id && kill(new EngineError("cancelled", "Cancelled"));
        options?.signal?.addEventListener("abort", onAbort, { once: true });
        try {
          const r = await p;
          ran.push(sql);
          return r.results ?? [];
        } finally {
          options?.signal?.removeEventListener("abort", onAbort);
        }
      });
    },
    // shortcut: chưa làm EXPLAIN, trả NotSimulated đến SP007.
    explain: async () => ({ kind: "not_simulated", reasonKey: "lab.notSimulated.explain" }),
    async cancel() {
      if (activeExec !== undefined) kill(new EngineError("cancelled", "Cancelled"));
    },
    history: () => ran,
    rebuild: () =>
      enqueue(async () => {
        if (disposed) throw new EngineError("worker_crashed", "Engine disposed");
        worker?.terminate();
        worker = undefined;
        await start();
        try {
          for (const sql of ran) await call({ type: "exec", sql }, "timeout");
        } catch (err) {
          needsRebuild = true; // dựng lại dở dang thì vẫn coi là chưa dùng được
          throw err;
        }
      }),
    async dispose() {
      disposed = true;
      kill(new EngineError("cancelled", "Engine disposed"));
    },
  };
}
