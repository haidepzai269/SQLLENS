import { describe, expect, it } from "vitest";
import { packStash, unpackStash } from "./stash";

describe("stash", () => {
  it("không có câu hỏi thì giữ nguyên SQL", () => {
    expect(packStash("SELECT 1", "")).toBe("SELECT 1");
    expect(unpackStash("SELECT 1")).toEqual({ sql: "SELECT 1", ask: "" });
  });
  it("ghép rồi tách lại đúng cả SQL và câu hỏi", () => {
    expect(unpackStash(packStash("SELECT 'a'\n", "tại sao?"))).toEqual({ sql: "SELECT 'a'\n", ask: "tại sao?" });
    expect(unpackStash(packStash("", "chỉ có câu hỏi"))).toEqual({ sql: "", ask: "chỉ có câu hỏi" });
  });
  it("chuỗi giống dấu ghép nhưng hỏng thì là SQL", () => {
    const bad = "\u0000sqllens/v2:{oops";
    expect(unpackStash(bad)).toEqual({ sql: bad, ask: "" });
  });
});
