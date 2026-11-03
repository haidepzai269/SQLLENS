import { describe, expect, test } from "vitest";
import { SAMPLE_SQL } from "./samples";
import { DIALECT } from "./dialect";

// Tên node lezer của các token trong chuỗi, theo dialect.
function nodes(engine: "postgres" | "mysql", text: string) {
  const out: string[] = [];
  DIALECT[engine].language.parser.parse(text).iterate({
    enter: (n) => void (n.name !== "Script" && n.name !== "Statement" && out.push(`${n.name}:${text.slice(n.from, n.to)}`)),
  });
  return out;
}

describe("dialect", () => {
  test("AC1 backtick là tên ở MySQL, không phải ở PostgreSQL", () => {
    expect(nodes("mysql", "SELECT `a` FROM t")).toContain("QuotedIdentifier:`a`");
    expect(nodes("postgres", "SELECT `a` FROM t").join()).not.toContain("QuotedIdentifier");
  });
  test("AC1 :: là toán tử ở PostgreSQL, không phải ở MySQL", () => {
    expect(nodes("postgres", "SELECT 1::int")).toContain("Operator:::");
    expect(nodes("mysql", "SELECT 1::int").join()).not.toContain("Operator:::");
  });
});

describe("SAMPLE_SQL", () => {
  test.each(["postgres", "mysql"] as const)("%s có đủ 4 loại câu", (e) => {
    for (const k of ["CREATE TABLE", "CREATE INDEX", "INSERT", "SELECT"]) expect(SAMPLE_SQL[e]).toContain(k);
  });
  test("không lẫn cú pháp engine khác", () => {
    expect(SAMPLE_SQL.mysql).not.toMatch(/serial|timestamptz|::|now\(\)/i);
    expect(SAMPLE_SQL.postgres).not.toMatch(/AUTO_INCREMENT|DATETIME|`/i);
  });
});
