import { describe, expect, it } from "vitest";
import type { BTreeModel, BTreeNode } from "@/contracts/btree";
import { smallFixture } from "../view/fixtures";
import { planRange } from "./range";
import { buildSteps, rangeError } from "./steps";

const leaf = (page: number, keys: string[], next?: number, totalKeys = keys.length): BTreeNode => ({ page, level: 0, keys, totalKeys, ...(next ? { next } : {}) });
// root 1 -> leaf 2..5, mỗi leaf đủ khóa, 5 là leaf cuối
const chain = (over: Partial<BTreeModel> = {}): BTreeModel => ({
  ...smallFixture(),
  height: 2,
  columns: ["id"],
  nodes: [
    { page: 1, level: 1, keys: ["", "10", "20", "30"], children: [2, 3, 4, 5], totalKeys: 4 },
    leaf(2, ["1", "2", "9"], 3),
    leaf(3, ["10", "11", "19"], 4),
    leaf(4, ["20", "21", "29"], 5),
    leaf(5, ["30", "31"]),
  ],
  ...over,
});
const P = { key: "9", pages: [1, 2], heapPage: 7 };

describe("planRange", () => {
  it("trượt qua các leaf bằng next và dừng ở leaf đầu tiên có khóa vượt khóa cuối", () => {
    const r = planRange(chain(), P, "21");
    expect(r).toMatchObject({ end: "done" });
    expect("slide" in r && r.slide.map((n) => n.page)).toEqual([3, 4]);
  });
  it("hết index thì dừng ở leaf cuối", () => {
    expect(planRange(chain(), P, "99")).toMatchObject({ end: "lastLeaf" });
  });
  it("leaf bên phải chưa đọc thì dừng và nói chưa đọc, không thêm leaf giả", () => {
    const m = chain();
    m.nodes = m.nodes.filter((n) => n.page !== 4);
    const r = planRange(m, P, "99");
    expect(r).toMatchObject({ end: "unread" });
    expect("slide" in r && r.slide.map((n) => n.page)).toEqual([3]);
  });
  it("leaf chỉ có một phần khóa thì không khẳng định chỗ kết thúc", () => {
    const m = chain();
    m.nodes[1] = leaf(2, ["1", "2", "9"], 3, 300);
    m.nodes[2] = leaf(3, ["10", "11", "12"], 4, 300);
    // khóa đầu của leaf 3 (10) <= 15 nên chắc chắn phải sang leaf 3; leaf 3 không biết hết khóa chưa, khóa đầu leaf 4 (20) > 15
    const r = planRange(m, P, "15");
    expect(r).toMatchObject({ end: "partial" });
    expect("slide" in r && r.slide.map((n) => n.page)).toEqual([3]);
  });
  it("so theo số, không theo chữ: 9 đến 10", () => {
    const m = chain();
    expect(planRange(m, P, "10")).toMatchObject({ end: "done" });
    expect(planRange(m, { key: "9", pages: [1, 2] }, "10")).toMatchObject({ end: "done" });
  });
  it("lỗi: từ lớn hơn đến, sai kiểu, nhiều cột", () => {
    expect(planRange(chain(), P, "5")).toEqual({ error: "badRange" });
    expect(planRange(chain(), P, "abc")).toEqual({ error: "badType" });
    expect(planRange(chain({ columns: ["a", "b"] }), P, "20")).toEqual({ error: "multiColumn" });
    expect(rangeError(chain(), P, "5")).toBe("badRange");
    expect(buildSteps(chain(), P, "5")).toEqual([]);
  });
  it("khoảng chỉ nằm trong một leaf thì không trượt", () => {
    const r = planRange(chain(), { key: "1", pages: [1, 2] }, "2");
    expect(r).toMatchObject({ slide: [], end: "done" });
  });
});

describe("buildSteps với khoảng", () => {
  it("xuống leaf đầu, trượt, rồi heap của dòng đầu cuối cùng", () => {
    const s = buildSteps(chain(), P, "21");
    expect(s.map((x) => x.msg)).toEqual(["internal", "rangeStart", "slide", "slide", "heapRange"]);
    expect(s[2]).toMatchObject({ page: 3, slide: true, src: 1, vals: { leaves: 2 } });
    expect(s[3]).toMatchObject({ page: 4, src: 2, end: "done", vals: { leaves: 3 } });
    expect(s[4]).toMatchObject({ heap: true, page: 7, src: 1 });
  });
  it("không có heapPage thì bỏ bước heap", () => {
    const s = buildSteps(chain(), { key: "9", pages: [1, 2] }, "21");
    expect(s.some((x) => x.heap)).toBe(false);
  });
});
