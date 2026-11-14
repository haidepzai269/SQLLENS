/**
 * Copyright (c) 2026 SQLLens
 * Comprehensive Unit Tests for Client-side SQL Heuristic Matcher.
 */

import { describe, it, expect } from 'vitest';
import {
  predictNextSqlSnippet,
  predictFkJoin,
  predictGroupBy,
  predictInsertColumns,
  predictLifecycleNextClause,
  ForeignKeyRelation,
  TableSchema,
} from './sql-heuristics';

describe('SQL Heuristics Engine', () => {
  const sampleSchema: TableSchema = {
    users: ['id', 'name', 'email', 'role', 'department', 'created_at'],
    orders: ['id', 'user_id', 'total_amount', 'status', 'created_at'],
    order_items: ['id', 'order_id', 'product_id', 'quantity', 'unit_price'],
    products: ['id', 'category_id', 'name', 'price', 'stock'],
    categories: ['id', 'title', 'description'],
  };

  const sampleForeignKeys: ForeignKeyRelation[] = [
    { fromTable: 'orders', fromColumn: 'user_id', toTable: 'users', toColumn: 'id' },
    { fromTable: 'order_items', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id' },
    { fromTable: 'order_items', fromColumn: 'product_id', toTable: 'products', toColumn: 'id' },
    { fromTable: 'products', fromColumn: 'category_id', toTable: 'categories', toColumn: 'id' },
  ];

  // =========================================================================
  // AC1: Dự đoán JOIN ... ON ... qua Foreign Key Graph
  // =========================================================================
  describe('AC1: predictFkJoin', () => {
    it('gợi ý JOIN bảng con có khóa ngoại khi có alias (FROM users u JOIN )', () => {
      const sql = 'SELECT * FROM users u JOIN ';
      const suggestion = predictFkJoin({
        textBeforeCursor: sql,
        tables: sampleSchema,
        foreignKeys: sampleForeignKeys,
      });

      expect(suggestion).toBe('orders o ON o.user_id = u.id');
    });

    it('gợi ý JOIN bảng con khi không có alias (FROM users JOIN )', () => {
      const sql = 'SELECT * FROM users JOIN ';
      const suggestion = predictFkJoin({
        textBeforeCursor: sql,
        tables: sampleSchema,
        foreignKeys: sampleForeignKeys,
      });

      expect(suggestion).toBe('orders ON orders.user_id = users.id');
    });

    it('hoạt động với các biến thể JOIN (LEFT JOIN, INNER JOIN, RIGHT JOIN)', () => {
      const sqlLeft = 'SELECT * FROM users u LEFT JOIN ';
      expect(
        predictFkJoin({
          textBeforeCursor: sqlLeft,
          tables: sampleSchema,
          foreignKeys: sampleForeignKeys,
        })
      ).toBe('orders o ON o.user_id = u.id');

      const sqlInner = 'SELECT * FROM users u INNER JOIN ';
      expect(
        predictFkJoin({
          textBeforeCursor: sqlInner,
          tables: sampleSchema,
          foreignKeys: sampleForeignKeys,
        })
      ).toBe('orders o ON o.user_id = u.id');
    });

    it('tự động thêm khoảng trắng ở đầu nếu người dùng chưa gõ space sau JOIN', () => {
      const sqlNoSpace = 'SELECT * FROM users u JOIN';
      const suggestion = predictFkJoin({
        textBeforeCursor: sqlNoSpace,
        tables: sampleSchema,
        foreignKeys: sampleForeignKeys,
      });

      expect(suggestion).toBe(' orders o ON o.user_id = u.id');
    });

    it('hỗ trợ chiều ngược lại: từ bảng con JOIN sang bảng cha (FROM orders o JOIN )', () => {
      const sql = 'SELECT * FROM orders o JOIN ';
      const suggestion = predictFkJoin({
        textBeforeCursor: sql,
        tables: sampleSchema,
        foreignKeys: sampleForeignKeys,
      });

      // orders liên kết với users (toTable) hoặc order_items (fromTable)
      // Bảng users là bảng cha trỏ tới id = user_id
      expect(suggestion).toBe('users u ON u.id = o.user_id');
    });

    it('gợi ý đúng bảng tiếp theo khi đã JOIN nhiều bảng trước đó', () => {
      const sql =
        'SELECT * FROM categories c JOIN products p ON p.category_id = c.id JOIN ';
      const suggestion = predictFkJoin({
        textBeforeCursor: sql,
        tables: sampleSchema,
        foreignKeys: sampleForeignKeys,
      });

      // Bảng liên kết gần nhất với products là order_items
      expect(suggestion).toBe('order_items oi ON oi.product_id = p.id');
    });

    it('trả về null nếu không có quan hệ khóa ngoại hoặc danh sách FK rỗng', () => {
      const sql = 'SELECT * FROM users u JOIN ';
      expect(
        predictFkJoin({
          textBeforeCursor: sql,
          tables: sampleSchema,
          foreignKeys: [],
        })
      ).toBeNull();
    });

    it('hỗ trợ cú pháp MySQL với backticks', () => {
      const sql = 'SELECT * FROM `users` `u` JOIN ';
      const suggestion = predictFkJoin({
        textBeforeCursor: sql,
        tables: sampleSchema,
        foreignKeys: sampleForeignKeys,
      });

      expect(suggestion).toBe('orders o ON o.user_id = u.id');
    });
  });

  // =========================================================================
  // AC2: Dự đoán GROUP BY tự động từ mệnh đề SELECT
  // =========================================================================
  describe('AC2: predictGroupBy', () => {
    it('bóc tách chính xác các cột trần không nằm trong hàm aggregate', () => {
      const sql =
        'SELECT u.department, u.role, COUNT(*), SUM(salary) FROM users u GROUP BY ';
      const suggestion = predictGroupBy({ textBeforeCursor: sql });

      expect(suggestion).toBe('u.department, u.role');
    });

    it('bóc tách các cột đơn giản và loại bỏ alias AS', () => {
      const sql =
        'SELECT department AS dept, role, COUNT(id) AS total_count FROM employees GROUP BY ';
      const suggestion = predictGroupBy({ textBeforeCursor: sql });

      expect(suggestion).toBe('department, role');
    });

    it('bỏ qua hàm aggregate AVG, MIN, MAX', () => {
      const sql =
        'SELECT category, status, AVG(price), MIN(created_at), MAX(updated_at) FROM products WHERE active = 1 GROUP BY ';
      const suggestion = predictGroupBy({ textBeforeCursor: sql });

      expect(suggestion).toBe('category, status');
    });

    it('hỗ trợ hàm non-aggregate có dấu phẩy bên trong ngoặc (như COALESCE)', () => {
      const sql =
        "SELECT COALESCE(u.name, 'Unknown'), u.department, COUNT(o.id) FROM users u GROUP BY ";
      const suggestion = predictGroupBy({ textBeforeCursor: sql });

      expect(suggestion).toBe("COALESCE(u.name, 'Unknown'), u.department");
    });

    it('thêm khoảng trắng ở đầu nếu chưa có space sau GROUP BY', () => {
      const sql = 'SELECT dept, count(*) FROM users GROUP BY';
      const suggestion = predictGroupBy({ textBeforeCursor: sql });

      expect(suggestion).toBe(' dept');
    });

    it('ca biên: trả về null nếu SELECT chỉ toàn hàm aggregate', () => {
      const sql = 'SELECT COUNT(*), SUM(total_amount), AVG(price) FROM orders GROUP BY ';
      const suggestion = predictGroupBy({ textBeforeCursor: sql });

      expect(suggestion).toBeNull();
    });

    it('ca biên: trả về null nếu câu truy vấn không có mệnh đề SELECT/FROM hợp lệ', () => {
      const sql = 'GROUP BY ';
      expect(predictGroupBy({ textBeforeCursor: sql })).toBeNull();
    });
  });

  // =========================================================================
  // AC3: Dự đoán danh sách cột khi INSERT INTO
  // =========================================================================
  describe('AC3: predictInsertColumns', () => {
    it('gợi ý đầy đủ danh sách cột của bảng kèm VALUES ()', () => {
      const sql = 'INSERT INTO users ';
      const suggestion = predictInsertColumns({
        textBeforeCursor: sql,
        tables: sampleSchema,
      });

      expect(suggestion).toBe(
        '(id, name, email, role, department, created_at) VALUES ()'
      );
    });

    it('tự động thêm khoảng trắng ở đầu nếu chưa có space sau tên bảng', () => {
      const sql = 'INSERT INTO orders';
      const suggestion = predictInsertColumns({
        textBeforeCursor: sql,
        tables: sampleSchema,
      });

      expect(suggestion).toBe(
        ' (id, user_id, total_amount, status, created_at) VALUES ()'
      );
    });

    it('hỗ trợ schema prefix (public.users) và case-insensitive (USERS)', () => {
      const sqlPublic = 'INSERT INTO public.users ';
      expect(
        predictInsertColumns({
          textBeforeCursor: sqlPublic,
          tables: sampleSchema,
        })
      ).toBe('(id, name, email, role, department, created_at) VALUES ()');

      const sqlUpper = 'INSERT INTO USERS ';
      expect(
        predictInsertColumns({
          textBeforeCursor: sqlUpper,
          tables: sampleSchema,
        })
      ).toBe('(id, name, email, role, department, created_at) VALUES ()');
    });

    it('ca biên: bảng có 50 cột thì giới hạn hợp lý tối đa 25 cột', () => {
      const manyColumns = Array.from({ length: 50 }, (_, i) => `col_${i + 1}`);
      const hugeSchema: TableSchema = {
        big_table: manyColumns,
      };

      const sql = 'INSERT INTO big_table ';
      const suggestion = predictInsertColumns({
        textBeforeCursor: sql,
        tables: hugeSchema,
      });

      expect(suggestion).not.toBeNull();
      // Đảm bảo không vượt quá 25 cột
      const insideParens = suggestion!.match(/\((.*?)\)/)?.[1] || '';
      const cols = insideParens.split(', ');
      expect(cols.length).toBe(25);
      expect(suggestion).toContain('VALUES ()');
    });

    it('không gợi ý nếu người dùng đã tự mở ngoặc (', () => {
      const sql = 'INSERT INTO users (';
      expect(
        predictInsertColumns({
          textBeforeCursor: sql,
          tables: sampleSchema,
        })
      ).toBeNull();
    });

    it('trả về null nếu bảng không tồn tại trong schema', () => {
      const sql = 'INSERT INTO non_existent_table ';
      expect(
        predictInsertColumns({
          textBeforeCursor: sql,
          tables: sampleSchema,
        })
      ).toBeNull();
    });
  });

  // =========================================================================
  // AC4: Dự đoán Lifecycle Next Clause
  // =========================================================================
  describe('AC4: predictLifecycleNextClause', () => {
    it('gợi ý WHERE sau khi hoàn thành FROM <table>', () => {
      const sqlWithSpace = 'SELECT * FROM users ';
      expect(predictLifecycleNextClause(sqlWithSpace, sampleSchema)).toBe('WHERE ');

      const sqlNoSpace = 'SELECT * FROM users';
      expect(predictLifecycleNextClause(sqlNoSpace, sampleSchema)).toBe(' WHERE ');
    });

    it('gợi ý WHERE sau khi hoàn thành FROM <table> <alias>', () => {
      const sql = 'SELECT id, name FROM users u ';
      expect(predictLifecycleNextClause(sql, sampleSchema)).toBe('WHERE ');
    });
  });

  // =========================================================================
  // AC5: Facade predictNextSqlSnippet & Hiệu năng, Độ an toàn
  // =========================================================================
  describe('AC5: predictNextSqlSnippet & Resilience', () => {
    it('điều phối ưu tiên: FK JOIN > GROUP BY > INSERT > Lifecycle', () => {
      // 1. FK Join
      expect(
        predictNextSqlSnippet({
          docText: 'SELECT * FROM users u JOIN ',
          cursorOffset: 27,
          tables: sampleSchema,
          foreignKeys: sampleForeignKeys,
        })
      ).toBe('orders o ON o.user_id = u.id');

      // 2. Group By
      expect(
        predictNextSqlSnippet({
          docText: 'SELECT role, count(*) FROM users GROUP BY ',
          cursorOffset: 42,
          tables: sampleSchema,
        })
      ).toBe('role');

      // 3. Insert Columns
      expect(
        predictNextSqlSnippet({
          docText: 'INSERT INTO products ',
          cursorOffset: 21,
          tables: sampleSchema,
        })
      ).toBe('(id, category_id, name, price, stock) VALUES ()');

      // 4. Lifecycle
      expect(
        predictNextSqlSnippet({
          docText: 'SELECT * FROM products ',
          cursorOffset: 23,
          tables: sampleSchema,
        })
      ).toBe('WHERE ');
    });

    it('không bao giờ văng ngoại lệ với bất kỳ SQL gõ dở hay đầu vào dị thường nào', () => {
      const edgeCases = [
        '',
        '   ',
        ';;;;;',
        'SELECT * FROM (((',
        'JOIN JOIN JOIN',
        'INSERT INTO ???',
        'GROUP BY ()()',
        "SELECT 'unclosed string FROM users",
        'DROP DATABASE &&&',
      ];

      for (const text of edgeCases) {
        expect(() => {
          predictNextSqlSnippet({
            docText: text,
            cursorOffset: text.length,
            tables: sampleSchema,
            foreignKeys: sampleForeignKeys,
          });
        }).not.toThrow();
      }

      // Cursor offset ngoài biên
      expect(() => {
        predictNextSqlSnippet({
          docText: 'SELECT 1',
          cursorOffset: -50,
        });
      }).not.toThrow();

      expect(() => {
        predictNextSqlSnippet({
          docText: 'SELECT 1',
          cursorOffset: 999999,
        });
      }).not.toThrow();
    });

    it('hiệu năng < 1ms: xử lý 1000 lượt phân tích trong thời gian siêu tốc', () => {
      const sampleQuery = 'SELECT u.department, u.role, COUNT(*) FROM users u JOIN ';
      const start = performance.now();

      const iterations = 1000;
      for (let i = 0; i < iterations; i++) {
        predictNextSqlSnippet({
          docText: sampleQuery,
          cursorOffset: sampleQuery.length,
          tables: sampleSchema,
          foreignKeys: sampleForeignKeys,
        });
      }

      const end = performance.now();
      const avgMs = (end - start) / iterations;

      // Kỳ vọng trung bình < 0.1ms (dưới xa giới hạn 1ms)
      expect(avgMs).toBeLessThan(1.0);
    });
  });
});
