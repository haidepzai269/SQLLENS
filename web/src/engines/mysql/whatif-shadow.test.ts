import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { QueryResult } from "@/contracts/engine";
import {
  extractMysqlProbeStats,
  parseAndRewriteChange,
  rewriteProbeQuery,
  runMysqlWhatif,
} from "./whatif-shadow";

const FULL_SCAN_JSON = {
  query_block: {
    select_id: 1,
    cost_info: { query_cost: "201.50" },
    table: {
      table_name: "users",
      access_type: "ALL",
      rows_examined_per_scan: 2000,
      rows_produced_per_join: 200,
      cost_info: { read_cost: "181.50" },
    },
  },
};

const INDEX_LOOKUP_JSON = {
  query_block: {
    select_id: 1,
    cost_info: { query_cost: "1.00" },
    table: {
      table_name: "users",
      access_type: "const",
      key: "PRIMARY",
      rows_examined_per_scan: 1,
      rows_produced_per_join: 1,
      cost_info: { read_cost: "0.00" },
    },
  },
};

describe("whatif-shadow: parseAndRewriteChange (AC1)", () => {
  it("nhận diện và rewrite CREATE INDEX", () => {
    const res = parseAndRewriteChange("CREATE INDEX idx_orders_created_at ON orders(created_at);");
    expect(res).not.toBeNull();
    expect(res?.targetTable).toBe("orders");
    expect(res?.shadowTable).toBe("__whatif_orders");
    expect(res?.rewrittenChange).toBe("CREATE INDEX idx_orders_created_at ON `__whatif_orders` (created_at)");
  });

  it("nhận diện và rewrite CREATE UNIQUE INDEX có backticks", () => {
    const res = parseAndRewriteChange("CREATE UNIQUE INDEX `idx_email` ON `users` (`email`)");
    expect(res).not.toBeNull();
    expect(res?.targetTable).toBe("users");
    expect(res?.shadowTable).toBe("__whatif_users");
    expect(res?.rewrittenChange).toBe("CREATE UNIQUE INDEX `idx_email` ON `__whatif_users` (`email`)");
  });

  it("nhận diện và rewrite ALTER TABLE ... ADD INDEX", () => {
    const res = parseAndRewriteChange("ALTER TABLE orders ADD INDEX idx_created (created_at);");
    expect(res).not.toBeNull();
    expect(res?.targetTable).toBe("orders");
    expect(res?.shadowTable).toBe("__whatif_orders");
    expect(res?.rewrittenChange).toBe("ALTER TABLE `__whatif_orders` ADD INDEX idx_created (created_at)");
  });

  it("nhận diện và rewrite ALTER TABLE ... ADD KEY có backticks", () => {
    const res = parseAndRewriteChange("ALTER TABLE `orders` ADD KEY (`created_at`)");
    expect(res).not.toBeNull();
    expect(res?.targetTable).toBe("orders");
    expect(res?.shadowTable).toBe("__whatif_orders");
    expect(res?.rewrittenChange).toBe("ALTER TABLE `__whatif_orders` ADD KEY (`created_at`)");
  });

  it("nhận diện và rewrite DROP INDEX ... ON table", () => {
    const res = parseAndRewriteChange("DROP INDEX idx_created ON orders");
    expect(res).not.toBeNull();
    expect(res?.targetTable).toBe("orders");
    expect(res?.shadowTable).toBe("__whatif_orders");
    expect(res?.rewrittenChange).toBe("DROP INDEX idx_created ON `__whatif_orders`");
  });

  it("trả null với câu không phải DDL trên bảng hợp lệ", () => {
    expect(parseAndRewriteChange("SELECT * FROM orders")).toBeNull();
    expect(parseAndRewriteChange("CREATE TABLE orders (id INT)")).toBeNull();
    expect(parseAndRewriteChange("UPDATE orders SET id = 1")).toBeNull();
  });
});

describe("whatif-shadow: rewriteProbeQuery", () => {
  it("đổi tên bảng sang bảng shadow trong câu SELECT đơn giản", () => {
    const res = rewriteProbeQuery("SELECT * FROM orders WHERE created_at > '2026-01-01'", "orders", "__whatif_orders");
    expect(res).toBe("SELECT * FROM `__whatif_orders` WHERE created_at > '2026-01-01'");
  });

  it("không đổi tên bảng nằm trong chuỗi nháy đơn (string literal)", () => {
    const res = rewriteProbeQuery("SELECT * FROM orders WHERE status = 'orders'", "orders", "__whatif_orders");
    expect(res).toBe("SELECT * FROM `__whatif_orders` WHERE status = 'orders'");
  });

  it("không đổi tên bảng nằm trong comment", () => {
    const res = rewriteProbeQuery("SELECT * FROM orders /* query orders */ -- test orders", "orders", "__whatif_orders");
    expect(res).toBe("SELECT * FROM `__whatif_orders` /* query orders */ -- test orders");
  });

  it("giữ nguyên alias và đổi tiền tố bảng", () => {
    const res = rewriteProbeQuery("SELECT orders.id, o.created_at FROM orders o WHERE orders.id = 1", "orders", "__whatif_orders");
    expect(res).toBe("SELECT `__whatif_orders`.id, o.created_at FROM `__whatif_orders` o WHERE `__whatif_orders`.id = 1");
  });

  it("đổi đúng bảng mục tiêu trong câu JOIN nhiều bảng", () => {
    const res = rewriteProbeQuery("SELECT * FROM users u JOIN orders o ON u.id = o.user_id", "orders", "__whatif_orders");
    expect(res).toBe("SELECT * FROM users u JOIN `__whatif_orders` o ON u.id = o.user_id");
  });
});

describe("whatif-shadow: extractMysqlProbeStats (AC2)", () => {
  it("trích xuất đúng chi phí và số dòng từ mẫu full scan", () => {
    const { stats } = extractMysqlProbeStats(FULL_SCAN_JSON);
    expect(stats.rows).toBe(2000);
    expect(stats.sharedReadBlocks).toBe(202); // Math.ceil(201.50)
    expect(stats.nodeTypes).toEqual(["ALL"]);
  });

  it("trích xuất đúng chi phí và số dòng từ mẫu index lookup", () => {
    const { stats } = extractMysqlProbeStats(INDEX_LOOKUP_JSON);
    expect(stats.rows).toBe(1);
    expect(stats.sharedReadBlocks).toBe(1);
    expect(stats.nodeTypes).toEqual(["const"]);
  });
});

describe("whatif-shadow: runMysqlWhatif", () => {
  const PROBE = "SELECT * FROM orders WHERE created_at > '2026-01-01'";
  const CHANGE = "CREATE INDEX idx_created ON orders(created_at)";

  it("AC1 AC2: thực thi đầy đủ chu trình shadow table và trả kết quả nhãn Thật (real)", async () => {
    const executed: string[] = [];
    const exec = vi.fn(async (sql: string): Promise<QueryResult[]> => {
      executed.push(sql);
      if (sql.startsWith("EXPLAIN FORMAT=JSON SELECT * FROM orders")) {
        return [{ columns: ["EXPLAIN"], rows: [[JSON.stringify(FULL_SCAN_JSON)]] }];
      }
      if (sql.startsWith("EXPLAIN FORMAT=JSON SELECT * FROM `__whatif_orders`")) {
        return [{ columns: ["EXPLAIN"], rows: [[JSON.stringify(INDEX_LOOKUP_JSON)]] }];
      }
      return [{ columns: [], rows: [] }];
    });

    const res = await runMysqlWhatif(exec, CHANGE, PROBE);

    expect(res.kind).toBe("conclusion");
    if (res.kind === "conclusion") {
      expect(res.label).toBe("real");
      expect(res.data.before.rows).toBe(2000);
      expect(res.data.before.sharedReadBlocks).toBe(202);
      expect(res.data.after.rows).toBe(1);
      expect(res.data.after.sharedReadBlocks).toBe(1);
      expect(res.evidence.map((e) => e.messageKey)).toEqual(["tryChange.pagesBefore", "tryChange.pagesAfter"]);
    }

    // Kiểm tra đúng trình tự câu lệnh
    expect(executed).toEqual([
      "EXPLAIN FORMAT=JSON SELECT * FROM orders WHERE created_at > '2026-01-01'",
      "DROP TABLE IF EXISTS `__whatif_orders`",
      "CREATE TABLE `__whatif_orders` LIKE `orders`",
      "INSERT INTO `__whatif_orders` SELECT * FROM `orders` LIMIT 10000",
      "CREATE INDEX idx_created ON `__whatif_orders` (created_at)",
      "EXPLAIN FORMAT=JSON SELECT * FROM `__whatif_orders` WHERE created_at > '2026-01-01'",
      "DROP TABLE IF EXISTS `__whatif_orders`", // Dọn dẹp trong finally
    ]);
  });

  it("AC3: đảm bảo DROP TABLE IF EXISTS trong finally kể cả khi DDL lỗi", async () => {
    const executed: string[] = [];
    const exec = vi.fn(async (sql: string): Promise<QueryResult[]> => {
      executed.push(sql);
      if (sql.startsWith("EXPLAIN FORMAT=JSON SELECT * FROM orders")) {
        return [{ columns: ["EXPLAIN"], rows: [[JSON.stringify(FULL_SCAN_JSON)]] }];
      }
      if (sql.startsWith("CREATE INDEX")) {
        throw new Error("Duplicate key or syntax error");
      }
      return [{ columns: [], rows: [] }];
    });

    await expect(runMysqlWhatif(exec, CHANGE, PROBE)).rejects.toThrow("Duplicate key or syntax error");

    // Dù lỗi, DROP TABLE IF EXISTS vẫn phải được gọi cuối cùng
    expect(executed).toContain("DROP TABLE IF EXISTS `__whatif_orders`");
    expect(executed[executed.length - 1]).toBe("DROP TABLE IF EXISTS `__whatif_orders`");
  });

  it("từ chối câu change có transaction (BEGIN/COMMIT/ROLLBACK)", async () => {
    const exec = vi.fn();
    const res = await runMysqlWhatif(exec, "CREATE INDEX idx ON orders(id); COMMIT", PROBE);
    expect(res).toEqual({ kind: "not_simulated", reasonKey: "tryChange.transaction" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("từ chối câu probe có nhiều hơn một lệnh", async () => {
    const exec = vi.fn();
    const res = await runMysqlWhatif(exec, CHANGE, "SELECT 1; SELECT 2");
    expect(res).toEqual({ kind: "not_simulated", reasonKey: "tryChange.probeSingle" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("từ chối câu change không xác định được bảng mục tiêu", async () => {
    const exec = vi.fn();
    const res = await runMysqlWhatif(exec, "SET GLOBAL max_connections = 100", PROBE);
    expect(res).toEqual({ kind: "not_simulated", reasonKey: "tryChange.unsupportedDdl" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("mọi khóa tryChange.* có bản dịch vi và en", () => {
    for (const l of ["vi", "en"] as const) {
      const m = JSON.parse(readFileSync(`messages/${l}/tryChange.json`, "utf8"));
      expect(m).toHaveProperty("unsupportedDdl");
      expect(m).toHaveProperty("singleChange");
    }
  });
});
