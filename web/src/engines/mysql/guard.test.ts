import { describe, expect, test } from "vitest";
import { canRunExplain } from "./guard";

describe("canRunExplain MySQL Engine Guard", () => {
  test("chặn chạy EXPLAIN ngầm trên MySQL khi không phải hành động tường minh từ người dùng", () => {
    expect(canRunExplain("mysql", false)).toBe(false);
  });

  test("cho phép chạy EXPLAIN trên MySQL khi người dùng chủ động bấm nút tường minh", () => {
    expect(canRunExplain("mysql", true)).toBe(true);
  });

  test("luôn cho phép chạy EXPLAIN ngầm trên PostgreSQL (chạy trong Web Worker cục bộ an toàn)", () => {
    expect(canRunExplain("postgres", false)).toBe(true);
    expect(canRunExplain("postgres", true)).toBe(true);
  });

  test("mặc định an toàn cho các engine khác", () => {
    expect(canRunExplain(undefined, false)).toBe(true);
    expect(canRunExplain(null, false)).toBe(true);
  });
});
