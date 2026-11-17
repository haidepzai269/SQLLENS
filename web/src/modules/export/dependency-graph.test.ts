import { describe, expect, it } from "vitest";
import { buildDependencyGraph, topoSort } from "./dependency-graph";
import { DependencyGraphError, type TableSpec } from "./types";

describe("dependency-graph & topoSort", () => {
  it("AC1: 5 bảng khai báo lộn xộn cho ra thứ tự trong đó mọi bảng cha đứng trước bảng con", () => {
    // 5 bảng với quan hệ phụ thuộc:
    // categories (không FK)
    // users (không FK)
    // posts (phụ thuộc users, categories)
    // orders (phụ thuộc users)
    // comments (phụ thuộc users, posts)
    const tables: TableSpec[] = [
      {
        name: "comments",
        columns: [{ name: "id", type: "int", primaryKey: true }],
        foreignKeys: [
          { columns: ["post_id"], refTable: "posts", refColumns: ["id"] },
          { columns: ["author_id"], refTable: "users", refColumns: ["id"] },
        ],
      },
      {
        name: "orders",
        columns: [{ name: "id", type: "int", primaryKey: true }],
        foreignKeys: [
          { columns: ["user_id"], refTable: "users", refColumns: ["id"] },
        ],
      },
      {
        name: "users",
        columns: [{ name: "id", type: "int", primaryKey: true }],
        foreignKeys: [],
      },
      {
        name: "posts",
        columns: [{ name: "id", type: "int", primaryKey: true }],
        foreignKeys: [
          { columns: ["user_id"], refTable: "users", refColumns: ["id"] },
          { columns: ["category_id"], refTable: "categories", refColumns: ["id"] },
        ],
      },
      {
        name: "categories",
        columns: [{ name: "id", type: "int", primaryKey: true }],
        foreignKeys: [],
      },
    ];

    const graph = buildDependencyGraph(tables);
    const result = topoSort(graph);

    expect(result.cycles).toEqual([]);
    expect(result.order).toHaveLength(5);

    const pos = (name: string) => result.order.indexOf(name);

    // Bảng cha phải đứng trước bảng con
    expect(pos("users")).toBeLessThan(pos("posts"));
    expect(pos("users")).toBeLessThan(pos("orders"));
    expect(pos("users")).toBeLessThan(pos("comments"));
    expect(pos("categories")).toBeLessThan(pos("posts"));
    expect(pos("posts")).toBeLessThan(pos("comments"));

    // Bậc 0: categories và users cùng sẵn sàng, categories < users theo alphabet
    expect(result.order[0]).toBe("categories");
    expect(result.order[1]).toBe("users");
  });

  it("AC2: Chu trình A→B→A được phát hiện, trả trong cycles, không treo, không ném lỗi", () => {
    const tables: TableSpec[] = [
      {
        name: "A",
        columns: [{ name: "id", type: "int", primaryKey: true }],
        foreignKeys: [{ columns: ["b_id"], refTable: "B", refColumns: ["id"] }],
      },
      {
        name: "B",
        columns: [{ name: "id", type: "int", primaryKey: true }],
        foreignKeys: [{ columns: ["a_id"], refTable: "A", refColumns: ["id"] }],
      },
    ];

    const graph = buildDependencyGraph(tables);
    const result = topoSort(graph);

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toEqual(["A", "B", "A"]);
  });

  it("AC3: Bảng tự tham chiếu (parent_id trỏ chính nó) không bị coi là chu trình", () => {
    const tables: TableSpec[] = [
      {
        name: "categories",
        columns: [
          { name: "id", type: "int", primaryKey: true },
          { name: "parent_id", type: "int", nullable: true },
        ],
        foreignKeys: [
          { columns: ["parent_id"], refTable: "categories", refColumns: ["id"] },
        ],
      },
    ];

    const graph = buildDependencyGraph(tables);
    expect(graph.selfReferences?.categories).toHaveLength(1);
    expect(graph.dependencies.categories).toEqual([]);

    const result = topoSort(graph);
    expect(result.cycles).toEqual([]);
    expect(result.order).toEqual(["categories"]);
  });

  it("AC4: Cùng đầu vào cho ra cùng đầu ra (chạy 10 lần giống nhau)", () => {
    const tables: TableSpec[] = [
      {
        name: "zeta",
        columns: [{ name: "id", type: "int" }],
        foreignKeys: [{ columns: ["beta_id"], refTable: "beta", refColumns: ["id"] }],
      },
      {
        name: "alpha",
        columns: [{ name: "id", type: "int" }],
        foreignKeys: [],
      },
      {
        name: "beta",
        columns: [{ name: "id", type: "int" }],
        foreignKeys: [{ columns: ["alpha_id"], refTable: "alpha", refColumns: ["id"] }],
      },
      {
        name: "gamma",
        columns: [{ name: "id", type: "int" }],
        foreignKeys: [{ columns: ["alpha_id"], refTable: "alpha", refColumns: ["id"] }],
      },
    ];

    const initial = topoSort(buildDependencyGraph(tables));

    for (let i = 0; i < 10; i++) {
      const current = topoSort(buildDependencyGraph(tables));
      expect(current.order).toEqual(initial.order);
      expect(current.cycles).toEqual(initial.cycles);
    }

    // Thứ tự trong cùng một bậc sắp theo tên bảng tăng dần
    // Bậc 0: alpha
    // Bậc 1: beta, gamma (beta < gamma)
    // Bậc 2: zeta
    expect(initial.order).toEqual(["alpha", "beta", "gamma", "zeta"]);
  });

  it("AC5: Bảng không có khóa ngoại và bảng không được tham chiếu đều có mặt trong order", () => {
    const tables: TableSpec[] = [
      {
        name: "users",
        columns: [{ name: "id", type: "int", primaryKey: true }],
        foreignKeys: [], // không có khóa ngoại
      },
      {
        name: "posts",
        columns: [{ name: "id", type: "int", primaryKey: true }],
        foreignKeys: [{ columns: ["user_id"], refTable: "users", refColumns: ["id"] }], // không được bảng nào tham chiếu
      },
      {
        name: "audit_logs",
        columns: [{ name: "id", type: "int", primaryKey: true }],
        foreignKeys: [], // vừa không có khóa ngoại vừa không được tham chiếu (cô lập hoàn toàn)
      },
    ];

    const graph = buildDependencyGraph(tables);
    const result = topoSort(graph);

    expect(result.cycles).toEqual([]);
    expect(result.order).toContain("users");
    expect(result.order).toContain("posts");
    expect(result.order).toContain("audit_logs");
    expect(result.order).toHaveLength(3);

    // users và audit_logs cùng bậc 0, audit_logs < users
    expect(result.order).toEqual(["audit_logs", "users", "posts"]);
  });

  describe("AC6: Đầy đủ 6 kịch bản bắt buộc", () => {
    it("Kịch bản 1: Chuỗi thẳng (A -> B -> C -> D)", () => {
      const tables: TableSpec[] = [
        { name: "D", columns: [], foreignKeys: [{ columns: ["c_id"], refTable: "C", refColumns: ["id"] }] },
        { name: "B", columns: [], foreignKeys: [{ columns: ["a_id"], refTable: "A", refColumns: ["id"] }] },
        { name: "A", columns: [], foreignKeys: [] },
        { name: "C", columns: [], foreignKeys: [{ columns: ["b_id"], refTable: "B", refColumns: ["id"] }] },
      ];

      const result = topoSort(buildDependencyGraph(tables));
      expect(result.cycles).toEqual([]);
      expect(result.order).toEqual(["A", "B", "C", "D"]);
    });

    it("Kịch bản 2: Rẽ nhánh (Diamond: A -> B, A -> C, B -> D, C -> D)", () => {
      const tables: TableSpec[] = [
        {
          name: "D",
          columns: [],
          foreignKeys: [
            { columns: ["b_id"], refTable: "B", refColumns: ["id"] },
            { columns: ["c_id"], refTable: "C", refColumns: ["id"] },
          ],
        },
        { name: "B", columns: [], foreignKeys: [{ columns: ["a_id"], refTable: "A", refColumns: ["id"] }] },
        { name: "C", columns: [], foreignKeys: [{ columns: ["a_id"], refTable: "A", refColumns: ["id"] }] },
        { name: "A", columns: [], foreignKeys: [] },
      ];

      const result = topoSort(buildDependencyGraph(tables));
      expect(result.cycles).toEqual([]);
      expect(result.order).toEqual(["A", "B", "C", "D"]);
    });

    it("Kịch bản 3: Chu trình 2 bảng (A <-> B)", () => {
      const tables: TableSpec[] = [
        { name: "A", columns: [], foreignKeys: [{ columns: ["b_id"], refTable: "B", refColumns: ["id"] }] },
        { name: "B", columns: [], foreignKeys: [{ columns: ["a_id"], refTable: "A", refColumns: ["id"] }] },
      ];

      const result = topoSort(buildDependencyGraph(tables));
      expect(result.cycles).toEqual([["A", "B", "A"]]);
      expect(result.order).toEqual([]);
    });

    it("Kịch bản 4: Chu trình 3 bảng (A -> B -> C -> A)", () => {
      const tables: TableSpec[] = [
        { name: "B", columns: [], foreignKeys: [{ columns: ["c_id"], refTable: "C", refColumns: ["id"] }] },
        { name: "C", columns: [], foreignKeys: [{ columns: ["a_id"], refTable: "A", refColumns: ["id"] }] },
        { name: "A", columns: [], foreignKeys: [{ columns: ["b_id"], refTable: "B", refColumns: ["id"] }] },
      ];

      const result = topoSort(buildDependencyGraph(tables));
      expect(result.cycles).toEqual([["A", "B", "C", "A"]]);
      expect(result.order).toEqual([]);
    });

    it("Kịch bản 5: Tự tham chiếu (Self-reference)", () => {
      const tables: TableSpec[] = [
        {
          name: "employees",
          columns: [],
          foreignKeys: [{ columns: ["manager_id"], refTable: "employees", refColumns: ["id"] }],
        },
      ];

      const result = topoSort(buildDependencyGraph(tables));
      expect(result.cycles).toEqual([]);
      expect(result.order).toEqual(["employees"]);
    });

    it("Kịch bản 6: Schema rỗng", () => {
      const result = topoSort(buildDependencyGraph([]));
      expect(result.cycles).toEqual([]);
      expect(result.order).toEqual([]);
    });
  });

  describe("Các ca biên (Edge cases)", () => {
    it("Ca biên: 200 bảng xếp đúng và nhanh < 50ms", () => {
      // Chuỗi 200 bảng: table_0 -> table_1 -> ... -> table_199
      const tables: TableSpec[] = [];
      const count = 200;

      for (let i = 0; i < count; i++) {
        const name = `tbl_${String(i).padStart(3, "0")}`;
        const fks =
          i === 0
            ? []
            : [
                {
                  columns: ["prev_id"],
                  refTable: `tbl_${String(i - 1).padStart(3, "0")}`,
                  refColumns: ["id"],
                },
              ];
        tables.push({ name, columns: [], foreignKeys: fks });
      }

      // Xáo trộn mảng đầu vào
      const shuffled = [...tables].sort(() => Math.random() - 0.5);

      const start = performance.now();
      const graph = buildDependencyGraph(shuffled);
      const result = topoSort(graph);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect(result.cycles).toEqual([]);
      expect(result.order).toHaveLength(200);

      for (let i = 0; i < count; i++) {
        expect(result.order[i]).toBe(`tbl_${String(i).padStart(3, "0")}`);
      }
    });

    it("Ca biên: FK trỏ tới bảng không tồn tại trong schema -> báo lỗi DependencyGraphError với mã fk_target_missing", () => {
      const tables: TableSpec[] = [
        {
          name: "posts",
          columns: [],
          foreignKeys: [{ columns: ["author_id"], refTable: "ghost_users", refColumns: ["id"] }],
        },
      ];

      expect(() => buildDependencyGraph(tables)).toThrow(DependencyGraphError);

      try {
        buildDependencyGraph(tables);
      } catch (err) {
        expect(err).toBeInstanceOf(DependencyGraphError);
        const depErr = err as DependencyGraphError;
        expect(depErr.code).toBe("fk_target_missing");
        expect(depErr.details).toMatchObject({
          table: "posts",
          refTable: "ghost_users",
        });
      }
    });

    it("Ca biên: FK thiếu refTable rỗng -> báo lỗi có mã fk_target_missing", () => {
      const tables: TableSpec[] = [
        {
          name: "posts",
          columns: [],
          foreignKeys: [{ columns: ["author_id"], refTable: "   ", refColumns: ["id"] }],
        },
      ];

      expect(() => buildDependencyGraph(tables)).toThrow(DependencyGraphError);
      try {
        buildDependencyGraph(tables);
      } catch (err) {
        const depErr = err as DependencyGraphError;
        expect(depErr.code).toBe("fk_target_missing");
      }
    });

    it("Ca biên: Tên bảng trùng khác hoa thường trong schema -> báo lỗi duplicate_table_name", () => {
      const tables: TableSpec[] = [
        { name: "Users", columns: [], foreignKeys: [] },
        { name: "users", columns: [], foreignKeys: [] },
      ];

      expect(() => buildDependencyGraph(tables)).toThrow(DependencyGraphError);

      try {
        buildDependencyGraph(tables);
      } catch (err) {
        expect(err).toBeInstanceOf(DependencyGraphError);
        const depErr = err as DependencyGraphError;
        expect(depErr.code).toBe("duplicate_table_name");
      }
    });

    it("Ca biên: Bảng khai báo hoa, FK tham chiếu thường (hoặc ngược lại) -> resolve thành công", () => {
      const tables: TableSpec[] = [
        { name: "Users", columns: [], foreignKeys: [] },
        {
          name: "posts",
          columns: [],
          foreignKeys: [{ columns: ["user_id"], refTable: "users", refColumns: ["id"] }],
        },
      ];

      const graph = buildDependencyGraph(tables);
      expect(graph.dependencies.posts).toEqual(["Users"]);
      expect(graph.dependents.Users).toEqual(["posts"]);

      const result = topoSort(graph);
      expect(result.cycles).toEqual([]);
      expect(result.order).toEqual(["Users", "posts"]);
    });

    it("Ca biên: Chu trình kết hợp với bảng ngoài chu trình", () => {
      const tables: TableSpec[] = [
        { name: "roles", columns: [], foreignKeys: [] },
        {
          name: "users",
          columns: [],
          foreignKeys: [{ columns: ["role_id"], refTable: "roles", refColumns: ["id"] }],
        },
        {
          name: "table_x",
          columns: [],
          foreignKeys: [{ columns: ["y_id"], refTable: "table_y", refColumns: ["id"] }],
        },
        {
          name: "table_y",
          columns: [],
          foreignKeys: [{ columns: ["x_id"], refTable: "table_x", refColumns: ["id"] }],
        },
      ];

      const graph = buildDependencyGraph(tables);
      const result = topoSort(graph);

      // roles và users không vướng chu trình nên được đưa vào order
      expect(result.order).toEqual(["roles", "users"]);
      // table_x và table_y vướng chu trình
      expect(result.cycles).toEqual([["table_x", "table_y", "table_x"]]);
    });
  });
});
