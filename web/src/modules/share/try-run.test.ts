// @vitest-environment node
// Test tầng điều phối của trang share. Engine thật (PGlite/SQLite trong Web Worker) chỉ chạy được
// trên trình duyệt, nên phần lớn AC ở đây dùng adapter giả; riêng AC1/AC2 còn một nhánh chạy
// **SQLite WASM thật** trong tiến trình Node (cùng đường mà `adapter.test.ts` của Task132 dùng)
// để chứng minh kết quả mang nhãn Thật là dữ liệu engine vừa trả, không phải chuỗi bịa.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineError, type EngineAdapter, type QueryResult } from "@/contracts/engine";
import { createSqliteSession, type SqliteSession } from "@/engines/sqlite/worker";
import { MAX_SNAPSHOT_RESULT_ROWS, SnapshotRunError, SNAPSHOT_RUN_TIMEOUT_MS, runSnapshotTab } from "./try-run";

type Fake = EngineAdapter & { cancelled: number; disposed: number; calls: string[] };

function fakeAdapter(overrides: Partial<EngineAdapter> & { results?: QueryResult[]; throwOn?: unknown } = {}): Fake {
  const calls: string[] = [];
  const fallback = overrides.execute;
  const adapter: Fake = {
    engine: "postgres",
    cancelled: 0,
    disposed: 0,
    calls,
    execute: async (sql: string, options?: { signal?: AbortSignal; internal?: boolean }) => {
      calls.push(sql);
      if (overrides.throwOn !== undefined) throw overrides.throwOn;
      if (fallback) return fallback(sql, options);
      return overrides.results ?? [{ columns: ["x"], rows: [[1]] }];
    },
    explain: async () => ({ kind: "not_simulated", reasonKey: "x" }),
    tryChange: async () => ({ kind: "not_simulated", reasonKey: "x" }),
    readBTree: async () => ({ model: { kind: "not_simulated", reasonKey: "x" } }),
    cancel: async () => {
      adapter.cancelled++;
    },
    history: () => calls,
    rebuild: async () => {},
    fresh: async () => {},
    dispose: async () => {
      adapter.disposed++;
    },
  };
  return adapter;
}

const TAB = { name: "01_schema.sql", sql: "SELECT 1" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runSnapshotTab — PostgreSQL (AC1, AC4)", () => {
  it("AC1: trả đúng fields/rows của engine và mang nhãn Thật", async () => {
    const results: QueryResult[] = [
      { columns: [], rows: [], affectedRows: 0 },
      { columns: ["id", "name"], rows: [[1, "an"], [2, "bình"]], affectedRows: undefined },
    ];
    const db = fakeAdapter({ results });
    const created: string[] = [];

    const out = await runSnapshotTab(TAB, "postgres", {
      createAdapter: async (engine) => {
        created.push(engine);
        return db;
      },
    });

    expect(created).toEqual(["postgres"]);
    expect(out).toEqual({
      kind: "result",
      label: "real",
      statements: 2,
      fields: ["id", "name"],
      rows: [
        [1, "an"],
        [2, "bình"],
      ],
      totalRows: 2,
      truncated: false,
      affectedRows: undefined,
    });
    // Phiên chỉ sống trong một lần chạy: worker bị dừng để không giữ RAM của người xem.
    expect(db.disposed).toBe(1);
  });

  it("AC1: hạn 1.500 ms được truyền xuống adapter, không tự đặt hạn riêng", async () => {
    const seen: number[] = [];
    await runSnapshotTab(TAB, "postgres", {
      createAdapter: async (_engine, options) => {
        seen.push(options.timeoutMs);
        return fakeAdapter();
      },
    });

    expect(seen).toEqual([SNAPSHOT_RUN_TIMEOUT_MS]);
    expect(SNAPSHOT_RUN_TIMEOUT_MS).toBe(1_500);
  });

  it("AC1: bảng của tab trước được dựng trước câu của tab đang chạy", async () => {
    const db = fakeAdapter();
    await runSnapshotTab(TAB, "postgres", {
      setupSql: "CREATE TABLE accounts (id int);",
      createAdapter: async () => db,
    });

    expect(db.calls).toEqual(["CREATE TABLE accounts (id int);", "SELECT 1"]);
  });

  it("AC4: không phát sinh request mạng nào khi chạy", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const db = fakeAdapter();
    await runSnapshotTab(TAB, "postgres", { createAdapter: async () => db });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.calls).toEqual(["SELECT 1"]);
  });

  it("AC6: kết quả không được ghi vào URL hay bộ nhớ cứng của trình duyệt", async () => {
    // Môi trường node không có location/localStorage: nếu runner lén lưu kết quả, nó phải tự tạo
    // một trong các kho đó. Kiểm cả ba kho của trình duyệt.
    const storage = ["localStorage", "sessionStorage", "indexedDB"] as const;
    const before = storage.filter((key) => key in globalThis);

    const out = await runSnapshotTab(TAB, "postgres", { createAdapter: async () => fakeAdapter() });

    expect(storage.filter((key) => key in globalThis)).toEqual(before);
    // Kết quả chỉ nằm trong giá trị trả về: không có nơi nào khác giữ nó.
    expect(out.kind).toBe("result");
    expect(storage.every((key) => !(key in globalThis))).toBe(true);
  });
});

describe("runSnapshotTab — MySQL (AC3)", () => {
  it("AC3: MySQL trả needs_sandbox, không dựng adapter, không gọi mạng", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const create = vi.fn();

    const out = await runSnapshotTab(TAB, "mysql", { createAdapter: create });

    expect(out).toEqual({ kind: "needs_sandbox", engine: "mysql" });
    expect(create).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("runSnapshotTab — SQLite (AC2, rào chắn)", () => {
  let open: SqliteSession | undefined;
  afterEach(() => {
    open?.close();
    open = undefined;
  });

  // Adapter mỏng quanh phiên SQLite thật: đúng những gì adapter của Task132 làm trong worker.
  const realSqlite = async (): Promise<Fake> => {
    const session: SqliteSession = (open = await createSqliteSession());
    return fakeAdapter({
      engine: "sqlite",
      execute: async (sql: string) => session.run(sql),
    });
  };

  it("AC2: snapshot SQLite chạy thật, kết quả mang nhãn Thật", async () => {
    const out = await runSnapshotTab(
      { name: "q.sql", sql: "CREATE TABLE t (id INT, name TEXT); INSERT INTO t VALUES (1, 'an'), (2, 'bình'); SELECT * FROM t ORDER BY id;" },
      "sqlite",
      { createAdapter: () => realSqlite() },
    );

    if (out.kind !== "result") throw new Error(`expected result, got ${out.kind}`);
    expect(out.label).toBe("real");
    expect(out.statements).toBe(3);
    expect(out.fields).toEqual(["id", "name"]);
    expect(out.rows).toEqual([
      [1, "an"],
      [2, "bình"],
    ]);
    expect(out.totalRows).toBe(2);
  });

  it("AC2: câu SQLite chạy được trên bảng do tab trước tạo", async () => {
    const out = await runSnapshotTab({ name: "q.sql", sql: "SELECT count(*) AS n FROM t" }, "sqlite", {
      setupSql: "CREATE TABLE t (id INT); INSERT INTO t VALUES (1), (2);",
      createAdapter: () => realSqlite(),
    });

    if (out.kind !== "result") throw new Error("expected result");
    expect(out.fields).toEqual(["n"]);
    expect(out.rows).toEqual([[2]]);
    expect(out.statements).toBe(3);
  });

  it("AC2: ATTACH bị chặn trước khi nạp WASM, không câu nào được chạy", async () => {
    const create = vi.fn();

    const err = await runSnapshotTab({ name: "x.sql", sql: "ATTACH DATABASE 'x.db' AS x" }, "sqlite", {
      createAdapter: create,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SnapshotRunError);
    expect((err as SnapshotRunError).code).toBe("guard");
    expect((err as SnapshotRunError).guardReasonKey).toBe("guard.sqlite.attach");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("runSnapshotTab — lỗi và hủy (AC5)", () => {
  it("AC5: quá hạn 1.500 ms thành lỗi timeout, không treo", async () => {
    const err = await runSnapshotTab(TAB, "postgres", {
      createAdapter: async () => fakeAdapter({ throwOn: new EngineError("timeout", "No response after 1500 ms") }),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SnapshotRunError);
    expect((err as SnapshotRunError).code).toBe("timeout");
  });

  it("AC5: nút Hủy gọi cancel() của engine và trả lỗi cancelled", async () => {
    const ctl = new AbortController();
    const db = fakeAdapter({ throwOn: new EngineError("cancelled", "Cancelled") });
    const run = runSnapshotTab(TAB, "postgres", { createAdapter: async () => db, signal: ctl.signal });
    ctl.abort();

    const err = await run.catch((e: unknown) => e);
    expect((err as SnapshotRunError).code).toBe("cancelled");
    expect(db.cancelled).toBeGreaterThanOrEqual(1);
    // Worker vẫn phải bị dừng sau khi hủy.
    expect(db.disposed).toBe(1);
  });

  it("AC5: đã hủy trước khi chạy thì không dựng adapter", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const create = vi.fn();

    const err = await runSnapshotTab(TAB, "postgres", { createAdapter: create, signal: ctl.signal }).catch(
      (e: unknown) => e,
    );

    expect((err as SnapshotRunError).code).toBe("cancelled");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("runSnapshotTab — ca biên", () => {
  it("tab rỗng và không có tab trước: trả empty, không nạp engine", async () => {
    const create = vi.fn();
    expect(await runSnapshotTab({ name: "e.sql", sql: "  \n" }, "postgres", { createAdapter: create })).toEqual({
      kind: "empty",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("chỉ có DDL: không có cột/dòng, vẫn là kết quả Thật", async () => {
    const out = await runSnapshotTab({ name: "d.sql", sql: "CREATE TABLE t (id int)" }, "postgres", {
      createAdapter: async () =>
        fakeAdapter({ results: [{ columns: [], rows: [], affectedRows: 0 }] }),
    });

    expect(out).toMatchObject({ kind: "result", label: "real", fields: [], rows: [], totalRows: 0 });
  });

  it("SQL lỗi cú pháp: giữ mã lỗi, vị trí và chỉ số câu của engine", async () => {
    const err = await runSnapshotTab({ name: "s.sql", sql: "SELEC 1" }, "postgres", {
      createAdapter: async () =>
        fakeAdapter({ throwOn: new EngineError("sql", 'syntax error at or near "SELEC"', 1, undefined, 1) }),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SnapshotRunError);
    expect(err).toMatchObject({ code: "sql", position: 1, statementIndex: 1 });
    expect((err as SnapshotRunError).message).toContain("syntax error");
  });

  it("lỗi lớp bảo vệ giữ khóa dịch và chỉ số câu", async () => {
    const err = await runSnapshotTab(TAB, "postgres", {
      createAdapter: async () =>
        fakeAdapter({
          throwOn: new EngineError("sql", "blocked", undefined, { reasonKey: "guard.role", statementIndex: 2 }),
        }),
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: "guard", guardReasonKey: "guard.role", statementIndex: 2 });
  });

  it("kết quả 100k dòng bị cắt còn 2.000 dòng nhưng vẫn đếm đủ totalRows", async () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => [i]);
    const out = await runSnapshotTab({ name: "big.sql", sql: "SELECT generate_series(1, 100000)" }, "postgres", {
      createAdapter: async () => fakeAdapter({ results: [{ columns: ["g"], rows }] }),
    });

    if (out.kind !== "result") throw new Error("expected result");
    expect(out.rows).toHaveLength(MAX_SNAPSHOT_RESULT_ROWS);
    expect(out.totalRows).toBe(100_000);
    expect(out.truncated).toBe(true);
    expect(out.rows[0]).toEqual([0]);
  });

  it("bấm Chạy 5 lần liên tiếp: mỗi lần một phiên mới, kết quả như nhau, không rò worker", async () => {
    const made: Fake[] = [];
    const runs = await Promise.all(
      Array.from({ length: 5 }, () =>
        runSnapshotTab({ name: "q.sql", sql: "CREATE TABLE t (id int); SELECT 1" }, "postgres", {
          createAdapter: async () => {
            const db = fakeAdapter();
            made.push(db);
            return db;
          },
        }),
      ),
    );

    expect(made).toHaveLength(5);
    expect(new Set(made).size).toBe(5);
    expect(made.every((db) => db.disposed === 1)).toBe(true);
    // Không lần nào chạy trên phiên của lần trước: cùng SQL, cùng kết quả.
    expect(made.every((db) => db.calls.join() === "CREATE TABLE t (id int); SELECT 1")).toBe(true);
    expect(runs.map((r) => (r.kind === "result" ? r.rows : null))).toEqual([[[1]], [[1]], [[1]], [[1]], [[1]]]);
  });

  it("lỗi khi nạp engine (WASM 404) thành load_failed, không phải lỗi SQL", async () => {
    const err = await runSnapshotTab(TAB, "postgres", {
      createAdapter: async () => {
        throw new EngineError("load_failed", "404 /pglite.wasm");
      },
    }).catch((e: unknown) => e);

    expect((err as SnapshotRunError).code).toBe("load_failed");
  });
});
