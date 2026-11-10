import { describe, expect, it } from "vitest";
import enMessages from "../../../messages/en/error-remediation.json";
import viMessages from "../../../messages/vi/error-remediation.json";
import { matchMysqlError } from "./mysql-matcher";

function resolveKey(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/^error-remediation\./, "").split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

describe("matchMysqlError", () => {
  // AC1.1: 1050 - ER_TABLE_EXISTS_ERROR
  it("nhận diện lỗi 1050 (Table already exists) và sinh đủ 3 actions Quick Fix", () => {
    const raw = "Table 'users' already exists";
    const sql = "CREATE TABLE users (id int, name varchar(50));";
    const result = matchMysqlError(raw, sql);

    expect(result.engine).toBe("mysql");
    expect(result.code).toBe("1050");
    expect(result.category).toBe("schema");
    expect(result.rawMessage).toBe(raw);
    expect(result.highlightToken).toBe("users");
    expect(result.explanationParams).toEqual({ table: "users" });
    expect(result.actions).toHaveLength(3);

    // Action 1: replace_stmt
    expect(result.actions[0]).toEqual({
      type: "replace_stmt",
      targetSql: "CREATE TABLE users",
      replacementSql: "CREATE TABLE IF NOT EXISTS users",
      labelKey: "error-remediation.actions.add_if_not_exists",
    });

    // Action 2: prepend_stmt
    expect(result.actions[1]).toEqual({
      type: "prepend_stmt",
      sqlToPrepend: "DROP TABLE IF EXISTS users;\n",
      labelKey: "error-remediation.actions.drop_table_first",
    });

    // Action 3: rebuild_sandbox
    expect(result.actions[2]).toEqual({
      type: "rebuild_sandbox",
      labelKey: "error-remediation.actions.rebuild_sandbox",
    });
  });

  it("nhận diện lỗi 1050 khi câu lệnh có backticks", () => {
    const raw = "Table 'db.orders' already exists";
    const sql = "CREATE TABLE `orders` (`id` int);";
    const result = matchMysqlError(raw, sql);

    expect(result.code).toBe("1050");
    expect(result.highlightToken).toBe("orders");
    expect(result.actions[0]).toEqual({
      type: "replace_stmt",
      targetSql: "CREATE TABLE `orders`",
      replacementSql: "CREATE TABLE IF NOT EXISTS `orders`",
      labelKey: "error-remediation.actions.add_if_not_exists",
    });
    expect(result.actions[1]).toEqual({
      type: "prepend_stmt",
      sqlToPrepend: "DROP TABLE IF EXISTS orders;\n",
      labelKey: "error-remediation.actions.drop_table_first",
    });
  });

  // AC1.2: 1146 - ER_NO_SUCH_TABLE
  it("nhận diện lỗi 1146 (Table doesn't exist)", () => {
    const raw = "Table 'sqllens.customers' doesn't exist";
    const sql = "SELECT * FROM customers;";
    const result = matchMysqlError(raw, sql);

    expect(result.code).toBe("1146");
    expect(result.category).toBe("schema");
    expect(result.highlightToken).toBe("customers");
    expect(result.explanationParams).toEqual({ table: "customers" });
    expect(result.actions).toEqual([
      {
        type: "rebuild_sandbox",
        labelKey: "error-remediation.actions.rebuild_sandbox",
      },
    ]);
  });

  // AC1.3: 1054 - ER_BAD_FIELD_ERROR
  it("nhận diện lỗi 1054 (Unknown column)", () => {
    const raw = "Unknown column 'email' in 'field list'";
    const sql = "SELECT email FROM users;";
    const result = matchMysqlError(raw, sql);

    expect(result.code).toBe("1054");
    expect(result.category).toBe("schema");
    expect(result.highlightToken).toBe("email");
    expect(result.explanationParams).toEqual({ column: "email" });
    expect(result.actions).toEqual([]);
  });

  // AC1.4: 1062 - ER_DUP_ENTRY
  it("nhận diện lỗi 1062 (Duplicate entry)", () => {
    const raw = "Duplicate entry '1' for key 'PRIMARY'";
    const sql = "INSERT INTO users (id) VALUES (1);";
    const result = matchMysqlError(raw, sql);

    expect(result.code).toBe("1062");
    expect(result.category).toBe("integrity");
    expect(result.highlightToken).toBe("PRIMARY");
    expect(result.explanationParams).toEqual({ constraint: "PRIMARY" });
    expect(result.actions).toEqual([
      {
        type: "rebuild_sandbox",
        labelKey: "error-remediation.actions.rebuild_sandbox",
      },
    ]);
  });

  // AC1.5: 1452 - ER_NO_REFERENCED_ROW_2
  it("nhận diện lỗi 1452 (Foreign key constraint fails)", () => {
    const raw =
      "Cannot add or update a child row: a foreign key constraint fails (`test`.`orders`, CONSTRAINT `fk_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`))";
    const sql = "INSERT INTO orders (customer_id) VALUES (999);";
    const result = matchMysqlError(raw, sql);

    expect(result.code).toBe("1452");
    expect(result.category).toBe("integrity");
    expect(result.highlightToken).toBe("fk_customer");
    expect(result.explanationParams).toEqual({ constraint: "fk_customer" });
    expect(result.actions).toEqual([
      {
        type: "rebuild_sandbox",
        labelKey: "error-remediation.actions.rebuild_sandbox",
      },
    ]);
  });

  it("nhận diện lỗi 1452 khi thông báo ngắn không có tên CONSTRAINT", () => {
    const raw = "Cannot add or update a child row: a foreign key constraint fails";
    const result = matchMysqlError(raw, "INSERT INTO orders (customer_id) VALUES (999);");

    expect(result.code).toBe("1452");
    expect(result.explanationParams).toEqual({ constraint: "foreign_key" });
  });

  // AC1.6: 1064 - ER_PARSE_ERROR
  it("nhận diện lỗi 1064 (Syntax error)", () => {
    const raw =
      "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'FORM users' at line 1";
    const sql = "SELECT * FORM users;";
    const result = matchMysqlError(raw, sql);

    expect(result.code).toBe("1064");
    expect(result.category).toBe("syntax");
    expect(result.highlightToken).toBe("FORM users");
    expect(result.explanationParams).toEqual({ token: "FORM users" });
    expect(result.actions).toEqual([]);
  });

  // AC1.7: 1048 - ER_BAD_NULL_ERROR
  it("nhận diện lỗi 1048 (Column cannot be null)", () => {
    const raw = "Column 'username' cannot be null";
    const sql = "INSERT INTO users (username) VALUES (NULL);";
    const result = matchMysqlError(raw, sql);

    expect(result.code).toBe("1048");
    expect(result.category).toBe("integrity");
    expect(result.highlightToken).toBe("username");
    expect(result.explanationParams).toEqual({ column: "username" });
    expect(result.actions).toEqual([]);
  });

  // AC1.8: 1406 - ER_DATA_TOO_LONG
  it("nhận diện lỗi 1406 (Data too long for column)", () => {
    const raw = "Data too long for column 'phone' at line 1";
    const sql = "INSERT INTO users (phone) VALUES ('01234567890123456789');";
    const result = matchMysqlError(raw, sql);

    expect(result.code).toBe("1406");
    expect(result.category).toBe("datatype");
    expect(result.highlightToken).toBe("phone");
    expect(result.explanationParams).toEqual({ column: "phone" });
    expect(result.actions).toEqual([]);
  });

  // AC1.9: Fallback UNKNOWN
  it("trả về mã UNKNOWN và action rebuild_sandbox khi gặp lỗi lạ", () => {
    const raw = "Unknown MySQL server error code 9999 occurred";
    const sql = "SELECT 1;";
    const result = matchMysqlError(raw, sql);

    expect(result.code).toBe("UNKNOWN");
    expect(result.category).toBe("other");
    expect(result.rawMessage).toBe(raw);
    expect(result.titleKey).toBe("error-remediation.titles.unknown_error");
    expect(result.actions).toEqual([
      {
        type: "rebuild_sandbox",
        labelKey: "error-remediation.actions.rebuild_sandbox",
      },
    ]);
  });

  // Bảo toàn rawMessage 100%
  it("bảo toàn 100% chuỗi rawMessage", () => {
    const complex = "Error 1050 (42S01) at line 5: Table 'sqllens.items' already exists";
    const result = matchMysqlError(complex, "CREATE TABLE items (id int);");
    expect(result.rawMessage).toBe(complex);
  });

  // Tất cả translation keys có bản dịch hợp lệ ở cả vi và en
  it("toàn bộ key sinh ra đều có bản dịch hợp lệ trong vi và en", () => {
    const testCases = [
      "Table 'users' already exists",
      "Table 'customers' doesn't exist",
      "Unknown column 'email' in 'field list'",
      "Duplicate entry '1' for key 'PRIMARY'",
      "Cannot add or update a child row: a foreign key constraint fails",
      "You have an error in your SQL syntax near 'XYZ'",
      "Column 'username' cannot be null",
      "Data too long for column 'phone'",
      "Completely unknown error",
    ];

    for (const raw of testCases) {
      const res = matchMysqlError(raw, "CREATE TABLE users (id int);");

      expect(resolveKey(viMessages, res.titleKey), `vi thiếu titleKey: ${res.titleKey}`).toBeDefined();
      expect(resolveKey(enMessages, res.titleKey), `en thiếu titleKey: ${res.titleKey}`).toBeDefined();

      expect(
        resolveKey(viMessages, res.explanationKey),
        `vi thiếu explanationKey: ${res.explanationKey}`,
      ).toBeDefined();
      expect(
        resolveKey(enMessages, res.explanationKey),
        `en thiếu explanationKey: ${res.explanationKey}`,
      ).toBeDefined();

      for (const action of res.actions) {
        expect(
          resolveKey(viMessages, action.labelKey),
          `vi thiếu labelKey: ${action.labelKey}`,
        ).toBeDefined();
        expect(
          resolveKey(enMessages, action.labelKey),
          `en thiếu labelKey: ${action.labelKey}`,
        ).toBeDefined();
      }
    }
  });
});
