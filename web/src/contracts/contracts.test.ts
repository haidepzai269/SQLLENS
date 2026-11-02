import { describe, expect, it } from "vitest";
import type { Conclusion, Evidence, Outcome } from "./conclusion";
import { isApiError } from "./api-error";

const ev: Evidence = { kind: "plan", messageKey: "k" };

// Mỗi @ts-expect-error là một AC; nếu dòng không còn lỗi compile, typecheck đỏ.
// @ts-expect-error AC1: thiếu label
export const ac1: Conclusion<number> =
  { kind: "conclusion", data: 1, evidence: [ev] };
export const ac2: Conclusion<number> = {
  kind: "conclusion",
  // @ts-expect-error AC2: label ngoài ba giá trị
  label: "guess",
  data: 1,
  evidence: [ev],
};
export const ac3: Conclusion<number> = {
  kind: "conclusion",
  label: "real",
  data: 1,
  // @ts-expect-error AC3: evidence rỗng
  evidence: [],
};
export const ac4: Conclusion<number> = {
  kind: "conclusion",
  // @ts-expect-error AC4: hai nhãn dạng mảng
  label: ["real", "simulated"],
  data: 1,
  evidence: [ev],
};

function describeOutcome(o: Outcome<number>): string {
  switch (o.kind) {
    case "conclusion":
      return o.label;
    case "not_simulated":
      return o.reasonKey;
    default: {
      const _never: never = o;
      return _never;
    }
  }
}

describe("contracts", () => {
  it("AC5: switch đủ hai nhánh", () => {
    expect(describeOutcome({ kind: "conclusion", label: "real", data: 1, evidence: [ev] })).toBe("real");
    expect(describeOutcome({ kind: "not_simulated", reasonKey: "r" })).toBe("r");
  });
  it("AC6: isApiError", () => {
    expect(isApiError({ error: { code: "not_found", messageKey: "errors.notFound" } })).toBe(true);
    expect(isApiError({ error: { code: "x" } })).toBe(false);
    expect(isApiError({ error: { code: 1, messageKey: "m" } })).toBe(false);
    expect(isApiError({ error: null })).toBe(false);
    expect(isApiError({})).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError("x")).toBe(false);
  });
});
