import { describe, expect, it } from "vitest";
import { toDraft, validate } from "./schema-draft";

const col = (name: string, pk = false) => ({ name, type: "text", reason: "default" as const, primaryKeyGuess: pk });
const t = (name: string, columns = [col("id", true)]) => ({ name, columns, foreignKeyGuesses: [], incomplete: false });

describe("validate", () => {
  it("bảng hợp lệ thì không có vấn đề", () => expect(validate(toDraft([t("a")]), "postgres")).toEqual([]));
  it("bảng hết cột, tên rỗng, tên trùng, hai khóa chính, cột placeholder", () => {
    const d = toDraft([t("a", []), t(" "), t("a"), t("b", [col("x", true), col("y", true)]), t("c", [col("_sqllens_placeholder")])]);
    expect(validate(d, "postgres").map((i) => `${i.key}:${i.table}`)).toEqual(["no-columns:0", "empty-name:1", "duplicate-table:2", "multi-pk:3", "placeholder:4"]);
  });
  it("cột trùng: MySQL không phân biệt hoa thường, PostgreSQL có", () => {
    const d = toDraft([t("a", [col("X"), col("x")])]);
    expect(validate(d, "postgres")).toEqual([]);
    expect(validate(d, "mysql")).toEqual([{ key: "duplicate-column", table: 0, column: 1 }]);
  });
  it("chế độ tự viết SQL bỏ qua kiểm form", () => expect(validate({ ...toDraft([t("a", [])]), mode: "sql" }, "postgres")).toEqual([]));
});
