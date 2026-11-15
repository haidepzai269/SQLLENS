/**
 * Copyright (c) 2026 SQLLens
 * Statement Start Predictor:
 * Gợi ý inline ghost text cho các từ khóa khởi đầu câu lệnh hoặc mệnh đề chính:
 * `CREATE TABLE`, `CREATE INDEX`, `SELECT`, `INSERT INTO`, `ALTER TABLE`, `DROP TABLE`, `UPDATE`, `DELETE`.
 * Giúp người dùng có ngay template hoàn chỉnh bằng phím Tab mà không bị ngắt quãng bởi cảnh báo lỗi cú pháp.
 */

import { TableSchema } from './types';

export interface PredictStatementStartParams {
  textBeforeCursor: string;
  tables?: TableSchema;
}

/**
 * Dự đoán đoạn mã hoàn thiện cho từ khóa khởi đầu câu lệnh.
 */
export function predictStatementStart(params: PredictStatementStartParams): string | null {
  try {
    const { textBeforeCursor, tables } = params;
    if (!textBeforeCursor) return null;

    // Tách các câu lệnh theo dấu chấm phẩy, lấy câu lệnh cuối cùng đang gõ
    const statements = textBeforeCursor.split(';');
    const currentStatement = statements[statements.length - 1] ?? '';
    const trimmed = currentStatement.trim();
    if (!trimmed) return null;

    const hasTrailingSpace = /\s$/.test(currentStatement);
    const prefix = hasTrailingSpace ? '' : ' ';

    // Danh sách bảng có sẵn (nếu có)
    const availableTables = tables ? Object.keys(tables).filter(Boolean) : [];
    const firstTable = availableTables.length > 0 ? availableTables[0] : 'table_name';

    // 1. CREATE TABLE
    if (/^CREATE\s+TABLE$/i.test(trimmed)) {
      return `${prefix}table_name (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL\n);`;
    }

    // 2. CREATE INDEX
    if (/^CREATE\s+INDEX$/i.test(trimmed)) {
      return `${prefix}idx_name ON ${firstTable} (column_name);`;
    }

    // 3. CREATE (tự do)
    if (/^CREATE$/i.test(trimmed)) {
      return `${prefix}TABLE table_name (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL\n);`;
    }

    // 4. SELECT (khởi đầu)
    if (/^SELECT$/i.test(trimmed)) {
      return `${prefix}* FROM ${firstTable};`;
    }

    // 5. INSERT INTO
    if (/^INSERT\s+INTO$/i.test(trimmed)) {
      return `${prefix}${firstTable} VALUES (...);`;
    }

    // 7. INSERT
    if (/^INSERT$/i.test(trimmed)) {
      return `${prefix}INTO ${firstTable} VALUES (...);`;
    }

    // 8. ALTER TABLE
    if (/^ALTER\s+TABLE$/i.test(trimmed)) {
      return `${prefix}${firstTable} ADD COLUMN column_name TEXT;`;
    }

    // 9. ALTER
    if (/^ALTER$/i.test(trimmed)) {
      return `${prefix}TABLE ${firstTable} ADD COLUMN column_name TEXT;`;
    }

    // 10. DROP TABLE
    if (/^DROP\s+TABLE$/i.test(trimmed)) {
      return `${prefix}IF EXISTS ${firstTable};`;
    }

    // 11. DROP
    if (/^DROP$/i.test(trimmed)) {
      return `${prefix}TABLE IF EXISTS ${firstTable};`;
    }

    // 12. UPDATE
    if (/^UPDATE$/i.test(trimmed)) {
      return `${prefix}${firstTable} SET `;
    }

    // 13. DELETE FROM
    if (/^DELETE\s+FROM$/i.test(trimmed)) {
      return `${prefix}${firstTable} WHERE `;
    }

    // 14. DELETE
    if (/^DELETE$/i.test(trimmed)) {
      return `${prefix}FROM ${firstTable} WHERE `;
    }

    return null;
  } catch {
    return null;
  }
}
