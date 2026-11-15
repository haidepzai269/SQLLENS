// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { beforeAll, describe, expect, it } from "vitest";
import { canExplainSql, runSafeExplainAnalyze } from "./safe-explain";
import { createSession } from "./roles";

let s: Awaited<ReturnType<typeof createSession>>;

beforeAll(async () => {
  const pglite = await PGlite.create({ extensions: { pageinspect } });
  s = await createSession(pglite);

  await s.run(`
    CREATE TABLE users (
      id int primary key,
      name text,
      age int
    );
    INSERT INTO users VALUES
      (1, 'Alice', 25),
      (2, 'Bob', 30),
      (3, 'Charlie', 35);

    CREATE TABLE orders (
      order_id int primary key,
      user_id int,
      amount numeric
    );
    INSERT INTO orders VALUES
      (101, 1, 99.5),
      (102, 1, 150.0),
      (103, 2, 20.0);
  `);
}, 30_000);

describe("safe-explain", () => {
  describe("canExplainSql (Gatekeeper)", () => {
    it("chấp nhận các câu lệnh DML và CTE hợp lệ", () => {
      expect(canExplainSql("SELECT * FROM users")).toBe(true);
      expect(canExplainSql("select id, name from users where age > 20;")).toBe(true);
      expect(canExplainSql("INSERT INTO users VALUES (4, 'Dave', 40)")).toBe(true);
      expect(canExplainSql("UPDATE users SET age = 26 WHERE id = 1")).toBe(true);
      expect(canExplainSql("DELETE FROM users WHERE id = 3")).toBe(true);
      expect(canExplainSql("WITH recent AS (SELECT * FROM orders) SELECT * FROM recent")).toBe(true);
    });

    it("chấp nhận câu lệnh có comment hoặc khoảng trắng bao quanh", () => {
      expect(canExplainSql("-- Lay tat ca users\nSELECT * FROM users")).toBe(true);
      expect(canExplainSql("/* comment */ SELECT * FROM users;")).toBe(true);
      expect(canExplainSql("   SELECT 1   ")).toBe(true);
    });

    it("chấp nhận câu lệnh chứa dấu chấm phẩy lồng nhau trong chuỗi literal", () => {
      expect(canExplainSql("SELECT 'a;b;c' as val FROM users")).toBe(true);
    });

    it("từ chối câu lệnh DDL nguy hiểm", () => {
      expect(canExplainSql("CREATE TABLE hacked (id int)")).toBe(false);
      expect(canExplainSql("DROP TABLE users")).toBe(false);
      expect(canExplainSql("ALTER TABLE users ADD COLUMN email text")).toBe(false);
      expect(canExplainSql("TRUNCATE users")).toBe(false);
    });

    it("từ chối câu lệnh Transaction và Session", () => {
      expect(canExplainSql("BEGIN")).toBe(false);
      expect(canExplainSql("COMMIT")).toBe(false);
      expect(canExplainSql("ROLLBACK")).toBe(false);
      expect(canExplainSql("SET ROLE postgres")).toBe(false);
      expect(canExplainSql("SET search_path TO public")).toBe(false);
    });

    it("từ chối kịch bản đa câu lệnh (Multi-statement)", () => {
      expect(canExplainSql("SELECT 1; DROP TABLE users;")).toBe(false);
      expect(canExplainSql("SELECT 1; SELECT 2;")).toBe(false);
    });

    it("từ chối chuỗi rỗng hoặc chỉ có comment", () => {
      expect(canExplainSql("")).toBe(false);
      expect(canExplainSql("   ")).toBe(false);
      expect(canExplainSql("-- only comment")).toBe(false);
      expect(canExplainSql("/* only block comment */")).toBe(false);
    });
  });

  describe("runSafeExplainAnalyze", () => {
    it("sinh planEvidence chuẩn cho câu SELECT có index và filter", async () => {
      const res = await runSafeExplainAnalyze(s.run, "SELECT * FROM users WHERE id = 1");
      expect(res.error).toBeUndefined();
      expect(res.planEvidence).toBeTruthy();
      expect(res.planEvidence).toContain("[PLAN_EVIDENCE:");
      expect(res.planEvidence).toContain("users");
      expect(res.rawJson).toBeDefined();
    });

    it("AC1: ROLLBACK an toàn tuyệt đối, UPDATE không làm đổi dữ liệu", async () => {
      const beforeRes = await s.run("SELECT name FROM users WHERE id = 1");
      const beforeName = beforeRes[0].rows[0][0];
      expect(beforeName).toBe("Alice");

      // Chạy Safe EXPLAIN cho UPDATE
      const res = await runSafeExplainAnalyze(s.run, "UPDATE users SET name = 'Hacked' WHERE id = 1");
      expect(res.error).toBeUndefined();
      expect(res.planEvidence).toContain("ModifyTable");

      // Kiểm tra dữ liệu sau khi chạy: Alice vẫn là Alice!
      const afterRes = await s.run("SELECT name FROM users WHERE id = 1");
      const afterName = afterRes[0].rows[0][0];
      expect(afterName).toBe("Alice");
    });

    it("AC1: ROLLBACK an toàn tuyệt đối, DELETE không làm mất dòng nào", async () => {
      const beforeCountRes = await s.run("SELECT count(*)::int FROM users");
      const beforeCount = beforeCountRes[0].rows[0][0];
      expect(beforeCount).toBe(3);

      // Chạy Safe EXPLAIN cho DELETE toàn bộ bảng
      const res = await runSafeExplainAnalyze(s.run, "DELETE FROM users");
      expect(res.error).toBeUndefined();
      expect(res.planEvidence).toBeTruthy();

      // Dữ liệu bảng vẫn đầy đủ 3 dòng 100%
      const afterCountRes = await s.run("SELECT count(*)::int FROM users");
      const afterCount = afterCountRes[0].rows[0][0];
      expect(afterCount).toBe(3);
    });

    it("AC1: INSERT trong Safe EXPLAIN không thêm dòng mới vào bảng", async () => {
      const res = await runSafeExplainAnalyze(s.run, "INSERT INTO users VALUES (99, 'Ghost', 99)");
      expect(res.error).toBeUndefined();

      const checkRes = await s.run("SELECT count(*)::int FROM users WHERE id = 99");
      expect(checkRes[0].rows[0][0]).toBe(0);
    });

    it("bỏ qua câu lệnh không hợp lệ (DDL) trả về planEvidence = null", async () => {
      const res = await runSafeExplainAnalyze(s.run, "CREATE TABLE temp_table(id int)");
      expect(res.planEvidence).toBeNull();
      expect(res.rawJson).toBeUndefined();
    });

    it("AC2: cơ chế timeout 1.5s tự động ngắt và trả về error = 'timeout'", async () => {
      // Mô phỏng hàm run chạy chậm hơn timeoutMs (ví dụ timeoutMs = 50ms)
      const slowRun = async (sql: string) => {
        if (sql.startsWith(EXPLAIN_PREFIX_MATCH)) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return s.run(sql);
      };
      const EXPLAIN_PREFIX_MATCH = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)";

      const res = await runSafeExplainAnalyze(slowRun, "SELECT * FROM users", 50);
      expect(res.planEvidence).toBeNull();
      expect(res.error).toBe("timeout");
    });

    it("xử lý lỗi cú pháp SQL an toàn, không văng exception", async () => {
      const res = await runSafeExplainAnalyze(s.run, "SELECT * FROM nonexistent_table_xyz");
      expect(res.planEvidence).toBeNull();
      expect(res.error).toBeTruthy();
    });
  });
});
