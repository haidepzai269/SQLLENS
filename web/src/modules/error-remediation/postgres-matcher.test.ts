import { describe, expect, it } from "vitest";
import enMessages from "../../../messages/en/error-remediation.json";
import viMessages from "../../../messages/vi/error-remediation.json";
import { matchPostgresError } from "./postgres-matcher";

function resolveKey(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/^error-remediation\./, "").split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

describe("matchPostgresError", () => {
  // AC2.1: 42P07 - duplicate_table
  it("nhận diện lỗi 42P07 (duplicate_table) và sinh đủ 3 actions", () => {
    const raw = 'relation "users" already exists';
    const sql = "CREATE TABLE users (id int, name text);";
    const result = matchPostgresError(raw, sql);

    expect(result.engine).toBe("postgres");
    expect(result.code).toBe("42P07");
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
      sqlToPrepend: "DROP TABLE IF EXISTS users CASCADE;\n",
      labelKey: "error-remediation.actions.drop_table_first",
    });

    // Action 3: rebuild_sandbox
    expect(result.actions[2]).toEqual({
      type: "rebuild_sandbox",
      labelKey: "error-remediation.actions.rebuild_sandbox",
    });
  });

  it("nhận diện lỗi 42P07 với biến thể table 'orders' already exists", () => {
    const raw = 'table "orders" already exists';
    const sql = "create table orders (id int);";
    const result = matchPostgresError(raw, sql);

    expect(result.code).toBe("42P07");
    expect(result.highlightToken).toBe("orders");
    expect(result.actions[0]).toMatchObject({
      type: "replace_stmt",
      replacementSql: "CREATE TABLE IF NOT EXISTS orders",
    });
  });

  // AC2.2: 42P01 - undefined_table
  it("nhận diện lỗi 42P01 (undefined_table)", () => {
    const raw = 'relation "customers" does not exist';
    const sql = "SELECT * FROM customers;";
    const result = matchPostgresError(raw, sql);

    expect(result.code).toBe("42P01");
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

  it("nhận diện lỗi 42P01 với biến thể table 'products' does not exist", () => {
    const raw = 'table "products" does not exist';
    const result = matchPostgresError(raw, "SELECT 1;");
    expect(result.code).toBe("42P01");
    expect(result.highlightToken).toBe("products");
  });

  // AC2.3: 42703 - undefined_column
  it("nhận diện lỗi 42703 (undefined_column)", () => {
    const raw = 'column "email" of relation "users" does not exist';
    const sql = "SELECT email FROM users;";
    const result = matchPostgresError(raw, sql);

    expect(result.code).toBe("42703");
    expect(result.category).toBe("schema");
    expect(result.highlightToken).toBe("email");
    expect(result.explanationParams).toEqual({ column: "email" });
    expect(result.actions).toEqual([]);
  });

  it("nhận diện lỗi 42703 với biến thể không có tên relation", () => {
    const raw = 'column "score" does not exist';
    const result = matchPostgresError(raw, "SELECT score;");
    expect(result.code).toBe("42703");
    expect(result.highlightToken).toBe("score");
  });

  // AC2.4: 23505 - unique_violation
  it("nhận diện lỗi 23505 (unique_violation) và gợi ý ON CONFLICT", () => {
    const raw = 'duplicate key value violates unique constraint "users_email_key"';
    const sql = "INSERT INTO users (id, email) VALUES (1, 'test@example.com');";
    const result = matchPostgresError(raw, sql);

    expect(result.code).toBe("23505");
    expect(result.category).toBe("integrity");
    expect(result.highlightToken).toBe("users_email_key");
    expect(result.explanationParams).toEqual({ constraint: "users_email_key" });
    expect(result.actions).toEqual([
      {
        type: "replace_stmt",
        targetSql: "INSERT INTO users (id, email) VALUES (1, 'test@example.com');",
        replacementSql:
          "INSERT INTO users (id, email) VALUES (1, 'test@example.com') ON CONFLICT DO NOTHING;",
        labelKey: "error-remediation.actions.add_on_conflict_do_nothing",
      },
      {
        type: "rebuild_sandbox",
        labelKey: "error-remediation.actions.rebuild_sandbox",
      },
    ]);
  });

  // AC2.5: 23503 - foreign_key_violation
  it("nhận diện lỗi 23503 (foreign_key_violation)", () => {
    const raw =
      'insert or update on table "orders" violates foreign key constraint "orders_user_id_fkey"';
    const sql = "INSERT INTO orders (user_id) VALUES (999);";
    const result = matchPostgresError(raw, sql);

    expect(result.code).toBe("23503");
    expect(result.category).toBe("integrity");
    expect(result.highlightToken).toBe("orders_user_id_fkey");
    expect(result.explanationParams).toEqual({ constraint: "orders_user_id_fkey" });
    expect(result.actions).toEqual([
      {
        type: "rebuild_sandbox",
        labelKey: "error-remediation.actions.rebuild_sandbox",
      },
    ]);
  });

  // AC2.6: 23502 - not_null_violation
  it("nhận diện lỗi 23502 (not_null_violation)", () => {
    const raw = 'null value in column "username" of relation "users" violates not-null constraint';
    const sql = "INSERT INTO users (id) VALUES (1);";
    const result = matchPostgresError(raw, sql);

    expect(result.code).toBe("23502");
    expect(result.category).toBe("integrity");
    expect(result.highlightToken).toBe("username");
    expect(result.explanationParams).toEqual({ column: "username" });
    expect(result.actions).toEqual([]);
  });

  it("nhận diện lỗi 23502 với biến thể không có of relation", () => {
    const raw = 'null value in column "created_at" violates not-null constraint';
    const result = matchPostgresError(raw, "INSERT INTO t DEFAULT VALUES;");
    expect(result.code).toBe("23502");
    expect(result.highlightToken).toBe("created_at");
  });

  // AC2.7: 42601 - syntax_error
  it("nhận diện lỗi 42601 (syntax_error)", () => {
    const raw = 'syntax error at or near "FROM"';
    const sql = "SELECT FROM users;";
    const result = matchPostgresError(raw, sql);

    expect(result.code).toBe("42601");
    expect(result.category).toBe("syntax");
    expect(result.highlightToken).toBe("FROM");
    expect(result.explanationParams).toEqual({ token: "FROM" });
    expect(result.actions).toEqual([]);
  });

  // AC2.8: 25P02 - in_failed_sql_transaction
  it("nhận diện lỗi 25P02 (in_failed_sql_transaction) kèm rootCauseHintKey", () => {
    const raw =
      "current transaction is aborted, commands ignored until end of transaction block";
    const sql = "SELECT 1;";
    const result = matchPostgresError(raw, sql);

    expect(result.code).toBe("25P02");
    expect(result.category).toBe("transaction");
    expect(result.rootCauseHintKey).toBe("error-remediation.root_cause_hints.transaction_aborted");
    expect(result.actions).toEqual([
      {
        type: "rebuild_sandbox",
        labelKey: "error-remediation.actions.rebuild_sandbox",
      },
    ]);
  });

  // AC2.9: 22P02 - invalid_text_representation
  it("nhận diện lỗi 22P02 (invalid_text_representation)", () => {
    const raw = 'invalid input syntax for type integer: "abc"';
    const sql = "SELECT * FROM users WHERE age = 'abc';";
    const result = matchPostgresError(raw, sql);

    expect(result.code).toBe("22P02");
    expect(result.category).toBe("datatype");
    expect(result.highlightToken).toBe("abc");
    expect(result.explanationParams).toEqual({ type: "integer", value: "abc" });
    expect(result.actions).toEqual([]);
  });

  it("nhận diện lỗi 22P02 với cú pháp không có chữ 'type'", () => {
    const raw = 'invalid input syntax for uuid: "not-a-uuid"';
    const result = matchPostgresError(raw, "SELECT 1;");
    expect(result.code).toBe("22P02");
    expect(result.explanationParams).toEqual({ type: "uuid", value: "not-a-uuid" });
    expect(result.highlightToken).toBe("not-a-uuid");
  });

  // AC2.10: 2BP01 - dependent_objects_still_exist
  it("nhận diện lỗi 2BP01 (dependent_objects_still_exist) và sinh action CASCADE", () => {
    const raw = "cannot drop table users because other objects depend on it";
    const sql = "DROP TABLE users;";
    const result = matchPostgresError(raw, sql);

    expect(result.code).toBe("2BP01");
    expect(result.category).toBe("schema");
    expect(result.highlightToken).toBe("users");
    expect(result.explanationParams).toEqual({ table: "users" });
    expect(result.actions).toEqual([
      {
        type: "replace_stmt",
        targetSql: "DROP TABLE users;",
        replacementSql: "DROP TABLE users CASCADE;",
        labelKey: "error-remediation.actions.add_cascade",
      },
      {
        type: "rebuild_sandbox",
        labelKey: "error-remediation.actions.rebuild_sandbox",
      },
    ]);
  });

  // AC2 Fallback: UNKNOWN
  it("trả về mã UNKNOWN khi không khớp bất kỳ mẫu lỗi nào", () => {
    const raw = "something completely unexpected occurred in postgres engine";
    const sql = "SELECT 1;";
    const result = matchPostgresError(raw, sql);

    expect(result.code).toBe("UNKNOWN");
    expect(result.category).toBe("other");
    expect(result.rawMessage).toBe(raw);
    expect(result.titleKey).toBe("error-remediation.titles.unknown_error");
    expect(result.explanationKey).toBe("error-remediation.explanations.unknown_error");
    expect(result.actions).toEqual([
      {
        type: "rebuild_sandbox",
        labelKey: "error-remediation.actions.rebuild_sandbox",
      },
    ]);
  });

  // AC3: Bảo toàn rawMessage 100%
  it("luôn bảo toàn 100% chuỗi lỗi gốc trong rawMessage (AC3)", () => {
    const complexRaw =
      'ERROR: 42P01: relation "missing_tab" does not exist at character 15\nDETAIL: Key info\nHINT: Some hint';
    const result = matchPostgresError(complexRaw, "SELECT * FROM missing_tab;");
    expect(result.rawMessage).toBe(complexRaw);
  });

  // AC4: Mọi key dịch phải tồn tại ở cả vi và en
  it("toàn bộ titleKey, explanationKey, labelKey và rootCauseHintKey đều có bản dịch hợp lệ trong vi và en", () => {
    const testCases = [
      'relation "users" already exists',
      'relation "customers" does not exist',
      'column "email" does not exist',
      'duplicate key value violates unique constraint "users_email_key"',
      'violates foreign key constraint "orders_user_id_fkey"',
      'null value in column "username" violates not-null constraint',
      'syntax error at or near "FROM"',
      "current transaction is aborted, commands ignored until end of transaction block",
      'invalid input syntax for type integer: "abc"',
      "cannot drop table users because other objects depend on it",
      "completely unknown postgres error",
    ];

    for (const raw of testCases) {
      const res = matchPostgresError(raw, "CREATE TABLE users (id int); DROP TABLE users;");

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

      if (res.rootCauseHintKey) {
        expect(
          resolveKey(viMessages, res.rootCauseHintKey),
          `vi thiếu rootCauseHintKey: ${res.rootCauseHintKey}`,
        ).toBeDefined();
        expect(
          resolveKey(enMessages, res.rootCauseHintKey),
          `en thiếu rootCauseHintKey: ${res.rootCauseHintKey}`,
        ).toBeDefined();
      }

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
