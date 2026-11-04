import { describe, expect, it } from "vitest";
import type { Plan, PlanNode } from "@/contracts/plan";
import { flatten, layoutPlan, NW, skew } from "./layout";

const n = (id: string, children: PlanNode[] = [], x: Partial<PlanNode> = {}): PlanNode => ({ id, kind: "other", label: id, children, ...x });
const plan = (root: PlanNode): Plan => ({ engine: "postgres", analyzed: true, root });

describe("plan-tree layout", () => {
  it("flatten theo tiền thứ tự, kèm cha và độ sâu", () => {
    const f = flatten(plan(n("a", [n("b", [n("c")]), n("d")])));
    expect(f.map((x) => [x.node.id, x.depth, x.parent])).toEqual([["a", 0, undefined], ["b", 1, "a"], ["c", 2, "b"], ["d", 1, "a"]]);
  });
  it("plan sâu 20 tầng và id trùng không làm hỏng", () => {
    let r = n("n19");
    for (let i = 18; i >= 0; i--) r = n(`n${i}`, [r]);
    const f = flatten(plan(r));
    expect(f).toHaveLength(20);
    const wide = layoutPlan(f, false);
    expect(wide.n19.x).toBeGreaterThan(wide.n0.x + 19 * NW);
    expect(flatten(plan(n("a", [n("a")])))).toHaveLength(1);
  });
  it("anh em giữ thứ tự: con đầu ở trên", () => {
    const p = layoutPlan(flatten(plan(n("r", [n("a", [n("a1"), n("a2")]), n("b", [n("b1"), n("b2")])]))), false);
    const xs = ["a1", "a2", "b1", "b2"].map((i) => p[i].y);
    expect(xs).toEqual([...xs].sort((x, y) => x - y));
    expect(p.a.y).toBeLessThan(p.b.y);
  });
  it("bản hẹp: một cột, y tăng dần, thụt vào có trần", () => {
    let r = n("n9");
    for (let i = 8; i >= 0; i--) r = n(`n${i}`, [r]);
    const p = layoutPlan(flatten(plan(r)), true);
    expect(p.n1.y).toBeGreaterThan(p.n0.y);
    expect(p.n9.x).toBe(p.n4.x);
  });
  it("skew tính loops và chỉ khi analyzed", () => {
    expect(skew(n("a", [], { estimatedRows: 1, actualRows: 1000 }), true)).toBe("more");
    expect(skew(n("a", [], { estimatedRows: 1000, actualRows: 3 }), true)).toBe("less");
    expect(skew(n("a", [], { estimatedRows: 100, loops: 10, actualRows: 1000 }), true)).toBeUndefined();
    expect(skew(n("a", [], { estimatedRows: 1, actualRows: 1000 }), false)).toBeUndefined();
    expect(skew(n("a", [], { estimatedRows: 1 }), true)).toBeUndefined();
  });
});
