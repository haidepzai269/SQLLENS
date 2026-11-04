import { describe, expect, it } from "vitest";
import type { PlanNode } from "@/contracts/plan";
import { buildJoinSteps, isIndexed, joinSupport, planRows } from "./steps";

const node = (kind: PlanNode["kind"], x: Partial<PlanNode> = {}): PlanNode => ({ id: "1", kind, label: kind, children: [], ...x });

describe("buildJoinSteps", () => {
  it("nested loop: mỗi dòng ngoài dò hết bảng trong", () => {
    const s = buildJoinSteps("nested_loop");
    expect(s).toHaveLength(4);
    expect(s.at(-1)).toMatchObject({ compares: 24, out: 4 });
  });
  it("nested loop với inner index: mỗi dòng ngoài một lần tra", () => {
    expect(buildJoinSteps("nested_loop", true).at(-1)).toMatchObject({ compares: 4, out: 4 });
  });
  it("hash join: dựng 6 dòng rồi dò 4 dòng", () => {
    const s = buildJoinSteps("hash_join");
    expect(s).toHaveLength(10);
    expect(s[5].built).toBe(6);
    expect(s.at(-1)).toMatchObject({ compares: 8, out: 4 });
  });
  it("merge join: hai con trỏ chỉ tiến, không lùi", () => {
    const s = buildJoinSteps("merge_join");
    expect(s.at(-1)).toMatchObject({ compares: 9, out: 4 });
    s.forEach((x, i) => i && expect([x.a >= s[i - 1].a, x.b >= s[i - 1].b]).toEqual([true, true]));
  });
});

describe("joinSupport / planRows", () => {
  it("merge join trên MySQL và node không phải join thì không mô phỏng", () => {
    expect(joinSupport(node("merge_join"), "mysql")).toEqual({ reason: "noMerge" });
    expect(joinSupport(node("merge_join"), "postgres")).toEqual({ kind: "merge_join" });
    expect(joinSupport(node("seq_scan"), "postgres")).toEqual({ reason: "notJoin" });
  });
  it("số dòng: 0 là số hợp lệ, thiếu thì null, ước tính nhân loops", () => {
    expect(planRows(node("hash_join", { actualRows: 0 }))).toEqual({ real: 0 });
    expect(planRows(node("hash_join"))).toBeNull();
    expect(planRows(node("hash_join", { estimatedRows: 10, loops: 3 }))).toEqual({ est: 30 });
    expect(planRows(node("hash_join", { actualRows: NaN }))).toBeNull();
  });
  it("inner index", () => {
    expect(isIndexed(node("nested_loop", { children: [node("seq_scan"), node("index_scan")] }))).toBe(true);
    expect(isIndexed(node("nested_loop"))).toBe(false);
  });
});
