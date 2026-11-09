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

  it("MySQL Bookmark Lookup: rơi qua Secondary Index và nhảy sang Clustered Index", () => {
    const clusteredModel = {
      ...smallFixture(),
      engine: "mysql" as const,
      index: "PRIMARY",
      nodes: [
        { page: 3, level: 1, keys: ["", "50"], children: [4, 5], totalKeys: 2 },
        { page: 4, level: 0, keys: ["10", "42"], totalKeys: 2 },
        { page: 5, level: 0, keys: ["50", "90"], totalKeys: 2 },
      ],
      rootPage: 3,
      height: 2,
    };

    const secondaryModel = {
      ...smallFixture(),
      engine: "mysql" as const,
      index: "idx_email",
      columns: ["email"],
      clusteredIndex: clusteredModel,
      nodes: [
        { page: 10, level: 0, keys: ["alice@example.com", "bob@example.com"], totalKeys: 2 },
      ],
      rootPage: 10,
      height: 1,
    };

    const s = buildSteps(secondaryModel, {
      key: "bob@example.com",
      pages: [10],
      lookupKey: "42",
      lookupPages: [3, 4],
    });

    expect(s.map((x) => x.msg)).toEqual(["secLeafFound", "lookupJump", "clusteredLeafFound"]);
    expect(s[0]).toMatchObject({ kind: "rootLeaf", msg: "secLeafFound", vals: { key: "bob@example.com", lookupKey: "42" } });
    expect(s[1]).toMatchObject({ kind: "clusteredRoot", msg: "lookupJump", page: 3, isClustered: true });
    expect(s[2]).toMatchObject({ kind: "clusteredLeaf", msg: "clusteredLeafFound", page: 4, isClustered: true });
  });

  it("MySQL Covering Index: chỉ rơi trên Secondary Index với coveringLeafFound, không nhảy", () => {
    const secondaryModel = {
      ...smallFixture(),
      engine: "mysql" as const,
      index: "idx_email",
      columns: ["email"],
      isCovering: true,
      nodes: [
        { page: 10, level: 0, keys: ["alice@example.com", "bob@example.com"], totalKeys: 2 },
      ],
      rootPage: 10,
      height: 1,
    };

    const s = buildSteps(secondaryModel, {
      key: "alice@example.com",
      pages: [10],
      isCovering: true,
    });

    expect(s.map((x) => x.msg)).toEqual(["coveringLeafFound"]);
    expect(s[0]).toMatchObject({ kind: "rootLeaf", msg: "coveringLeafFound" });
  });
});
