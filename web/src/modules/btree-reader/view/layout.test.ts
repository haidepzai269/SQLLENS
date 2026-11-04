import { describe, expect, it } from "vitest";
import { bigFixture, smallFixture } from "./fixtures";
import { firstPath, hid, layoutTree, pid, settle } from "./layout";

describe("layoutTree", () => {
  it("đặt đúng tầng và nối đúng trang con", () => {
    const l = layoutTree(smallFixture(), [1, 2, 4]);
    const y = (p: number) => l.items.find((i) => i.id === pid(p))!.y;
    expect(y(1)).toBeLessThan(y(2));
    expect(y(2)).toBeLessThan(y(4));
    expect(l.edges.filter((e) => e.kind === "child" && e.from === pid(1)).map((e) => e.to)).toEqual([pid(2), pid(3)]);
    expect(l.edges.find((e) => e.kind === "next")).toMatchObject({ from: pid(4), to: pid(5) });
    expect(l.edges.filter((e) => e.lit).map((e) => e.to)).toEqual([pid(2), pid(4)]);
  });
  it("hidden thành một khối ở đúng tầng leaf", () => {
    const l = layoutTree(bigFixture());
    const h = l.items.find((i) => i.id === hid(0))!;
    expect(h.count).toBe(206);
    expect(l.items.filter((i) => i.y === h.y && i.id !== h.id).every((i) => i.level === 0)).toBe(true);
  });
  it("tô cạnh tới khối hidden khi chỉ con ẩn thứ 2 nằm trên đường đi", () => {
    const m = { ...smallFixture(), height: 2, rootPage: 2, totalPages: 4, hidden: [{ level: 0, count: 3 }],
      nodes: [{ page: 2, level: 1, keys: ["", "1", "2"], children: [10, 11, 12], totalKeys: 3 }] };
    const e = layoutTree(m, [2, 11]).edges;
    expect(e).toHaveLength(1);
    expect(e[0].lit).toBe(true);
  });
  it("align: tổ tiên nằm ngay trên con của đường đi, nên cả đường đi cùng một cột dù tầng leaf rộng", () => {
    const leaves = Array.from({ length: 30 }, (_, i) => ({ page: 10 + i, level: 0, keys: [String(i)], totalKeys: 1 }));
    const m = { ...smallFixture(), height: 2, rootPage: 1, totalPages: 31, hidden: [],
      nodes: [{ page: 1, level: 1, keys: ["", "5"], children: leaves.map((l) => l.page), totalKeys: 30 }, ...leaves] };
    const mid = (l: ReturnType<typeof layoutTree>, p: number) => { const i = l.items.find((x) => x.id === pid(p))!; return i.x + i.w / 2; };
    expect(Math.abs(mid(layoutTree(m), 1) - mid(layoutTree(m), 10))).toBeGreaterThan(1000); // mặc định: root giữa các leaf
    for (const leaf of [10, 39]) {
      const l = layoutTree(m, [], [1, leaf]);
      expect(mid(l, 1)).toBeCloseTo(mid(l, leaf), 5);
    }
  });
  it("align với trang chưa đọc: dùng khối hidden của đúng tầng", () => {
    const l = layoutTree(bigFixture(), [], [bigFixture().rootPage, 99999]);
    expect(l.items.length).toBeGreaterThan(0); // không ném lỗi, trang lạ không có item thì bỏ qua
  });
  it("firstPath đi theo con đầu tiên từ root, không quá height", () => {
    const m = smallFixture();
    const p = firstPath(m);
    expect(p[0]).toBe(m.rootPage);
    expect(p.length).toBeLessThanOrEqual(m.height);
    expect(p[1]).toBe(m.nodes.find((n) => n.page === m.rootPage)!.children![0]);
  });
  it("cây một node", () => {
    const l = layoutTree({ ...smallFixture(), height: 1, nodes: [{ page: 1, level: 0, keys: ["1"], totalKeys: 1 }], hidden: [] });
    expect(l.items).toHaveLength(1);
  });
});

describe("settle", () => {
  const r = (id: string, x: number, y: number) => ({ id, x, y, w: 100, h: 46 });
  it("đẩy ra khỏi vùng chồng, cách tối thiểu 8 px", () => {
    const p = settle([r("a", 0, 0), r("b", 50, 10)], "b");
    const gapX = Math.max(p.x - 100, 0 - (p.x + 100));
    const gapY = Math.max(p.y - 46, 0 - (p.y + 46));
    expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(8);
  });
  it("không chồng thì giữ nguyên; luôn không âm", () => {
    expect(settle([r("a", 0, 0), r("b", 300, 0)], "b")).toEqual({ x: 300, y: 0 });
    const p = settle([r("a", 0, 0), r("b", 0, 0)], "b");
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });
});
