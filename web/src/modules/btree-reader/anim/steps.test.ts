import { describe, expect, it } from "vitest";
import { bigFixture, smallFixture } from "../view/fixtures";
import { buildSteps } from "./steps";

describe("buildSteps", () => {
  it("đường đi 1 -> 2 -> 5 và heap, lấy khoảng khóa thật từ trang", () => {
    const s = buildSteps(smallFixture(), { key: "121", pages: [1, 2, 5], heapPage: 77 });
    expect(s.map((x) => x.msg)).toEqual(["internal", "internal", "leafFound", "heap"]);
    expect(s[0].vals).toMatchObject({ lo: "−∞", hi: "500", child: 2 });
    expect(s[1].vals).toMatchObject({ lo: "120", hi: "300", child: 5 });
    expect(s[2].vals).toMatchObject({ total: 180 });
    expect(s[3]).toMatchObject({ heap: true, page: 77, n: 4 });
  });
  it("khóa không nằm trong phần khóa đã đọc của leaf thì không khẳng định tìm thấy", () => {
    const s = buildSteps(smallFixture(), { key: "999", pages: [1, 2, 5] });
    expect(s[2].msg).toBe("leafMissing");
  });
  it("nhánh cuối không có khóa chặn trên", () => {
    const s = buildSteps(smallFixture(), { key: "950", pages: [1, 3, 9] });
    expect(s[1].msg).toBe("internalOpen");
  });
  it("trang ẩn và con không có trong trang cha", () => {
    const s = buildSteps(bigFixture(), { key: "7000", pages: [1, 11, 500] });
    expect(s[2].msg).toBe("hidden");
    expect(buildSteps(smallFixture(), { key: "1", pages: [1, 9, 5] })[0].msg).toBe("internalNoRange");
  });
  it("cây một tầng", () => {
    const m = { ...smallFixture(), height: 1, nodes: [{ page: 1, level: 0, keys: ["1", "2"], totalKeys: 2 }] };
    const s = buildSteps(m, { key: "1", pages: [1] });
    expect(s[0]).toMatchObject({ kind: "rootLeaf", msg: "leafFound" });
  });
});
