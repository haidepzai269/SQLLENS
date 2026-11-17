// @vitest-environment node
// Vitest không có Web Worker, nên AC1/AC3 chạy thẳng phần session với WASM thật (không mock engine);
// AC4 kiểm tra đường timeout của adapter bằng một worker câm. Ghi rõ giới hạn này thay vì giả vờ đã chạy Worker.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteAdapter, DEFAULT_TIMEOUT_MS } from "./adapter";
import { createSqliteSession, SqliteSqlError, type SqliteSession } from "./worker";

let open: SqliteSession | undefined;
const session = async () => (open = await createSqliteSession());

afterEach(() => {
  open?.close();
  open = undefined;
});

describe("SQLite session (WASM thật)", () => {
  it("AC1: CREATE/INSERT/SELECT trả đúng số dòng và kiểu giá trị, BLOB thành base64", async () => {
    const s = await session();
    const results = s.run(`
      CREATE TABLE "bảng" ("cột" TEXT, n INTEGER, r REAL, b BLOB);
      INSERT INTO "bảng" VALUES ('xin chào', 42, 1.5, x'00ff10'), ('', NULL, NULL, NULL);
      SELECT * FROM "bảng" ORDER BY n IS NULL;
    `);

    expect(results).toHaveLength(3);
    expect(results[0].columns).toEqual([]);
    expect(results[1].affectedRows).toBe(2);

    const select = results[2];
    expect(select.columns).toEqual(["cột", "n", "r", "b"]);
    expect(select.rows).toEqual([
      ["xin chào", 42, 1.5, "AP8Q"],
      ["", null, null, null],
    ]);
  });

  it("AC1: câu DML có comment hoặc dấu chấm phẩy thừa ở đầu vẫn trả đúng affectedRows", async () => {
    const s = await session();
    const results = s.run(`
      CREATE TABLE t (id INT);
      -- Chèn dữ liệu với line comment
      INSERT INTO t VALUES (1);
      /* Block comment */ UPDATE t SET id = 2 WHERE id = 1;
      ; -- Semicolon và comment
      DELETE FROM t WHERE id = 2;
    `);

    expect(results).toHaveLength(4);
    expect(results[0].affectedRows).toBeUndefined();
    expect(results[1].affectedRows).toBe(1);
    expect(results[2].affectedRows).toBe(1);
    expect(results[3].affectedRows).toBe(1);
  });

  it("AC3: lỗi cú pháp có mã lỗi và chỉ số câu, sau đó chạy tiếp được", async () => {
    const s = await session();
    let caught: unknown;
    try {
      s.run("SELECT 1; SELEC 2;");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SqliteSqlError);
    expect((caught as SqliteSqlError).statementIndex).toBe(2);
    expect((caught as SqliteSqlError).message).toMatch(/syntax error/i);

    // Worker không chết: câu sau vẫn chạy trên cùng DB.
    expect(s.run("SELECT 7 AS x")[0].rows).toEqual([[7]]);
  });

  it("SQL rỗng và chỉ có comment trả về không có kết quả", async () => {
    const s = await session();
    expect(s.run("   ")).toEqual([]);
    expect(s.run("-- chỉ là comment\n/* và đây nữa */")).toEqual([]);
  });
});

class SilentWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;

  postMessage(data: { id: number; type: string }) {
    if (data.type !== "init") return; // exec không bao giờ trả lời: mô phỏng câu chạy quá lâu
    queueMicrotask(() => this.onmessage?.({ data: { id: data.id, type: "done", results: [] } } as MessageEvent));
  }

  terminate() {
    this.terminated = true;
  }
}

describe("SQLite adapter", () => {
  it("AC4: timeout mặc định 1.500 ms và câu quá hạn bị ngắt, không treo", async () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(1_500);
    const w = new SilentWorker();
    const adapter = await createSqliteAdapter({ timeoutMs: 20, workerFactory: () => w as unknown as Worker });
    const started = Date.now();
    await expect(adapter.execute("SELECT 1")).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(w.terminated).toBe(true);
    // Worker đã bị terminate: phải rebuild trước khi chạy tiếp, không trả kết quả rác.
    await expect(adapter.execute("SELECT 2")).rejects.toMatchObject({ code: "worker_crashed" });
    await adapter.dispose();
  });

  it("Plan/B-Tree/TryChange trả nhãn chưa mô phỏng được", async () => {
    const adapter = await createSqliteAdapter({ workerFactory: () => new SilentWorker() as unknown as Worker });
    expect(await adapter.explain("SELECT 1")).toEqual({ kind: "not_simulated", reasonKey: "sqlite.notSimulated.plan" });
    expect(await adapter.tryChange("CREATE INDEX i ON t (a)", "SELECT 1")).toEqual({
      kind: "not_simulated",
      reasonKey: "sqlite.notSimulated.tryChange",
    });
    expect((await adapter.readBTree("i")).model).toEqual({ kind: "not_simulated", reasonKey: "sqlite.notSimulated.btree" });
    await adapter.dispose();
  });

  it("AC5: worker không gọi mạng trong lúc chạy SQL", () => {
    const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});

// Nhập/xuất file chạy thẳng trên session WASM thật, cùng lý do đã ghi ở đầu file: vitest không có Worker.
describe("SQLite session: nhập/xuất file (Task134/135)", () => {
  const HEAD = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];
  const headOf = (bytes: Uint8Array) => Array.from(bytes.slice(0, 16));

  it("AC1 + AC2: xuất ra rồi nạp vào session khác đọc đúng bảng và đúng số dòng", async () => {
    const a = await session();
    a.run("CREATE TABLE c (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO c VALUES (1,'An'),(2,'Bình');");
    const bytes = a.serialize();
    expect(headOf(bytes)).toEqual(HEAD);

    const b = await session();
    await b.load({ bytes });
    const [rows] = b.run("SELECT name FROM c ORDER BY id");
    expect(rows.rows).toEqual([["An"], ["Bình"]]);
  });

  it("AC3: session rỗng vẫn xuất ra file hợp lệ, nạp lại được, không có bảng nào", async () => {
    const a = await session();
    const bytes = a.serialize();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(headOf(bytes)).toEqual(HEAD);

    const b = await session();
    await b.load({ bytes });
    expect(b.run("SELECT count(*) FROM sqlite_master")[0].rows).toEqual([[0]]);
  });

  it("ca biên: nạp hai lần liên tiếp trên cùng session thì database là của file sau", async () => {
    const a = await session();
    a.run("CREATE TABLE mot (x INT);");
    const first = a.serialize();
    a.run("CREATE TABLE hai (x INT);");
    const second = a.serialize();

    const b = await session();
    await b.load({ bytes: first });
    await b.load({ bytes: second });
    expect(b.run("SELECT name FROM sqlite_master ORDER BY name")[0].rows).toEqual([["hai"], ["mot"]]);
  });

  it("ca biên: file rỗng, file rác và file trang bị xáo (mã hóa) bị từ chối, database đang mở còn nguyên", async () => {
    const s = await session();
    s.run("CREATE TABLE keep (x INT); INSERT INTO keep VALUES (7);");

    await expect(s.load({ bytes: new Uint8Array(0) })).rejects.toThrow(/rỗng/i);
    await expect(s.load({ bytes: new Uint8Array(4096) })).rejects.toThrow(/Không phải file SQLite/);

    const good = s.serialize();
    const scrambled = good.slice();
    for (let i = 16; i < scrambled.length; i += 4096) scrambled[i] ^= 0x5a;
    await expect(s.load({ bytes: scrambled })).rejects.toThrow(/Không đọc được nội dung database/);

    // File hỏng không được làm mất bảng đang có.
    expect(s.run("SELECT x FROM keep")[0].rows).toEqual([[7]]);
  });

  it("nhận cả File (dùng ở trình duyệt), không chỉ Uint8Array", async () => {
    const a = await session();
    a.run("CREATE TABLE f (x INT); INSERT INTO f VALUES (3);");
    const bytes = a.serialize();

    const b = await session();
    await b.load({ file: new File([bytes as BlobPart], "f.sqlite") });
    expect(b.run("SELECT x FROM f")[0].rows).toEqual([[3]]);
  });
});
