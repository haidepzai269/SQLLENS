import { describe, expect, it } from "vitest";
import {
  applyStatementFix,
  getStatementAtOffset,
  splitSqlStatements,
  splitSqlStatementsDetailed,
} from "./statement-at-cursor";

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

describe("splitSqlStatementsDetailed", () => {
  it("ghi nhận đúng vị trí dấu ; cho từng câu lệnh", () => {
    const sql = "SELECT 1; SELECT 2;\nSELECT 3";
    const spans = splitSqlStatementsDetailed(sql);
    expect(spans.length).toBe(3);
    expect(spans[0].text).toBe("SELECT 1");
    expect(spans[0].semicolonIndex).toBe(8);
    expect(spans[1].text).toBe("SELECT 2");
    expect(spans[1].semicolonIndex).toBe(18);
    expect(spans[2].text).toBe("SELECT 3");
    expect(spans[2].semicolonIndex).toBeUndefined();
  });
});

describe("applyStatementFix", () => {
  // AC1: Đơn câu lệnh
  describe("AC1: Đơn câu lệnh", () => {
    it("thay thế câu lệnh đơn lẻ thành câu lệnh sửa", () => {
      const fullDoc = "SELECT * FORM users;";
      const targetSql = "SELECT * FORM users;";
      const replacementSql = "SELECT * FROM users;";
      const res = applyStatementFix(fullDoc, targetSql, replacementSql);
      expect(res).toBe("SELECT * FROM users;");
    });

    it("bảo toàn comment trước và sau câu lệnh đơn lẻ", () => {
      const fullDoc = "-- Chu thich dau file\nSELECT * FORM users;\n-- Chu thich cuoi file";
      const targetSql = "SELECT * FORM users;";
      const replacementSql = "SELECT * FROM users;";
      const res = applyStatementFix(fullDoc, targetSql, replacementSql);
      expect(res).toBe("-- Chu thich dau file\nSELECT * FROM users;\n-- Chu thich cuoi file");
    });

    it("xử lý chuẩn xác khi câu lệnh gốc không có dấu ; và replacement có ;", () => {
      const fullDoc = "SELECT * FORM users";
      const targetSql = "SELECT * FORM users";
      const replacementSql = "SELECT * FROM users;";
      const res = applyStatementFix(fullDoc, targetSql, replacementSql);
      expect(res).toBe("SELECT * FROM users;");
    });

    it("xử lý chuẩn xác khi cả câu gốc và replacement đều không có dấu ;", () => {
      const fullDoc = "SELECT * FORM users";
      const targetSql = "SELECT * FORM users";
      const replacementSql = "SELECT * FROM users";
      const res = applyStatementFix(fullDoc, targetSql, replacementSql);
      expect(res).toBe("SELECT * FROM users");
    });

    it("xử lý chuẩn xác khi câu gốc có dấu ; nhưng replacement không có dấu ;", () => {
      const fullDoc = "SELECT * FORM users;";
      const targetSql = "SELECT * FORM users;";
      const replacementSql = "SELECT * FROM users";
      const res = applyStatementFix(fullDoc, targetSql, replacementSql);
      expect(res).toBe("SELECT * FROM users;");
    });
  });

  // AC2: Đa câu lệnh (Multi-statement script)
  describe("AC2: Đa câu lệnh (Multi-statement script)", () => {
    it("chỉ câu lệnh lỗi ở giữa được thay thế, câu lệnh trước và sau giữ nguyên 100%", () => {
      const fullDoc = `CREATE TABLE users (
  id int primary key,
  name text
);

SELECT * FORM users;

SELECT * FROM orders WHERE id = 1;`;

      const targetSql = "SELECT * FORM users;";
      const replacementSql = "SELECT * FROM users;";
      const res = applyStatementFix(fullDoc, targetSql, replacementSql);

      const expected = `CREATE TABLE users (
  id int primary key,
  name text
);

SELECT * FROM users;

SELECT * FROM orders WHERE id = 1;`;

      expect(res).toBe(expected);
    });

    it("thay thế câu lệnh đầu tiên trong script đa câu lệnh", () => {
      const fullDoc = "CREAT TABLE users (id int);\nSELECT * FROM users;";
      const targetSql = "CREAT TABLE users (id int);";
      const replacementSql = "CREATE TABLE users (id int);";
      const res = applyStatementFix(fullDoc, targetSql, replacementSql);
      expect(res).toBe("CREATE TABLE users (id int);\nSELECT * FROM users;");
    });

    it("thay thế câu lệnh cuối cùng không có dấu ; trong script đa câu lệnh", () => {
      const fullDoc = "CREATE TABLE users (id int);\nSELECT * FORM users";
      const targetSql = "SELECT * FORM users";
      const replacementSql = "SELECT * FROM users;";
      const res = applyStatementFix(fullDoc, targetSql, replacementSql);
      expect(res).toBe("CREATE TABLE users (id int);\nSELECT * FROM users;");
    });

    it("bảo toàn các comment phân cách giữa các câu lệnh", () => {
      const fullDoc = `-- Buoc 1: Tao bang
CREATE TABLE users (id int);

/* Buoc 2: Query sai */
SELECT * FORM users;

-- Buoc 3: Query khac
SELECT 1;`;

      const targetSql = "SELECT * FORM users;";
      const replacementSql = "SELECT * FROM users;";
      const res = applyStatementFix(fullDoc, targetSql, replacementSql);

      expect(res).toContain("-- Buoc 1: Tao bang");
      expect(res).toContain("/* Buoc 2: Query sai */");
      expect(res).toContain("SELECT * FROM users;");
      expect(res).toContain("-- Buoc 3: Query khac");
      expect(res).toContain("SELECT 1;");
    });
  });

  // AC3: Nhiều câu lệnh giống nhau, disambiguate bằng errorPosition
  describe("AC3: Nhiều câu lệnh giống nhau và errorPosition", () => {
    it("định vị đúng câu lệnh thứ 2 bị lỗi khi có 2 câu lệnh giống hệt nhau", () => {
      const fullDoc = "SELECT 1;\nSELECT * FORM users;\nSELECT 2;\nSELECT * FORM users;\nSELECT 3;";
      const targetSql = "SELECT * FORM users;";
      const replacementSql = "SELECT * FROM users;";

      // Vị trí lỗi tại câu SELECT * FORM users thứ hai
      // Chuỗi: "SELECT 1;\nSELECT * FORM users;\nSELECT 2;\nSELECT * FORM users;\nSELECT 3;"
      // Vị trí bắt đầu của câu 2: index khoảng 41, 1-based offset: 45
      const secondStmtPos = fullDoc.lastIndexOf("SELECT * FORM users") + 5; // 1-based

      const res = applyStatementFix(fullDoc, targetSql, replacementSql, secondStmtPos);

      // Câu thứ nhất vẫn giữ nguyên "SELECT * FORM users"
      // Câu thứ hai được sửa thành "SELECT * FROM users"
      expect(res).toBe("SELECT 1;\nSELECT * FORM users;\nSELECT 2;\nSELECT * FROM users;\nSELECT 3;");
    });

    it("định vị đúng câu lệnh thứ 1 khi errorPosition nằm ở câu thứ 1", () => {
      const fullDoc = "SELECT * FORM users;\nSELECT 1;\nSELECT * FORM users;";
      const targetSql = "SELECT * FORM users;";
      const replacementSql = "SELECT * FROM users;";

      const firstStmtPos = 5; // 1-based, nằm ở câu đầu tiên
      const res = applyStatementFix(fullDoc, targetSql, replacementSql, firstStmtPos);

      expect(res).toBe("SELECT * FROM users;\nSELECT 1;\nSELECT * FORM users;");
    });
  });

  // Chạy toàn bộ script (targetSql === fullDoc)
  describe("Chạy toàn bộ script và AI 1-Click Fix", () => {
    it("khi targetSql là toàn bộ fullDoc và replacementSql là câu lệnh đơn lẻ, dùng errorPosition để sửa đúng câu lỗi", () => {
      const fullDoc = "CREATE TABLE users (id int);\nSELECT * FORM users;\nSELECT * FROM orders;";
      const targetSql = fullDoc; // người dùng nhấn Run toàn bộ script
      const replacementSql = "SELECT * FROM users;"; // AI Doctor trả về câu lệnh sửa duy nhất

      // errorPosition trỏ vào chữ FORM ở câu 2: khoảng vị trí 38
      const errorPosition = fullDoc.indexOf("FORM") + 1; // 1-based

      const res = applyStatementFix(fullDoc, targetSql, replacementSql, errorPosition);
      expect(res).toBe("CREATE TABLE users (id int);\nSELECT * FROM users;\nSELECT * FROM orders;");
    });

    it("khi targetSql là toàn bộ fullDoc và replacementSql là toàn bộ script (Quick-Fix replace_stmt trên toàn doc)", () => {
      const fullDoc = "CREATE TABLE users (id int);\nSELECT 1;";
      const targetSql = fullDoc;
      const replacementSql = "CREATE TABLE IF NOT EXISTS users (id int);\nSELECT 1;";

      const res = applyStatementFix(fullDoc, targetSql, replacementSql);
      expect(res).toBe(replacementSql);
    });
  });

  // Ca biên
  describe("Ca biên (Edge cases)", () => {
    it("trả về replacementSql khi fullDoc rỗng hoặc chỉ có khoảng trắng", () => {
      expect(applyStatementFix("", "SELECT 1;", "SELECT 2;")).toBe("SELECT 2;");
      expect(applyStatementFix("   \n\t  ", "SELECT 1;", "SELECT 2;")).toBe("SELECT 2;");
    });

    it("trả về fullDoc khi replacementSql null hoặc undefined", () => {
      const doc = "SELECT 1;";
      expect(applyStatementFix(doc, "SELECT 1;", undefined as unknown as string)).toBe(doc);
    });

    it("chuẩn hóa khoảng trắng khi đối soát targetSql và fullDoc", () => {
      const fullDoc = "SELECT   *\n   FORM   users  ;";
      const targetSql = "SELECT * FORM users;";
      const replacementSql = "SELECT * FROM users;";

      const res = applyStatementFix(fullDoc, targetSql, replacementSql);
      expect(res).toBe("SELECT * FROM users;");
    });

    it("khi fullDoc chỉ có comment, gắn replacementSql vào sau comment", () => {
      const fullDoc = "-- Chi co comment o day";
      const targetSql = "SELECT 1;";
      const replacementSql = "SELECT 1;";
      const res = applyStatementFix(fullDoc, targetSql, replacementSql);
      expect(res).toBe("-- Chi co comment o day\nSELECT 1;");
    });
  });
});
