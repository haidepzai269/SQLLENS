import { describe, expect, it, vi } from "vitest";
import type { SqliteAdapter } from "./adapter";
import { ensureSqliteName, exportSqliteFile, SQLITE_MIME, sqliteExportName } from "./export-file";

const SQLITE_HEAD = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];
const sqliteBytes = () => Uint8Array.from([...SQLITE_HEAD, ...new Array(4080).fill(7)]);

const fake = (bytes: Uint8Array = sqliteBytes()) => {
  const exportDatabase = vi.fn<Pick<SqliteAdapter, "exportDatabase">["exportDatabase"]>(async () => bytes);
  return { adapter: { exportDatabase }, exportDatabase };
};

describe("sqliteExportName", () => {
  it("AC1: <tên dự án>-<YYYYMMDD-HHmm>.sqlite, số luôn đủ hai chữ số", () => {
    expect(sqliteExportName("Cửa hàng", new Date(2026, 10, 17, 9, 5))).toBe("Cửa hàng-20261117-0905.sqlite");
    expect(sqliteExportName("shop", new Date(2026, 0, 2, 23, 59))).toBe("shop-20260102-2359.sqlite");
  });

  it("ca biên: tên có dấu tiếng Việt và ký tự cấm của Windows/macOS", () => {
    expect(sqliteExportName("Dự án: của/an\\tôi?", new Date(2026, 10, 17, 9, 5))).toBe("Dự án- của-an-tôi--20261117-0905.sqlite");
  });

  it("tên rỗng hoặc chỉ có dấu chấm thì dùng tên dự phòng", () => {
    expect(sqliteExportName("   ", new Date(2026, 10, 17, 9, 5))).toBe("sqllens-20261117-0905.sqlite");
    expect(sqliteExportName("...", new Date(2026, 10, 17, 9, 5))).toBe("sqllens-20261117-0905.sqlite");
  });
});

describe("ensureSqliteName", () => {
  it("bổ sung .sqlite, bỏ phần đường dẫn, không nhân đôi đuôi", () => {
    expect(ensureSqliteName("shop")).toBe("shop.sqlite");
    expect(ensureSqliteName("shop.db")).toBe("shop.db.sqlite");
    expect(ensureSqliteName("shop.SQLITE")).toBe("shop.SQLITE");
    expect(ensureSqliteName("../../etc/passwd.sqlite")).toBe("passwd.sqlite");
    expect(ensureSqliteName("  ")).toBe("sqllens.sqlite");
  });
});

describe("exportSqliteFile", () => {
  it("AC1: trả Blob đúng kiểu file và giữ nguyên từng byte", async () => {
    const bytes = sqliteBytes();
    const { adapter, exportDatabase } = fake(bytes);
    const blob = await exportSqliteFile(adapter, "Cửa hàng-20261117-0905.sqlite");
    expect(exportDatabase).toHaveBeenCalledTimes(1);
    expect(blob.type).toBe(SQLITE_MIME);
    expect(blob.name).toBe("Cửa hàng-20261117-0905.sqlite");
    expect(blob.size).toBe(bytes.length);
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 16))).toEqual(SQLITE_HEAD);
  });

  it("AC3: sandbox rỗng vẫn ra file hợp lệ (adapter trả 8192 byte có header)", async () => {
    const empty = Uint8Array.from([...SQLITE_HEAD, ...new Array(8192 - SQLITE_HEAD.length).fill(0)]);
    const { adapter } = fake(empty);
    const blob = await exportSqliteFile(adapter, "trong.sqlite");
    expect(blob.size).toBe(8192);
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 15))).toEqual(SQLITE_HEAD.slice(0, 15));
  });

  it("ca biên: tên gửi vào thiếu đuôi thì Blob tự có đuôi .sqlite", async () => {
    const { adapter } = fake();
    const blob = await exportSqliteFile(adapter, "shop");
    expect(blob.name).toBe("shop.sqlite");
  });

  it("adapter lỗi thì lỗi đi thẳng ra ngoài để giao diện báo, không nuốt", async () => {
    const { adapter, exportDatabase } = fake();
    exportDatabase.mockRejectedValueOnce(new Error("Không đọc được nội dung database"));
    await expect(exportSqliteFile(adapter, "shop.sqlite")).rejects.toThrow("Không đọc được nội dung database");
  });
});
