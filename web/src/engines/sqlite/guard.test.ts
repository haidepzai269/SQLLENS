import { describe, expect, it } from "vitest";
import { assertSqliteSafe } from "./guard";

const blocked = (sql: string) => {
  const r = assertSqliteSafe(sql);
  return r.ok ? "ok" : r.reason;
};

describe("assertSqliteSafe: lệnh mở đường ra ngoài", () => {
  it("AC1 + AC6: ATTACH, DETACH, VACUUM INTO, load_extension, câu không đóng", () => {
    expect(blocked("ATTACH DATABASE 'x.db' AS x")).toBe("attach");
    expect(blocked("DETACH DATABASE x")).toBe("attach");
    expect(blocked("VACUUM INTO 'x.db'")).toBe("vacuum_into");
    expect(blocked("SELECT load_extension('evil.so')")).toBe("load_extension");
    expect(blocked("SELECT 'chưa đóng")).toBe("attach_hidden");
  });

  it("AC1: viết thường, có chú thích chen giữa, có khoảng trắng xuống dòng", () => {
    expect(blocked("attach database 'x.db' as x")).toBe("attach");
    expect(blocked("/*x*/ATTACH DATABASE 'x.db' AS x")).toBe("attach");
    expect(blocked("-- ghi chú\n  detach  database  x")).toBe("attach");
    expect(blocked("at\ttach database 'x' as y")).toBe("ok"); // không phải từ khóa, SQLite báo lỗi cú pháp
    expect(blocked("/* chú thích */ attach database 'x' as y")).toBe("attach");
    expect(blocked("VACUUM main INTO 'x.db'")).toBe("vacuum_into");
    expect(blocked("vacuum\n  into\n  'x.db'")).toBe("vacuum_into");
    expect(blocked("select LOAD_EXTENSION ('evil')")).toBe("load_extension");
    expect(blocked(`SELECT "load_extension"('evil')`)).toBe("load_extension");
  });

  it("AC1: nằm trong chuỗi nhiều câu lệnh, sau câu hợp lệ", () => {
    expect(blocked("CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1); ATTACH 'x.db' AS x;")).toBe("attach");
    expect(blocked("SELECT 1;\n-- chen\n;\n/* chen */ detach x")).toBe("attach");
    expect(blocked("EXPLAIN ATTACH DATABASE 'x.db' AS x")).toBe("attach");
    expect(blocked("SELECT 1; VACUUM INTO 'x.db'")).toBe("vacuum_into");
  });

  it("AC1: comment chưa đóng thì không đọc hết được câu", () => {
    expect(blocked("SELECT 1; /* chưa đóng")).toBe("attach_hidden");
  });

  it("AC6: ba dạng hợp lệ vẫn cho qua", () => {
    expect(assertSqliteSafe("SELECT * FROM users WHERE email = 'a@example.com'")).toEqual({ ok: true });
    expect(assertSqliteSafe("PRAGMA table_info(users)")).toEqual({ ok: true });
    expect(assertSqliteSafe("CREATE VIEW v AS SELECT id FROM users")).toEqual({ ok: true });
  });

  it("Ca biên: chữ ATTACH trong chuỗi hoặc tên bảng không phải lệnh", () => {
    expect(assertSqliteSafe(`SELECT 'ATTACH', 'VACUUM INTO', 'load_extension'`)).toEqual({ ok: true });
    expect(assertSqliteSafe("CREATE TABLE t (attach TEXT, detach TEXT, vacuum TEXT)")).toEqual({ ok: true });
    expect(assertSqliteSafe("SELECT attach FROM t")).toEqual({ ok: true });
    expect(assertSqliteSafe("SELECT [attach] FROM t")).toEqual({ ok: true });
    // VACUUM thường (không INTO) chỉ dọn database trong bộ nhớ, không ghi ra file.
    expect(assertSqliteSafe("VACUUM")).toEqual({ ok: true });
  });

  it("Ca biên: SQL 2MB", () => {
    const big = `CREATE TABLE t (id INTEGER);\n${"INSERT INTO t VALUES (1);\n".repeat(80_000)}SELECT COUNT(*) FROM t;`;
    expect(big.length).toBeGreaterThan(2_000_000);
    const t0 = performance.now();
    expect(assertSqliteSafe(big)).toEqual({ ok: true });
    expect(performance.now() - t0).toBeLessThan(2_000);
    // Câu chặn nằm cuối chuỗi 2MB vẫn bị bắt.
    expect(blocked(`${big}ATTACH 'x.db' AS x;`)).toBe("attach");
  });
});
