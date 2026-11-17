import type { BTreeModel } from "@/contracts/btree";
import type { Outcome } from "@/contracts/conclusion";
import { EngineError, type EngineAdapter, type LoadProgress, type TryChangeResult } from "@/contracts/engine";
import type { Plan } from "@/contracts/plan";
import type { SqliteWorkerRequest, SqliteWorkerResponse } from "./protocol";

type Options = {
  onProgress?: (p: LoadProgress) => void;
  /** Chỉ áp cho câu SQL; nạp WASM có hạn riêng. Mặc định 1.500 ms (Task132 AC4). */
  timeoutMs?: number;
  /** Dành cho test: vitest không có Web Worker thật. */
  workerFactory?: () => Worker;
};

export const DEFAULT_TIMEOUT_MS = 1_500;
const LOAD_TIMEOUT_MS = 30_000;

type Done = Extract<SqliteWorkerResponse, { type: "done" }>;
type Pending = { resolve: (r: Done) => void; reject: (e: EngineError) => void };
type Req = { type: "init" } | { type: "exec"; sql: string };

/**
 * Cùng hợp đồng EngineAdapter, chỉ khác `engine` là "sqlite". `EngineId` chưa có giá trị này
 * (contracts/engine.ts thuộc phạm vi Task133), nên ở đây không tự nới hợp đồng.
 */
export type SqliteAdapter = Omit<EngineAdapter, "engine"> & {
  readonly engine: "sqlite";
  /** Yêu cầu Task132: tạo DB mới trong bộ nhớ, quên history. Cùng nghĩa với `fresh()`. */
  reset(): Promise<void>;
};

// SQLite không có EXPLAIN ANALYZE/plan với số dòng thật và không có pageinspect: trả đúng nhãn
// "chưa mô phỏng được" thay vì bịa dữ liệu (Core Rule 1 và 4).
const unsupported = <T>(reason: string): Outcome<T> => ({ kind: "not_simulated", reasonKey: `sqlite.notSimulated.${reason}` });

export async function createSqliteAdapter({ onProgress, timeoutMs = DEFAULT_TIMEOUT_MS, workerFactory }: Options = {}): Promise<SqliteAdapter> {
  let worker: Worker | undefined;
  let nextId = 1;
  let needsRebuild = false;
  let disposed = false;
  let chain: Promise<unknown> = Promise.resolve();
  let activeExec: number | undefined;
  const pending = new Map<number, Pending>();
  const ran: string[] = [];

  // Dừng worker và hủy mọi promise đang chờ: không promise nào được treo (UI không đóng băng).
  function kill(err: EngineError) {
    worker?.terminate();
    worker = undefined;
    needsRebuild = true;
    const all = [...pending.values()];
    pending.clear();
    all.forEach((p) => p.reject(err));
  }

  function spawn() {
    const w = workerFactory ? workerFactory() : new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = ({ data: m }: MessageEvent<SqliteWorkerResponse>) => {
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === "progress") return onProgress?.(m.progress);
      pending.delete(m.id);
      if (m.type === "done") p.resolve(m);
      else p.reject(new EngineError(m.error.code, m.error.message, m.error.position, m.error.guard, m.error.statementIndex));
    };
    const crashed = (msg: string) => w === worker && kill(new EngineError("worker_crashed", msg));
    w.onerror = (e) => crashed(e.message || "worker error");
    w.onmessageerror = () => crashed("worker message error");
    worker = w;
  }

  function call(req: Req) {
    const id = nextId++;
    return new Promise<Done>((resolve, reject) => {
      if (!worker) return reject(new EngineError("worker_crashed", "Engine stopped, call rebuild()"));
      // Nạp WASM lần đầu có thể lâu (Slow 3G ~14 giây), nên không dùng timeout của câu SQL cho init.
      const ms = req.type === "init" ? LOAD_TIMEOUT_MS : timeoutMs;
      const timer = setTimeout(() => kill(new EngineError("timeout", `No response after ${ms} ms`)), ms);
      pending.set(id, {
        resolve: (r) => (clearTimeout(timer), resolve(r)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      if (req.type !== "init") activeExec = id;
      worker.postMessage({ ...req, id } satisfies SqliteWorkerRequest);
    }).finally(() => {
      if (activeExec === id) activeExec = undefined;
    });
  }

  async function startOnce() {
    spawn();
    try {
      await call({ type: "init" });
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

  // Dựng worker mới rồi chạy lại history. DB SQLite nằm trong worker nên mất theo worker.
  // Gọi trong hàng đợi.
  async function rebuildNow() {
    if (disposed) throw new EngineError("worker_crashed", "Engine disposed");
    worker?.terminate();
    worker = undefined;
    await startOnce();
    try {
      for (const sql of ran) await call({ type: "exec", sql });
    } catch (err) {
      needsRebuild = true;
      throw err;
    }
  }

  // Dựng worker mới và làm sạch history (không chạy lại câu cũ). Gọi trong hàng đợi.
  async function freshNow() {
    if (disposed) throw new EngineError("worker_crashed", "Engine disposed");
    worker?.terminate();
    worker = undefined;
    ran.length = 0;
    await startOnce();
  }

  await startOnce();

  return {
    engine: "sqlite",
    // SQLite không có lớp parser chặn SET ROLE như Postgres; rào chắn SQL thuộc Task133.
    guardActive: false,
    execute: async (sql, options) => {
      const aborted = () => options?.signal?.aborted && new EngineError("cancelled", "Cancelled");
      let e = aborted();
      if (e) throw e;
      return enqueue(async () => {
        if (disposed) throw new EngineError("worker_crashed", "Engine disposed");
        if (needsRebuild) throw new EngineError("worker_crashed", "Engine stopped, call rebuild() first");
        e = aborted();
        if (e) throw e;
        const p = call({ type: "exec", sql });
        const id = activeExec;
        const onAbort = () => activeExec === id && kill(new EngineError("cancelled", "Cancelled"));
        options?.signal?.addEventListener("abort", onAbort, { once: true });
        try {
          const r = await p;
          if (!options?.internal) ran.push(sql);
          return r.results ?? [];
        } finally {
          options?.signal?.removeEventListener("abort", onAbort);
        }
      });
    },
    explain: async () => unsupported<Plan>("plan"),
    tryChange: async () => unsupported<TryChangeResult>("tryChange"),
    readBTree: async () => ({ model: unsupported<BTreeModel>("btree") }),
    async cancel() {
      if (activeExec !== undefined) kill(new EngineError("cancelled", "Cancelled"));
    },
    history: () => ran,
    rebuild: () => enqueue(rebuildNow),
    fresh: () => enqueue(freshNow),
    // Tên `reset` theo yêu cầu Task132; cùng nghĩa với fresh(): DB mới trong bộ nhớ, history rỗng.
    reset: () => enqueue(freshNow),
    async dispose() {
      disposed = true;
      kill(new EngineError("cancelled", "Engine disposed"));
    },
  };
}
