import { describe, expect, it } from "vitest";
import {
  buildBTreeFromData,
  compareKeys,
  findBTreePath,
  quoteId,
  readMysqlBTree,
  type IndexMeta,
  type TableStats,
} from "./btree-builder";

describe("mysql btree-builder", () => {
  const sampleUsers = [
    { id: 1, email: "alice@example.com", name: "Alice", age: 30 },
    { id: 2, email: "bob@example.com", name: "Bob", age: 25 },
    { id: 3, email: "charlie@example.com", name: "Charlie", age: 35 },
    { id: 4, email: "david@example.com", name: "David", age: 28 },
    { id: 5, email: "eve@example.com", name: "Eve", age: 22 },
    { id: 6, email: "frank@example.com", name: "Frank", age: 40 },
    { id: 7, email: "grace@example.com", name: "Grace", age: 29 },
    { id: 8, email: "heidi@example.com", name: "Heidi", age: 31 },
  ];

  const primaryMeta: IndexMeta = {
    name: "PRIMARY",
    tableName: "users",
    columns: ["id"],
    isUnique: true,
    isPk: true,
  };

  const emailIndexMeta: IndexMeta = {
    name: "idx_users_email",
    tableName: "users",
    columns: ["email"],
    isUnique: true,
    isPk: false,
  };

  describe("compareKeys & quoteId", () => {
    it("so sánh số theo giá trị số", () => {
      expect(compareKeys("5", "10")).toBeLessThan(0);
      expect(compareKeys("100", "20")).toBeGreaterThan(0);
      expect(compareKeys("42", "42")).toBe(0);
    });

    it("so sánh chuỗi theo bảng chữ cái", () => {
      expect(compareKeys("alice", "bob")).toBeLessThan(0);
      expect(compareKeys("david", "charlie")).toBeGreaterThan(0);
    });

    it("quoteId an toàn với backtick", () => {
      expect(quoteId("users")).toBe("`users`");
      expect(quoteId("my`table")).toBe("`my``table`");
    });
  });

  describe("AC1: Dựng cây B+Tree InnoDB Clustered Index (Primary Key)", () => {
    it("dựng Clustered Index: leaf page lưu toàn bộ dữ liệu dòng", () => {
      const model = buildBTreeFromData("users", primaryMeta, ["id"], sampleUsers, undefined, {
        maxLeafKeys: 4,
        maxChildren: 3,
      });

      expect(model.engine).toBe("mysql");
      expect(model.index).toBe("PRIMARY");
      expect(model.isClustered).toBe(true);
      expect(model.height).toBeGreaterThan(1);

      // Kiểm tra leaf nodes
      const leafNodes = model.nodes.filter((n) => n.level === 0);
      expect(leafNodes.length).toBe(2); // 8 rows / 4 per leaf = 2 leaves

      // Leaf 1 chứa 4 rows đầu
      expect(leafNodes[0].keys).toEqual(["1", "2", "3", "4"]);
      expect(leafNodes[0].leafRows).toHaveLength(4);
      expect(leafNodes[0].leafRows![0]).toEqual(sampleUsers[0]);

      // Leaf 2 chứa 4 rows sau
      expect(leafNodes[1].keys).toEqual(["5", "6", "7", "8"]);
      expect(leafNodes[1].leafRows).toHaveLength(4);

      // Root node ở level 1
      const rootNode = model.nodes.find((n) => n.page === model.rootPage);
      expect(rootNode).toBeDefined();
      expect(rootNode!.level).toBe(1);
      expect(rootNode!.children).toEqual([leafNodes[0].page, leafNodes[1].page]);
      expect(rootNode!.keys).toEqual(["", "5"]); // "" (-inf) cho con 0, "5" cho con 1
    });

    it("AC5: các leaf page liên kết qua next (doubly-linked list của InnoDB)", () => {
      const model = buildBTreeFromData("users", primaryMeta, ["id"], sampleUsers, undefined, {
        maxLeafKeys: 4,
      });
      const leaves = model.nodes.filter((n) => n.level === 0);
      expect(leaves[0].next).toBe(leaves[1].page);
      expect(leaves[1].next).toBeUndefined(); // leaf cuối không có next
    });

    it("đối chiếu thống kê innodb_index_stats: tính đúng hidden và totalPages", () => {
      const stats: TableStats = { nLeafPages: 10, size: 25 };
      const model = buildBTreeFromData("users", primaryMeta, ["id"], sampleUsers, stats, {
        maxLeafKeys: 4,
      });

      expect(model.totalPages).toBe(25);
      expect(model.hidden).toEqual([{ level: 0, count: 25 - model.nodes.length }]);
    });
  });

  describe("AC1 & AC3: Dựng Secondary Index và Bookmark Lookup", () => {
    it("dựng Secondary Index: leaf page chứa index key và tự động kèm Clustered Index", () => {
      const model = buildBTreeFromData("users", emailIndexMeta, ["id"], sampleUsers, undefined, {
        maxLeafKeys: 4,
      });

      expect(model.isClustered).toBe(false);
      expect(model.index).toBe("idx_users_email");
      expect(model.columns).toEqual(["email"]);

      // Kèm cây Clustered Index (PRIMARY)
      expect(model.clusteredIndex).toBeDefined();
      expect(model.clusteredIndex!.isClustered).toBe(true);
      expect(model.clusteredIndex!.index).toBe("PRIMARY");

      // Số trang của 2 cây không trùng nhau (root Clustered = 3, Secondary bắt đầu từ 10)
      expect(model.clusteredIndex!.rootPage).toBe(5); // 3, 4 là leaf, 5 là root
      expect(model.rootPage).toBe(12); // 10, 11 là leaf, 12 là root
    });

    it("AC3: tìm kiếm trên Secondary Index tìm ra PK và sinh đường đi Bookmark Lookup trên Clustered Index", () => {
      const model = buildBTreeFromData("users", emailIndexMeta, ["id"], sampleUsers, undefined, {
        maxLeafKeys: 4,
      });

      // Tìm kiếm "bob@example.com" (id = 2)
      const secPath = findBTreePath(model, "bob@example.com");
      expect(secPath.found).toBe(true);
      expect(secPath.leafRow).toMatchObject({ id: 2, email: "bob@example.com" });

      // Bookmark Lookup trên Clustered Index với PK = 2
      const clusPath = findBTreePath(model.clusteredIndex!, "2");
      expect(clusPath.found).toBe(true);
      expect(clusPath.leafRow).toMatchObject({ id: 2, name: "Bob" });
    });

    it("AC4: hỗ trợ cờ Covering Index (isCovering = true)", () => {
      const model = buildBTreeFromData("users", emailIndexMeta, ["id"], sampleUsers, undefined, {
        isCovering: true,
      });

      expect(model.isCovering).toBe(true);
    });
  });

  describe("Ca biên", () => {
    it("bảng rỗng: cây 1 tầng không có khóa", () => {
      const model = buildBTreeFromData("users", primaryMeta, ["id"], [], undefined);
      expect(model.height).toBe(1);
      expect(model.nodes).toHaveLength(1);
      expect(model.nodes[0].keys).toEqual([]);
      expect(model.totalPages).toBe(1);
    });

    it("bảng chỉ có 1 dòng: root cũng là leaf (height = 1)", () => {
      const model = buildBTreeFromData("users", primaryMeta, ["id"], [sampleUsers[0]], undefined);
      expect(model.height).toBe(1);
      expect(model.nodes).toHaveLength(1);
      expect(model.nodes[0].keys).toEqual(["1"]);
      expect(model.rootPage).toBe(model.nodes[0].page);
    });

    it("khóa không tồn tại: path vẫn chỉ đến leaf thích hợp nhưng found = false", () => {
      const model = buildBTreeFromData("users", primaryMeta, ["id"], sampleUsers, undefined);
      const path = findBTreePath(model, "999");
      expect(path.found).toBe(false);
      expect(path.pages.length).toBe(model.height);
    });
  });

  describe("AC2 & AC6: readMysqlBTree với mock query execution", () => {
    it("trả về model mang nhãn simulated và evidence innodb_stats", async () => {
      const mockExec = async (sql: string) => {
        if (sql.includes("information_schema.STATISTICS") && sql.includes("idx_users_email")) {
          return [
            {
              columns: ["TABLE_NAME", "INDEX_NAME", "COLUMN_NAME", "SEQ_IN_INDEX", "NON_UNIQUE", "INDEX_TYPE"],
              rows: [["users", "idx_users_email", "email", 1, 0, "BTREE"]],
            },
          ];
        }
        if (sql.includes("information_schema.STATISTICS") && sql.includes("PRIMARY")) {
          return [
            {
              columns: ["COLUMN_NAME"],
              rows: [["id"]],
            },
          ];
        }
        if (sql.includes("mysql.innodb_index_stats")) {
          return [
            {
              columns: ["stat_name", "stat_value"],
              rows: [
                ["n_leaf_pages", 2],
                ["size", 3],
              ],
            },
          ];
        }
        if (sql.includes("SELECT * FROM `users`")) {
          return [
            {
              columns: ["id", "email", "name", "age"],
              rows: sampleUsers.map((u) => [u.id, u.email, u.name, u.age]),
            },
          ];
        }
        return [{ columns: [], rows: [] }];
      };

      const result = await readMysqlBTree(mockExec, "idx_users_email", { probeKey: "charlie@example.com" });
      expect(result.model.kind).toBe("conclusion");
      if (result.model.kind === "conclusion") {
        expect(result.model.label).toBe("simulated"); // AC2: nhãn Mô phỏng
        expect(result.model.data.engine).toBe("mysql");
        expect(result.model.data.index).toBe("idx_users_email");
        expect(result.model.evidence[0].kind).toBe("innodb_stats");
        expect(result.model.evidence[0].messageKey).toBe("mysql.btree.evidence");

        // Bookmark Lookup
        expect(result.path).toBeDefined();
        expect(result.path!.key).toBe("charlie@example.com");
        expect(result.path!.lookupKey).toBe("3"); // PK của charlie là 3
        expect(result.path!.lookupPages).toBeDefined();
      }
    });

    it("index không tồn tại trả về not_simulated", async () => {
      const mockExec = async () => [{ columns: [], rows: [] }];
      const result = await readMysqlBTree(mockExec, "non_existent_index");
      expect(result.model.kind).toBe("not_simulated");
    });
  });
});
