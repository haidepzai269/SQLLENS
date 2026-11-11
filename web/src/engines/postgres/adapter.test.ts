import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresAdapter } from "./adapter";
import { EngineError } from "@/contracts/engine";
import type { WorkerRequest, WorkerResponse } from "./protocol";

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  posted: WorkerRequest[] = [];

  constructor(public url: string | URL, public options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  postMessage(data: WorkerRequest) {
    this.posted.push(data);
    if (data.type === "init") {
      queueMicrotask(() => {
        if (!this.terminated) {
          this.onmessage?.({ data: { id: data.id, type: "done", guardActive: true } } as MessageEvent<WorkerResponse>);
        }
      });
    } else if (data.type === "exec") {
      queueMicrotask(() => {
        if (!this.terminated) {
          this.onmessage?.({
            data: { id: data.id, type: "done", results: [{ columns: ["c"], rows: [[1]] }] },
          } as MessageEvent<WorkerResponse>);
        }
      });
    }
  }

  terminate() {
    this.terminated = true;
  }
}

describe("PostgresAdapter fresh() & lifecycle", () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    MockWorker.instances = [];
    globalThis.Worker = MockWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
  });

  it("AC1: fresh() xóa sạch history và khởi tạo worker mới", async () => {
    const adapter = await createPostgresAdapter();
    expect(MockWorker.instances.length).toBe(1);
    const worker1 = MockWorker.instances[0];

    // Chạy một câu SQL
    await adapter.execute("CREATE TABLE test(id int)");
    expect(adapter.history()).toEqual(["CREATE TABLE test(id int)"]);
    expect(worker1.posted.some((m) => m.type === "exec" && (m as { sql: string }).sql === "CREATE TABLE test(id int)")).toBe(true);

    // Gọi fresh()
    await adapter.fresh();

    // Worker 1 phải bị terminate
    expect(worker1.terminated).toBe(true);

    // Worker 2 phải được khởi tạo
    expect(MockWorker.instances.length).toBe(2);
    const worker2 = MockWorker.instances[1];
    expect(worker2.posted.some((m) => m.type === "init")).toBe(true);

    // History phải rỗng hoàn toàn 100%
    expect(adapter.history()).toEqual([]);

    // Worker 2 KHÔNG được chạy lại câu CREATE TABLE từ history cũ
    const execsWorker2 = worker2.posted.filter((m) => m.type === "exec");
    expect(execsWorker2.length).toBe(0);

    // Sau khi fresh, chạy câu mới bình thường
    await adapter.execute("CREATE TABLE new_test(id int)");
    expect(adapter.history()).toEqual(["CREATE TABLE new_test(id int)"]);

    await adapter.dispose();
    expect(worker2.terminated).toBe(true);
  });

  it("rebuild() chạy lại history còn fresh() thì không", async () => {
    const adapter = await createPostgresAdapter();
    expect(MockWorker.instances.length).toBe(1);

    await adapter.execute("INSERT INTO test VALUES (1)");
    expect(adapter.history()).toEqual(["INSERT INTO test VALUES (1)"]);

    // rebuild()
    await adapter.rebuild();
    expect(MockWorker.instances.length).toBe(2);
    const worker2 = MockWorker.instances[1];
    // worker2 phải chạy lại câu trong history
    expect(worker2.posted.some((m) => m.type === "exec" && (m as { sql: string }).sql === "INSERT INTO test VALUES (1)")).toBe(true);
    expect(adapter.history()).toEqual(["INSERT INTO test VALUES (1)"]);

    // Giờ gọi fresh()
    await adapter.fresh();
    expect(MockWorker.instances.length).toBe(3);
    const worker3 = MockWorker.instances[2];
    expect(worker3.posted.filter((m) => m.type === "exec").length).toBe(0);
    expect(adapter.history()).toEqual([]);

    await adapter.dispose();
  });

  it("gọi fresh() khi đã dispose sẽ ném lỗi EngineError", async () => {
    const adapter = await createPostgresAdapter();
    await adapter.dispose();
    await expect(adapter.fresh()).rejects.toThrowError(EngineError);
  });
});
