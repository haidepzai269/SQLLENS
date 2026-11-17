import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { serializeSchema } from "./sql-serializer";
import type { TableSpec } from "./types";

describe("sql-serializer", { timeout: 20000 }, () => {
  const fixedNow = new Date("2026-11-17T07:00:00.000Z");

  // Bộ 5 bảng có khóa ngoại theo kịch bản chuẩn
  const fiveTables: TableSpec[] = [
    {
      name: "comments",
      columns: [
        { name: "id", type: "integer", primaryKey: true },
        { name: "post_id", type: "integer", nullable: false },
        { name: "author_id", type: "integer", nullable: false },
        { name: "content", type: "text", nullable: false },
      ],
      foreignKeys: [
        { columns: ["post_id"], refTable: "posts", refColumns: ["id"], onDelete: "CASCADE" },
        { columns: ["author_id"], refTable: "users", refColumns: ["id"] },
      ],
    },
    {
      name: "orders",
      columns: [
        { name: "id", type: "integer", primaryKey: true },
        { name: "user_id", type: "integer", nullable: false },
        { name: "total", type: "numeric(10, 2)", defaultValue: "0.00" },
      ],
      foreignKeys: [
        { columns: ["user_id"], refTable: "users", refColumns: ["id"] },
      ],
    },
    {
      name: "users",
      columns: [
        { name: "id", type: "integer", primaryKey: true, isIdentity: true },
        { name: "username", type: "varchar(50)", nullable: false, unique: true },
        { name: "status", type: "varchar(20)", defaultValue: "'active'" },
      ],
      foreignKeys: [],
    },
    {
      name: "posts",
      columns: [
        { name: "id", type: "integer", primaryKey: true },
        { name: "user_id", type: "integer", nullable: false },
        { name: "category_id", type: "integer", nullable: false },
        { name: "title", type: "varchar(200)", nullable: false },
      ],
      foreignKeys: [
        { columns: ["user_id"], refTable: "users", refColumns: ["id"] },
        { columns: ["category_id"], refTable: "categories", refColumns: ["id"] },
      ],
    },
    {
      name: "categories",
      columns: [
        { name: "id", type: "integer", primaryKey: true },
        { name: "name", type: "varchar(100)", nullable: false },
      ],
      foreignKeys: [],
    },
  ];

  it("AC1: Với Postgres, file sinh ra chạy được trong PGlite mới, không lỗi FK", async () => {
    const sql = serializeSchema({
      tables: fiveTables,
      engine: "postgres",
      projectName: "Shop System",
      now: fixedNow,
    });

    // File phải chứa đúng thứ tự tạo bảng cha trước bảng con
    const posCat = sql.indexOf('CREATE TABLE "categories"');
    const posUsers = sql.indexOf('CREATE TABLE "users"');
    const posPosts = sql.indexOf('CREATE TABLE "posts"');
    const posOrders = sql.indexOf('CREATE TABLE "orders"');
    const posComments = sql.indexOf('CREATE TABLE "comments"');

    expect(posCat).toBeGreaterThan(-1);
    expect(posUsers).toBeGreaterThan(-1);
    expect(posPosts).toBeGreaterThan(-1);
    expect(posOrders).toBeGreaterThan(-1);
    expect(posComments).toBeGreaterThan(-1);

    expect(posCat).toBeLessThan(posPosts);
    expect(posUsers).toBeLessThan(posPosts);
    expect(posUsers).toBeLessThan(posOrders);
    expect(posPosts).toBeLessThan(posComments);

    // Chạy file thật trên PGlite mới
    const pg = new PGlite();
    await expect(pg.exec(sql)).resolves.not.toThrow();

    // Xác nhận các bảng tồn tại thật trong catalog
    const res = await pg.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;",
    );
    const tableNames = res.rows.map((r) => r.tablename);
    expect(tableNames).toContain("categories");
    expect(tableNames).toContain("comments");
    expect(tableNames).toContain("orders");
    expect(tableNames).toContain("posts");
    expect(tableNames).toContain("users");

    // Thử insert để kiểm tra ràng buộc FK hoạt động thật
    await pg.exec(`
      INSERT INTO "categories" ("id", "name") VALUES (1, 'Tech');
      INSERT INTO "users" ("id", "username") VALUES (10, 'alice');
      INSERT INTO "posts" ("id", "user_id", "category_id", "title") VALUES (100, 10, 1, 'Hello World');
    `);

    // Insert vi phạm FK phải bắn lỗi
    await expect(
      pg.exec(`INSERT INTO "posts" ("id", "user_id", "category_id", "title") VALUES (101, 999, 1, 'Ghost');`),
    ).rejects.toThrow();
  });

  it("AC2: Vòng A↔B cho ra file chạy được trên PGlite, FK của vòng nằm ở khối ALTER TABLE cuối file", async () => {
    const cycleTables: TableSpec[] = [
      {
        name: "A",
        columns: [
          { name: "id", type: "integer", primaryKey: true },
          { name: "b_id", type: "integer", nullable: true },
        ],
        foreignKeys: [{ columns: ["b_id"], refTable: "B", refColumns: ["id"] }],
      },
      {
        name: "B",
        columns: [
          { name: "id", type: "integer", primaryKey: true },
          { name: "a_id", type: "integer", nullable: true },
        ],
        foreignKeys: [{ columns: ["a_id"], refTable: "A", refColumns: ["id"] }],
      },
    ];

    const sql = serializeSchema({
      tables: cycleTables,
      engine: "postgres",
      projectName: "Cycle Project",
      now: fixedNow,
    });

    // 1. Kiểm tra vị trí khối ALTER TABLE
    expect(sql).toContain("-- Foreign Key Constraints (Cycle Resolution)");
    const alterSectionPos = sql.indexOf("-- Foreign Key Constraints (Cycle Resolution)");
    const createAPos = sql.indexOf('CREATE TABLE "A"');
    const createBPos = sql.indexOf('CREATE TABLE "B"');

    expect(createAPos).toBeLessThan(alterSectionPos);
    expect(createBPos).toBeLessThan(alterSectionPos);

    // Trong CREATE TABLE "A" và "B" không được chứa inline CONSTRAINT FOREIGN KEY
    const createABlock = sql.slice(createAPos, createBPos > createAPos ? createBPos : alterSectionPos);
    expect(createABlock).not.toContain("FOREIGN KEY");

    // Khối ALTER TABLE phải chứa cả 2 câu ALTER TABLE ADD CONSTRAINT
    const alterBlock = sql.slice(alterSectionPos);
    expect(alterBlock).toContain('ALTER TABLE "A" ADD CONSTRAINT');
    expect(alterBlock).toContain('ALTER TABLE "B" ADD CONSTRAINT');

    // 2. Chạy file thật trên PGlite mới
    const pg = new PGlite();
    await expect(pg.exec(sql)).resolves.not.toThrow();

    // 3. Ràng buộc FK hoạt động thật sau ALTER TABLE
    await pg.exec(`
      INSERT INTO "A" ("id", "b_id") VALUES (1, NULL);
      INSERT INTO "B" ("id", "a_id") VALUES (2, 1);
      UPDATE "A" SET "b_id" = 2 WHERE "id" = 1;
    `);

    // Vi phạm FK phải bị chặn
    await expect(
      pg.exec(`INSERT INTO "A" ("id", "b_id") VALUES (3, 999);`),
    ).rejects.toThrow();
  });

  it("AC3: Quote định danh đúng dialect (Postgres \"; MySQL/SQLite `) và escape ký tự bên trong", () => {
    const specialTable: TableSpec = {
      name: `my "table"`,
      columns: [
        { name: `col "one"`, type: "varchar(50)", primaryKey: true },
        { name: "full name", type: "varchar(100)" },
      ],
      foreignKeys: [],
    };

    // Postgres: dấu ngoặc kép ""
    const pgSql = serializeSchema({
      tables: [specialTable],
      engine: "postgres",
      projectName: "Test Quotes",
      now: fixedNow,
    });
    expect(pgSql).toContain('CREATE TABLE "my ""table"""');
    expect(pgSql).toContain('"col ""one""" varchar(50) NOT NULL');
    expect(pgSql).toContain('"full name" varchar(100)');
    expect(pgSql).toContain('PRIMARY KEY ("col ""one""")');

    // MySQL: dấu backtick ``
    const mysqlTable: TableSpec = {
      name: "order `details`",
      columns: [
        { name: "item `id`", type: "int", primaryKey: true },
        { name: "user name", type: "varchar(50)" },
      ],
      foreignKeys: [],
    };

    const mySql = serializeSchema({
      tables: [mysqlTable],
      engine: "mysql",
      projectName: "Test MySQL",
      now: fixedNow,
    });
    expect(mySql).toContain("CREATE TABLE `order ``details```");
    expect(mySql).toContain("`item ``id``` int NOT NULL");
    expect(mySql).toContain("`user name` varchar(50)");
    expect(mySql).toContain("PRIMARY KEY (`item ``id```)");

    // SQLite: dấu backtick ``
    const sqliteSql = serializeSchema({
      tables: [mysqlTable],
      engine: "sqlite",
      projectName: "Test SQLite",
      now: fixedNow,
    });
    expect(sqliteSql).toContain("CREATE TABLE `order ``details```");
    expect(sqliteSql).toContain("`item ``id``` int NOT NULL");
  });

  it("AC4: Cùng đầu vào và cùng now cho ra cùng chuỗi 100% (tất định)", () => {
    const input = {
      tables: fiveTables,
      engine: "postgres" as const,
      projectName: "Determinism Test",
      now: fixedNow,
    };

    const firstOutput = serializeSchema(input);

    for (let i = 0; i < 10; i++) {
      // Đảo thứ tự bảng trong mảng đầu vào để kiểm tra tính độc lập thứ tự
      const shuffledTables = [...fiveTables].sort(() => Math.random() - 0.5);
      const currentOutput = serializeSchema({
        ...input,
        tables: shuffledTables,
      });
      expect(currentOutput).toBe(firstOutput);
    }
  });

  it("AC5: Header có đủ engine, dự án, thời điểm và thứ tự các bảng", () => {
    const sql = serializeSchema({
      tables: fiveTables,
      engine: "postgres",
      projectName: "Analytics Hub",
      now: fixedNow,
    });

    expect(sql).toContain("-- Engine: PostgreSQL (postgres)");
    expect(sql).toContain("-- Exported: 2026-11-17T07:00:00.000Z");
    expect(sql).toContain("-- Project: Analytics Hub");
    expect(sql).toContain("-- Dependency Order: [categories, users, orders, posts, comments]");
  });

  describe("AC6: Đầy đủ 4 kịch bản bắt buộc", () => {
    it("Kịch bản 1: 5 bảng có FK", () => {
      const sql = serializeSchema({
        tables: fiveTables,
        engine: "postgres",
        projectName: "5 Tables",
        now: fixedNow,
      });

      expect(sql).toContain('CREATE TABLE "categories"');
      expect(sql).toContain('CREATE TABLE "users"');
      expect(sql).toContain('CREATE TABLE "orders"');
      expect(sql).toContain('CREATE TABLE "posts"');
      expect(sql).toContain('CREATE TABLE "comments"');
      expect(sql).not.toContain("-- Foreign Key Constraints (Cycle Resolution)");
    });

    it("Kịch bản 2: Vòng FK (Chu trình 3 bảng A -> B -> C -> A)", async () => {
      const triangleCycles: TableSpec[] = [
        {
          name: "table_c",
          columns: [{ name: "id", type: "integer", primaryKey: true }, { name: "a_id", type: "integer" }],
          foreignKeys: [{ columns: ["a_id"], refTable: "table_a", refColumns: ["id"] }],
        },
        {
          name: "table_b",
          columns: [{ name: "id", type: "integer", primaryKey: true }, { name: "c_id", type: "integer" }],
          foreignKeys: [{ columns: ["c_id"], refTable: "table_c", refColumns: ["id"] }],
        },
        {
          name: "table_a",
          columns: [{ name: "id", type: "integer", primaryKey: true }, { name: "b_id", type: "integer" }],
          foreignKeys: [{ columns: ["b_id"], refTable: "table_b", refColumns: ["id"] }],
        },
      ];

      const sql = serializeSchema({
        tables: triangleCycles,
        engine: "postgres",
        projectName: "Triangle Cycle",
        now: fixedNow,
      });

      expect(sql).toContain("-- Foreign Key Constraints (Cycle Resolution)");
      expect(sql).toContain('ALTER TABLE "table_a" ADD CONSTRAINT');
      expect(sql).toContain('ALTER TABLE "table_b" ADD CONSTRAINT');
      expect(sql).toContain('ALTER TABLE "table_c" ADD CONSTRAINT');

      const pg = new PGlite();
      await expect(pg.exec(sql)).resolves.not.toThrow();
    });

    it("Kịch bản 3: Bảng tự tham chiếu (Self-reference)", async () => {
      const treeTable: TableSpec[] = [
        {
          name: "nodes",
          columns: [
            { name: "id", type: "integer", primaryKey: true },
            { name: "parent_id", type: "integer", nullable: true },
            { name: "title", type: "varchar(100)", nullable: false },
          ],
          foreignKeys: [
            { columns: ["parent_id"], refTable: "nodes", refColumns: ["id"] },
          ],
        },
      ];

      const sql = serializeSchema({
        tables: treeTable,
        engine: "postgres",
        projectName: "Tree Node",
        now: fixedNow,
      });

      // Tự tham chiếu không bị coi là chu trình, FK nằm inline
      expect(sql).not.toContain("-- Foreign Key Constraints (Cycle Resolution)");
      expect(sql).toContain('CONSTRAINT "fk_nodes_parent_id" FOREIGN KEY ("parent_id") REFERENCES "nodes" ("id")');

      const pg = new PGlite();
      await expect(pg.exec(sql)).resolves.not.toThrow();
    });

    it("Kịch bản 4: Schema rỗng (Empty tables)", () => {
      const sql = serializeSchema({
        tables: [],
        engine: "postgres",
        projectName: "Empty Project",
        now: fixedNow,
      });

      expect(sql).toContain("-- Project: Empty Project");
      expect(sql).toContain("-- Dependency Order: []");
      expect(sql).not.toContain("CREATE TABLE");
    });
  });

  describe("Các ca biên (Edge cases)", () => {
    it("Ca biên: DEFAULT chuỗi có nháy đơn bên trong ('O''Reilly' hoặc 'active')", async () => {
      const tableWithDefault: TableSpec = {
        name: "configs",
        columns: [
          { name: "id", type: "integer", primaryKey: true },
          { name: "status", type: "varchar(50)", defaultValue: "'active'" },
          { name: "author", type: "varchar(100)", defaultValue: "'O''Reilly'" },
          { name: "count", type: "integer", defaultValue: "0" },
        ],
        foreignKeys: [],
      };

      const sql = serializeSchema({
        tables: [tableWithDefault],
        engine: "postgres",
        projectName: "Default Quotes",
        now: fixedNow,
      });

      expect(sql).toContain("DEFAULT 'active'");
      expect(sql).toContain("DEFAULT 'O''Reilly'");
      expect(sql).toContain("DEFAULT 0");

      const pg = new PGlite();
      await expect(pg.exec(sql)).resolves.not.toThrow();

      await pg.exec(`INSERT INTO "configs" ("id") VALUES (1);`);
      const row = await pg.query<{ status: string; author: string; count: number }>(
        `SELECT "status", "author", "count" FROM "configs" WHERE "id" = 1;`,
      );
      expect(row.rows[0].status).toBe("active");
      expect(row.rows[0].author).toBe("O'Reilly");
      expect(row.rows[0].count).toBe(0);
    });

    it("Ca biên: Kiểu dữ liệu riêng của MySQL không bị chuyển đổi sang Postgres", () => {
      const mysqlSpecificTable: TableSpec = {
        name: "events",
        columns: [
          { name: "id", type: "int", primaryKey: true, isIdentity: true },
          { name: "event_time", type: "DATETIME" },
          { name: "is_active", type: "TINYINT(1)", defaultValue: "1" },
          { name: "description", type: "MEDIUMTEXT" },
        ],
        foreignKeys: [],
        comment: "Bảng lưu sự kiện",
      };

      const sql = serializeSchema({
        tables: [mysqlSpecificTable],
        engine: "mysql",
        projectName: "MySQL Types",
        now: fixedNow,
      });

      expect(sql).toContain("`event_time` DATETIME");
      expect(sql).toContain("`is_active` TINYINT(1) DEFAULT 1");
      expect(sql).toContain("`description` MEDIUMTEXT");
      expect(sql).toContain("`id` int NOT NULL AUTO_INCREMENT");
      expect(sql).toContain("COMMENT = 'Bảng lưu sự kiện'");
    });

    it("Ca biên: Primary Key phức hợp (nhiều cột)", async () => {
      const compositePkTable: TableSpec = {
        name: "order_items",
        columns: [
          { name: "order_id", type: "integer", primaryKey: true },
          { name: "item_id", type: "integer", primaryKey: true },
          { name: "quantity", type: "integer", defaultValue: "1" },
        ],
        foreignKeys: [],
      };

      const sql = serializeSchema({
        tables: [compositePkTable],
        engine: "postgres",
        projectName: "Composite PK",
        now: fixedNow,
      });

      expect(sql).toContain('PRIMARY KEY ("order_id", "item_id")');

      const pg = new PGlite();
      await expect(pg.exec(sql)).resolves.not.toThrow();
    });

    it("Ca biên: SQLite không hỗ trợ ALTER TABLE ADD CONSTRAINT, vòng FK vẫn giữ inline và không ném lỗi", () => {
      const cycleTables: TableSpec[] = [
        {
          name: "A",
          columns: [{ name: "id", type: "integer", primaryKey: true }, { name: "b_id", type: "integer" }],
          foreignKeys: [{ columns: ["b_id"], refTable: "B", refColumns: ["id"] }],
        },
        {
          name: "B",
          columns: [{ name: "id", type: "integer", primaryKey: true }, { name: "a_id", type: "integer" }],
          foreignKeys: [{ columns: ["a_id"], refTable: "A", refColumns: ["id"] }],
        },
      ];

      const sql = serializeSchema({
        tables: cycleTables,
        engine: "sqlite",
        projectName: "SQLite Cycles",
        now: fixedNow,
      });

      // SQLite không được sinh khối ALTER TABLE
      expect(sql).not.toContain("ALTER TABLE");
      expect(sql).not.toContain("-- Foreign Key Constraints (Cycle Resolution)");

      // Bảng A và B đều được tạo
      expect(sql).toContain("CREATE TABLE `A`");
      expect(sql).toContain("CREATE TABLE `B`");
      expect(sql).toContain("Dependency Order: [A, B]");

      // FK được khai báo inline trong CREATE TABLE
      expect(sql).toContain("CONSTRAINT `fk_A_b_id` FOREIGN KEY (`b_id`) REFERENCES `B` (`id`)");
      expect(sql).toContain("CONSTRAINT `fk_B_a_id` FOREIGN KEY (`a_id`) REFERENCES `A` (`id`)");
    });
  });
});
