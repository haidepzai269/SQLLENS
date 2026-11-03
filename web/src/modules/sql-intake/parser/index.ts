import type { EngineId } from "@/contracts/engine";
import type { ParseRequest, ParseResponse } from "./worker";
import { failure } from "./core";
import type { ParseOutcome } from "./types";

export type { ParseError, ParseOutcome, ParsedStatement, StatementKind } from "./types";

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, (o: ParseOutcome) => void>();

function stop(sql?: string, reason?: string) {
  worker?.terminate();
  worker = undefined;
  const all = [...pending.values()];
  pending.clear();
  // Worker chết thì mọi lời gọi đang chờ nhận lỗi, không treo; lần gọi sau tạo worker mới.
  all.forEach((r) => r(failure(sql ?? "", reason ?? "Parser worker stopped")));
}

function spawn(): Worker {
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.onmessage = ({ data }: MessageEvent<ParseResponse>) => {
    const r = pending.get(data.id);
    pending.delete(data.id);
    r?.(data.outcome);
  };
  const crashed = (msg: string) => w === worker && stop(undefined, msg);
  w.onerror = (e) => crashed(e.message || "Parser worker error");
  w.onmessageerror = () => crashed("Parser worker message error");
  return w;
}

// Không bao giờ reject vì SQL sai. ok: false không có nghĩa là SQL sai: nơi gọi vẫn được gửi SQL cho engine thật.
export function parseSql(sql: string, engine: EngineId): Promise<ParseOutcome> {
  return new Promise((resolve) => {
    try {
      const id = nextId++;
      pending.set(id, resolve);
      (worker ??= spawn()).postMessage({ id, engine, sql } satisfies ParseRequest);
    } catch (e) {
      stop(sql, e instanceof Error ? e.message : String(e));
    }
  });
}

export function disposeParser(): void {
  stop(undefined, "Parser disposed");
}
