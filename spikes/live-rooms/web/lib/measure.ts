/**
 * Tiện ích đo dùng chung cho các trang của spike.
 *
 * Nguyên tắc: mọi con số byte đều tính từ dữ liệu thật do PGlite sinh ra trong worker,
 * và mọi phép mã hóa đều đi qua đúng hàm của codec SP022 (`canonicalJsonStringify`,
 * `bytesToBase64Url`) — không viết lại thuật toán nào.
 */

import { bytesToBase64Url, canonicalJsonStringify } from "./codec";
import type { SnapshotV1 } from "./snapshot";
import { PROJECT_NAME, TABS } from "./fixture";

/** gzip tất định giống `compressGzip` trong codec SP022 (MTIME = 0, OS = 255). */
export async function gzipDeterministic(input: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([input as unknown as BlobPart]).stream().pipeThrough(cs);
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  bytes[4] = bytes[5] = bytes[6] = bytes[7] = 0;
  bytes[9] = 255;
  return bytes;
}

const enc = new TextEncoder();

/** Mã hóa một đối tượng JSON theo đúng đường mà link `/share` đi: canonical JSON → gzip → base64url. */
export async function encodeLikeShare(obj: unknown): Promise<{ payload: string; jsonBytes: number; gzipBytes: number }> {
  const json = canonicalJsonStringify(obj);
  const jsonBytes = enc.encode(json).length;
  const gz = await gzipDeterministic(enc.encode(json));
  return { payload: "g." + bytesToBase64Url(gz), jsonBytes, gzipBytes: gz.length };
}

/**
 * Payload của một phòng live. Khác `SnapshotV1` ở chỗ mang thêm plan và kết quả mẫu —
 * đó chính là thứ cho phép viewer xem Plan/B-Tree mà không cần WASM, nên phải nằm trong
 * phép đo byte.
 */
export type LiveRoomPayload = {
  v: 1;
  project: { name: string; engine: "postgres" | "mysql" | "sqlite" };
  tabs: { name: string; sql: string }[];
  plan?: unknown;
  result?: { columns: string[]; rows: unknown[][] };
};

export function snapshotOf(rows: number): SnapshotV1 {
  return {
    v: 1,
    project: { name: PROJECT_NAME, engine: "postgres" },
    tabs: TABS(rows),
  };
}

export function liveRoomOf(rows: number, plan: unknown, result: { columns: string[]; rows: unknown[][] }): LiveRoomPayload {
  const s = snapshotOf(rows);
  return { v: 1, project: s.project, tabs: s.tabs, plan, result };
}

/** Byte của phần SQL thuần trong một payload: tổng độ dài UTF-8 của mọi câu SQL cộng tên tab. */
export function sqlBytesOf(tabs: { name: string; sql: string }[]): number {
  return tabs.reduce((n, t) => n + enc.encode(t.sql).length + enc.encode(t.name).length, 0);
}

// ---- Cầu nối worker ----

export type BTreeStats = {
  readMs: number;
  height: number;
  rootPage: number;
  totalPages: number;
  indexBytes: number;
  nodesRead: number;
  hidden: { level: number; count: number }[];
  keysInModel: number;
  totalKeysInModel: number;
  jsonBytes: number;
  jsonPathBytes: number;
  gzipBytes: number;
  gzipPathBytes: number;
  hasPath: boolean;
  pathPages: number;
  model: unknown;
  path?: unknown;
};

export type WorkerResult = {
  rows: number;
  plan: unknown;
  result: { columns: string[]; rows: unknown[][] };
  resultRowCount: number;
  btrees: Record<string, BTreeStats | { error: string }>;
};

let cached: Promise<WorkerResult> | undefined;

/** Chạy worker một lần cho mỗi lần tải trang; kết quả giữ lại để AC1 và AC3 dùng chung. */
export function runWorker(rows: number, probeKey: string, onPhase?: (p: string) => void): Promise<WorkerResult> {
  cached ??= new Promise<WorkerResult>((resolve, reject) => {
    const w = new Worker(new URL("../ac3/btree.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ type: string; phase?: string; data?: WorkerResult; message?: string }>) => {
      const m = e.data;
      if (m.type === "progress" && m.phase) onPhase?.(m.phase);
      else if (m.type === "result") resolve(m.data as WorkerResult);
      else if (m.type === "error") reject(new Error(m.message));
    };
    w.onerror = (e) => reject(new Error(`worker: ${e.message}`));
    w.postMessage({ type: "run", rows, probeKey });
  });
  return cached;
}

/** Ghi kết quả vào `window.__result` để Playwright đọc, không phải đọc chữ trên màn hình. */
export function publish(name: string, value: unknown) {
  (window as unknown as Record<string, unknown>)[`__${name}`] = value;
}
