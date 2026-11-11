import { describe, expect, it } from "vitest";
import { getStatementAtOffset, splitSqlStatements } from "./statement-at-cursor";

describe("splitSqlStatements", () => {
  it("tách các câu lệnh đơn giản theo dấu ;", () => {
    const sql = "SELECT 1; SELECT 2;\nSELECT 3;";
    const spans = splitSqlStatements(sql);
    expect(spans.map((s) => s.text)).toEqual(["SELECT 1", "SELECT 2", "SELECT 3"]);
  });

  it("bỏ qua dấu ; trong string literals và quotes", () => {
    const sql = "SELECT 'hello; world' AS col; SELECT \"col;name\" FROM `tbl;name`;";
    const spans = splitSqlStatements(sql);
    expect(spans.map((s) => s.text)).toEqual([
      "SELECT 'hello; world' AS col",
      "SELECT \"col;name\" FROM `tbl;name`",
    ]);
  });

  it("bỏ qua dấu ; trong Dollar quote của PostgreSQL", () => {
    const sql = "CREATE FUNCTION foo() RETURNS void AS $$ BEGIN SELECT 1; END; $$ LANGUAGE plpgsql; SELECT 2;";
    const spans = splitSqlStatements(sql);
    expect(spans.length).toBe(2);
    expect(spans[0].text).toContain("SELECT 1; END;");
    expect(spans[1].text).toBe("SELECT 2");
  });

  it("bỏ qua dấu ; trong comment -- và /* */", () => {
    const sql = "-- SELECT 1;\nSELECT 2; /* ; comment ; */ SELECT 3;";
    const spans = splitSqlStatements(sql);
    expect(spans.map((s) => s.text)).toEqual(["SELECT 2", "SELECT 3"]);
  });

  it("hỗ trợ câu lệnh cuối không có dấu ;", () => {
    const sql = "SELECT 1; SELECT 2";
    const spans = splitSqlStatements(sql);
    expect(spans.map((s) => s.text)).toEqual(["SELECT 1", "SELECT 2"]);
  });
});

describe("getStatementAtOffset", () => {
  it("trả về null khi editor trống hoặc chỉ có khoảng trắng / comment", () => {
    expect(getStatementAtOffset("", 0)).toBeNull();
    expect(getStatementAtOffset("   \n\t  ", 2)).toBeNull();
    expect(getStatementAtOffset("-- comment only", 5)).toBeNull();
  });

  it("lấy đúng câu lệnh chứa con trỏ", () => {
    const sql = "SELECT 1; SELECT 2; SELECT 3;";
    // offset 3 nằm trong "SELECT 1"
    expect(getStatementAtOffset(sql, 3)).toBe("SELECT 1");
    // offset 14 nằm trong "SELECT 2"
    expect(getStatementAtOffset(sql, 14)).toBe("SELECT 2");
    // offset 24 nằm trong "SELECT 3"
    expect(getStatementAtOffset(sql, 24)).toBe("SELECT 3");
  });

  it("con trỏ nằm ở khoảng trắng giữa 2 câu hoặc sau dấu ; chọn câu lệnh gần nhất", () => {
    const sql = "SELECT 1;\n\nSELECT 2;";
    // Ngay sau dấu ; của SELECT 1
    const idxAfterSemi = sql.indexOf(";") + 1;
    expect(getStatementAtOffset(sql, idxAfterSemi)).toBe("SELECT 1");

    // Ở dòng trống giữa 2 câu: offset gần SELECT 2 hơn
    const idxBeforeSel2 = sql.indexOf("SELECT 2") - 1;
    expect(getStatementAtOffset(sql, idxBeforeSel2)).toBe("SELECT 2");

    // Con trỏ ở cuối sau dấu ; cuối cùng
    expect(getStatementAtOffset(sql, sql.length)).toBe("SELECT 2");
  });

  it("lấy câu lệnh duy nhất dù con trỏ ở bất kỳ đâu", () => {
    const sql = "  SELECT * FROM users  ";
    expect(getStatementAtOffset(sql, 0)).toBe("SELECT * FROM users");
    expect(getStatementAtOffset(sql, sql.length)).toBe("SELECT * FROM users");
  });
});
