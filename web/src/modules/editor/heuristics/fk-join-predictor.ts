/**
 * Copyright (c) 2026 SQLLens
 * Foreign Key JOIN Predictor: Tự động suy luận mệnh đề `JOIN ... ON ...` qua đồ thị khóa ngoại.
 */

import { ForeignKeyRelation, TableSchema } from './types';

const SQL_KEYWORDS = new Set([
  'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'FULL', 'CROSS', 'ON',
  'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'SELECT', 'FROM', 'AS', 'NATURAL',
  'LATERAL', 'USING', 'SET', 'VALUES', 'AND', 'OR', 'UNION', 'EXCEPT'
]);

export interface PredictFkJoinInput {
  textBeforeCursor: string;
  tables?: TableSchema;
  foreignKeys?: ForeignKeyRelation[];
}

interface TableOccurrence {
  name: string;
  alias: string;
  hasExplicitAlias: boolean;
}

/**
 * Sinh alias ngắn gọn, thông minh từ tên bảng:
 * users -> u
 * order_items -> oi
 * user_profiles -> up
 * Nếu trùng lặp trong usedAliases, tăng số hậu tố (u2, oi2...)
 */
export function generateAlias(tableName: string, usedAliases: Set<string>): string {
  const clean = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const parts = clean.split('_').filter(Boolean);
  
  let candidate = '';
  if (parts.length > 1) {
    candidate = parts.map((p) => p[0]?.toLowerCase() || '').join('');
  } else if (clean.length > 0) {
    candidate = clean[0].toLowerCase();
  } else {
    candidate = 't';
  }

  if (!usedAliases.has(candidate)) {
    return candidate;
  }

  // Thử các độ dài khác nhau của tên bảng
  for (let i = 2; i <= clean.length; i++) {
    const sub = clean.slice(0, i).toLowerCase();
    if (!usedAliases.has(sub)) return sub;
  }

  // Nếu vẫn trùng, thêm số đếm
  let counter = 2;
  while (usedAliases.has(`${candidate}${counter}`)) {
    counter++;
  }
  return `${candidate}${counter}`;
}

/**
 * Trích xuất danh sách các bảng và alias đã xuất hiện trong mệnh đề FROM / JOIN
 * của câu truy vấn hiện tại (trước từ khóa JOIN cuối cùng).
 */
function extractExistingTables(text: string): TableOccurrence[] {
  const tables: TableOccurrence[] = [];

  // Tìm vị trí FROM cuối cùng để giới hạn phạm vi câu lệnh hiện tại
  const fromMatches = Array.from(text.matchAll(/\bFROM\b/gi));
  if (fromMatches.length === 0) return tables;
  
  const lastFromIdx = fromMatches[fromMatches.length - 1].index ?? 0;
  const clauseText = text.slice(lastFromIdx);

  // Regex nhận diện các bảng sau FROM hoặc JOIN (hỗ trợ cả identifier thường, double-quotes và MySQL backticks):
  // FROM / JOIN <table> [[AS] <alias>]
  const tableRegex = /\b(?:FROM|JOIN)\s+([a-zA-Z0-9_".`]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_"`]+))?/gi;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(clauseText)) !== null) {
    const rawTableName = match[1]?.replace(/["`]/g, '').trim();
    if (!rawTableName) continue;

    // Lấy phần tên bảng sau schema nếu có (public.users -> users)
    const tableName = rawTableName.includes('.') ? rawTableName.split('.').pop()! : rawTableName;
    if (SQL_KEYWORDS.has(tableName.toUpperCase())) continue;

    const rawAlias = match[2]?.replace(/["`]/g, '').trim();
    let alias = tableName;
    let hasExplicitAlias = false;

    if (rawAlias && !SQL_KEYWORDS.has(rawAlias.toUpperCase())) {
      alias = rawAlias;
      hasExplicitAlias = true;
    }

    tables.push({
      name: tableName,
      alias,
      hasExplicitAlias,
    });
  }

  return tables;
}

/**
 * Dự đoán mệnh đề `JOIN ... ON ...` dựa trên đồ thị khóa ngoại.
 * Phản hồi < 1ms, không bao giờ ném ngoại lệ.
 */
export function predictFkJoin(input: {
  textBeforeCursor: string;
  tables?: TableSchema;
  foreignKeys?: ForeignKeyRelation[];
}): string | null {
  try {
    const { textBeforeCursor, foreignKeys } = input;
    if (!textBeforeCursor || !foreignKeys || foreignKeys.length === 0) {
      return null;
    }

    // Kiểm tra xem vị trí con trỏ có đang nằm ngay sau từ khóa JOIN không
    // Hỗ trợ: JOIN, LEFT JOIN, RIGHT JOIN, INNER JOIN, FULL JOIN, CROSS JOIN
    const joinEndRegex = /\b(?:(?:LEFT|RIGHT|INNER|FULL|CROSS)\s+)?JOIN(\s*)$/i;
    const match = joinEndRegex.exec(textBeforeCursor);
    if (!match) {
      return null;
    }

    const trailingSpaces = match[1] ?? '';
    const prefix = trailingSpaces.length === 0 ? ' ' : '';

    // Cắt bỏ phần JOIN ở cuối để phân tích các bảng đã có trước đó
    const textBeforeJoin = textBeforeCursor.slice(0, match.index);
    const existingTables = extractExistingTables(textBeforeJoin);
    if (existingTables.length === 0) {
      return null;
    }

    const existingNamesSet = new Set(existingTables.map((t) => t.name.toLowerCase()));
    const usedAliases = new Set(existingTables.map((t) => t.alias.toLowerCase()));

    // Duyệt từ bảng xuất hiện gần nhất ngược lên (ưu tiên bảng gần con trỏ)
    for (let i = existingTables.length - 1; i >= 0; i--) {
      const existing = existingTables[i];
      const existingNameLower = existing.name.toLowerCase();

      for (const fk of foreignKeys) {
        const fromTableLower = fk.fromTable.toLowerCase();
        const toTableLower = fk.toTable.toLowerCase();

        // Trường hợp 1: table_b trỏ tới existing_table (ví dụ orders.user_id -> users.id)
        if (toTableLower === existingNameLower && !existingNamesSet.has(fromTableLower)) {
          const candidateTable = fk.fromTable;
          const candidateAlias = existing.hasExplicitAlias
            ? generateAlias(candidateTable, usedAliases)
            : '';

          const candidateRef = candidateAlias || candidateTable;
          const existingRef = existing.alias;

          const joinSnippet = candidateAlias
            ? `${candidateTable} ${candidateAlias} ON ${candidateRef}.${fk.fromColumn} = ${existingRef}.${fk.toColumn}`
            : `${candidateTable} ON ${candidateRef}.${fk.fromColumn} = ${existingRef}.${fk.toColumn}`;

          return `${prefix}${joinSnippet}`;
        }

        // Trường hợp 2: existing_table trỏ tới table_b (ví dụ orders.user_id -> users.id, đang ở orders)
        if (fromTableLower === existingNameLower && !existingNamesSet.has(toTableLower)) {
          const candidateTable = fk.toTable;
          const candidateAlias = existing.hasExplicitAlias
            ? generateAlias(candidateTable, usedAliases)
            : '';

          const candidateRef = candidateAlias || candidateTable;
          const existingRef = existing.alias;

          const joinSnippet = candidateAlias
            ? `${candidateTable} ${candidateAlias} ON ${candidateRef}.${fk.toColumn} = ${existingRef}.${fk.fromColumn}`
            : `${candidateTable} ON ${candidateRef}.${fk.toColumn} = ${existingRef}.${fk.fromColumn}`;

          return `${prefix}${joinSnippet}`;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}
