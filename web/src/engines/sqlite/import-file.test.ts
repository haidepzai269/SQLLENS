import { describe, expect, it, vi } from "vitest";
import type { SqliteAdapter } from "./adapter";
import { importSqliteFile, looksLikeSqlite, MAX_IMPORT_BYTES, SqliteImportError } from "./import-file";

type Fake = Pick<SqliteAdapter, "loadDatabase" | "execute">;

const SQLITE_HEAD = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];
const sqliteBytes = (size = 4096) => Uint8Array.from([...SQLITE_HEAD, ...new Array(size - SQLITE_HEAD.length).fill(0)]);

function fake(tables: string[] = ["users", "orders"]) {
  const loadDatabase = vi.fn<Fake["loadDatabase"]>(async () => {});
  const execute = vi.fn<Fake["execute"]>(async () => [{ columns: ["name"], rows: tables.map((t) => [t]) }]);
  return { adapter: { loadDatabase, execute } as Fake, loadDatabase, execute };
}

const fileOf = (bytes: Uint8Array, name = "shop.sqlite") => new File([bytes as BlobPart], name);

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof SqliteImportError ? e.code : `thô: ${(e as Error).message}`;
  }
};

describe("looksLikeSqlite: chữ ký 16 byte đầu", () => {
  it("nhận file SQLite, từ chối rác, file ngắn và PDF", () => {
    expect(looksLikeSqlite(sqliteBytes())).toBe(true);
    expect(looksLikeSqlite(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]))).toBe(false);
    expect(looksLikeSqlite(Uint8Array.from(SQLITE_HEAD.slice(0, 8)))).toBe(false);
    expect(looksLikeSqlite(new TextEncoder().encode("%PDF-1.7\n"))).toBe(false);
    expect(looksLikeSqlite(new Uint8Array(0))).toBe(false);
  });
});

describe("importSqliteFile", () => {
  it("AC1: file hợp lệ được nạp và trả đúng danh sách bảng", async () => {
    const { adapter, loadDatabase, execute } = fake(["users", "orders"]);
    const file = fileOf(sqliteBytes());
    const r = await importSqliteFile(file, adapter);
    expect(r).toEqual({ tables: ["users", "orders"], bytes: file.size });
    expect(loadDatabase).toHaveBeenCalledTimes(1);
    // Đưa nguyên File vào adapter: 40MB được đọc trong worker, không qua main thread.
    expect(loadDatabase.mock.calls[0][0]).toBe(file);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("AC3: file quá 50MB bị chặn trước khi đọc, không gọi adapter", async () => {
    const { adapter, loadDatabase } = fake();
    const file = fileOf(sqliteBytes(16));
    Object.defineProperty(file, "size", { value: MAX_IMPORT_BYTES + 1 });
    expect(await code(importSqliteFile(file, adapter))).toBe("FILE_TOO_LARGE");
    expect(loadDatabase).not.toHaveBeenCalled();
  });

  it("AC3: file 0 byte và file không phải SQLite báo NOT_SQLITE, không nạp", async () => {
    const { adapter, loadDatabase } = fake();
    expect(await code(importSqliteFile(fileOf(new Uint8Array(0), "rong.db"), adapter))).toBe("NOT_SQLITE");
    const junk = fileOf(new TextEncoder().encode("day khong phai database"), "anh.png");
    expect(await code(importSqliteFile(junk, adapter))).toBe("NOT_SQLITE");
    expect(loadDatabase).not.toHaveBeenCalled();
  });

  it("ca biên: file SQLite mã hóa (đúng chữ ký nhưng không đọc được) báo IMPORT_FAILED", async () => {
    const { adapter, loadDatabase } = fake();
    loadDatabase.mockRejectedValueOnce(new Error("file is not a database"));
    await expect(importSqliteFile(fileOf(sqliteBytes()), adapter)).rejects.toMatchObject({
      code: "IMPORT_FAILED",
      message: "file is not a database",
    });
  });

  it("ca biên: người dùng bấm huỷ thì giữ lỗi huỷ, không báo thành file hỏng", async () => {
    const { adapter, loadDatabase } = fake();
    const ctl = new AbortController();
    loadDatabase.mockImplementationOnce(async () => {
      ctl.abort();
      throw new Error("Cancelled");
    });
    await expect(importSqliteFile(fileOf(sqliteBytes()), adapter, { signal: ctl.signal })).rejects.toThrow("Cancelled");
  });

  it("ca biên: đọc danh sách bảng lỗi thì báo IMPORT_FAILED", async () => {
    const { adapter, execute } = fake();
    execute.mockRejectedValueOnce(new Error("database disk image is malformed"));
    expect(await code(importSqliteFile(fileOf(sqliteBytes()), adapter))).toBe("IMPORT_FAILED");
  });

  it("ca biên: file 500 bảng trả đủ 500 tên, giữ thứ tự adapter trả về", async () => {
    const names = Array.from({ length: 500 }, (_, i) => `t${i}`);
    const { adapter } = fake(names);
    const r = await importSqliteFile(fileOf(sqliteBytes()), adapter);
    expect(r.tables).toHaveLength(500);
    expect(r.tables[0]).toBe("t0");
    expect(r.tables[499]).toBe("t499");
  });
});
