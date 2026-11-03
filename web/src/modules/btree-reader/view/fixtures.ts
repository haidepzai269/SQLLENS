import type { BTreeModel, BTreeNode } from "@/contracts/btree";

// Fixture tự dựng theo kiểu BTreeModel, dùng cho test và route thử. Không đọc PGlite.
export function smallFixture(): BTreeModel {
  return {
    engine: "postgres",
    index: "orders_pkey",
    table: "orders",
    columns: ["id"],
    height: 3,
    rootPage: 1,
    totalPages: 5,
    hidden: [],
    nodes: [
      { page: 1, level: 2, keys: ["", "500"], children: [2, 3], totalKeys: 2 },
      { page: 2, level: 1, keys: ["", "120", "300"], children: [4, 5, 6], totalKeys: 3 },
      { page: 3, level: 1, keys: ["500", "700", "900"], children: [7, 8, 9], totalKeys: 3 },
      { page: 4, level: 0, keys: ["1", "2", "3", "4", "5", "6"], next: 5, totalKeys: 119 },
      { page: 5, level: 0, keys: ["120", "121", "122"], next: 6, totalKeys: 180 },
    ],
  };
}

// Dạng cây 500k dòng: 1 root, 3 internal, 196 leaf đã đọc (200 node), 206 leaf chưa đọc.
export function bigFixture(): BTreeModel {
  const leaves: BTreeNode[] = Array.from({ length: 196 }, (_, i) => ({
    page: 100 + i,
    level: 0,
    keys: [1, 2, 3, 4].map((k) => String(i * 180 + k)),
    next: i < 195 ? 101 + i : undefined,
    totalKeys: 180,
  }));
  const internals: BTreeNode[] = [0, 1, 2].map((i) => ({
    page: 10 + i,
    level: 1,
    keys: ["", String(i * 20000)],
    children: leaves.slice(i * 65, i * 65 + 65).map((l) => l.page),
    totalKeys: 65,
  }));
  return {
    engine: "postgres",
    index: "idx_orders_user_id",
    table: "orders",
    columns: ["user_id"],
    height: 3,
    rootPage: 1,
    totalPages: 406,
    hidden: [{ level: 0, count: 206 }],
    nodes: [{ page: 1, level: 2, keys: ["", "20000", "40000"], children: [10, 11, 12], totalKeys: 3 }, ...internals, ...leaves],
  };
}
