/**
 * Copyright (c) 2026 SQLLens
 * INSERT INTO Columns Predictor: Tự động bung danh sách cột và mệnh đề VALUES () của bảng.
 */

import { TableSchema } from './types';

export interface PredictInsertColumnsInput {
  textBeforeCursor: string;
  tables?: TableSchema;
}

const MAX_SUGGESTED_COLUMNS = 25;

/**
 * Tìm kiếm danh sách cột của bảng trong schema (hỗ trợ case-insensitive và schema prefix).
 */
function findTableColumns(rawTableName: string, tables?: TableSchema): string[] | null {
  if (!tables) return null;

  const cleanName = rawTableName.replace(/["`]/g, '').trim();
  const simpleName = cleanName.includes('.') ? cleanName.split('.').pop()! : cleanName;

  // 1. Thử khớp trực tiếp chính xác
  if (tables[cleanName]) return tables[cleanName];
  if (tables[simpleName]) return tables[simpleName];

  // 2. Thử khớp không phân biệt hoa thường (case-insensitive)
  const targetLower = simpleName.toLowerCase();
  for (const [tName, cols] of Object.entries(tables)) {
    const curSimple = tName.includes('.') ? tName.split('.').pop()! : tName;
    if (curSimple.toLowerCase() === targetLower) {
      return cols;
    }
  }

  return null;
}

/**
 * Dự đoán danh sách cột khi người dùng gõ `INSERT INTO <table> `.
 * Gợi ý: `(col1, col2, col3) VALUES ()`
 */
export function predictInsertColumns(input: {
  textBeforeCursor: string;
  tables?: TableSchema;
}): string | null {
  try {
    const { textBeforeCursor, tables } = input;
    if (!textBeforeCursor || !tables) return null;

    // Pattern nhận diện: INSERT INTO <table_name> [spaces]
    // Chặn trường hợp người dùng đã gõ dấu mở ngoặc '(' hoặc các từ khóa tiếp theo
    const insertRegex = /\bINSERT\s+INTO\s+([a-zA-Z0-9_".`]+)(\s*)$/i;
    const match = insertRegex.exec(textBeforeCursor);
    if (!match) return null;

    const rawTableName = match[1];
    const trailingSpaces = match[2] ?? '';

    // Tìm danh sách cột trong schema
    const columns = findTableColumns(rawTableName, tables);
    if (!columns || columns.length === 0) {
      return null;
    }

    // Xử lý ca biên: Bảng có nhiều cột (> 25), giới hạn hợp lý để không làm tràn ghost text
    const displayColumns = columns.length > MAX_SUGGESTED_COLUMNS
      ? columns.slice(0, MAX_SUGGESTED_COLUMNS)
      : columns;

    const columnListStr = displayColumns.join(', ');
    const prefix = trailingSpaces.length === 0 ? ' ' : '';

    return `${prefix}(${columnListStr}) VALUES ()`;
  } catch {
    return null;
  }
}
