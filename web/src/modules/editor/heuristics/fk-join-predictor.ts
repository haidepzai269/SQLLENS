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
 * Che giấu (mask) các ký tự nằm trong string literal ('...'), comment, hoặc bên trong cặp ngoặc (depth > 0).
 * Giữ nguyên các identifier (kể cả double quotes "..." và MySQL backticks `...`) ở cấp độ ngoài cùng.
 * Chuỗi trả về có cùng độ dài 1:1 với chuỗi gốc, giúp regex và vị trí index bảo toàn tuyệt đối.
 */
function maskNonTopLevel(text: string): string {
  const len = text.length;
  const result: string[] = new Array(len);
  let depth = 0;
  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < len; i++) {
    const ch = text[i];
    const next = i + 1 < len ? text[i + 1] : '';

    if (inSingleQuote) {
      result[i] = ' ';
      if (ch === "'") {
        if (next === "'") {
          i++;
          result[i] = ' ';
        } else {
          inSingleQuote = false;
        }
      } else if (ch === '\\' && next === "'") {
        i++;
        result[i] = ' ';
      }
      continue;
    }

    if (inLineComment) {
      result[i] = ch === '\n' ? '\n' : ' ';
      if (ch === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      result[i] = ch === '\n' ? '\n' : ' ';
      if (ch === '*' && next === '/') {
        i++;
        result[i] = ' ';
        inBlockComment = false;
      }
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      result[i] = ' ';
      continue;
    }

    if (ch === '-' && next === '-') {
      inLineComment = true;
      result[i] = ' ';
      i++;
      result[i] = ' ';
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      result[i] = ' ';
      i++;
      result[i] = ' ';
      continue;
    }

    if (ch === '(') {
      depth++;
      result[i] = ' ';
      continue;
    }

    if (ch === ')') {
      if (depth > 0) depth--;
      result[i] = ' ';
      continue;
    }

    if (depth > 0) {
      result[i] = ' ';
    } else {
      result[i] = ch;
    }
  }

  return result.join('');
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
 * Bỏ qua các bảng nằm trong subquery (depth > 0).
 */
function extractExistingTables(text: string): TableOccurrence[] {
  const tables: TableOccurrence[] = [];
  if (!text) return tables;

  const masked = maskNonTopLevel(text);
  const lastSemicolon = masked.lastIndexOf(';');
  const stmtStart = lastSemicolon >= 0 ? lastSemicolon + 1 : 0;
  const stmtMasked = masked.slice(stmtStart);

  // Tìm vị trí FROM cuối cùng ở depth 0 để giới hạn phạm vi câu lệnh hiện tại
  const fromMatches = Array.from(stmtMasked.matchAll(/\bFROM\b/gi));
  if (fromMatches.length === 0) return tables;
  
  const lastFromIdx = fromMatches[fromMatches.length - 1].index ?? 0;
  const clauseMasked = stmtMasked.slice(lastFromIdx);

  // Regex nhận diện các bảng sau FROM hoặc JOIN (hỗ trợ cả identifier thường, double-quotes và MySQL backticks):
  // FROM / JOIN <table> [[AS] <alias>]
  // Quét trên clauseMasked để loại bỏ triệt để các bảng trong subquery (depth > 0) và comment
  const tableRegex = /\b(?:FROM|JOIN)\s+([a-zA-Z0-9_".`]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_"`]+))?/gi;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(clauseMasked)) !== null) {
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
 * Hỗ trợ cả 2 trường hợp:
 * 1. Bare JOIN: Vừa gõ JOIN -> gợi ý <candidate_table> [alias] ON ...
 * 2. JOIN with Target Table: Đã gõ tên bảng (và alias) sau JOIN -> gợi ý tiếp ON <target_ref>.<fk_col> = <existing_ref>.<pk_col>
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

    // -------------------------------------------------------------------------
    // Trường hợp 1: Vừa gõ JOIN (Bare JOIN)
    // Hỗ trợ: JOIN, LEFT JOIN, RIGHT JOIN, INNER JOIN, FULL JOIN, CROSS JOIN
    // -------------------------------------------------------------------------
    const bareJoinRegex = /\b(?:(?:LEFT|RIGHT|INNER|FULL|CROSS)\s+)?JOIN(\s*)$/i;
    const bareMatch = bareJoinRegex.exec(textBeforeCursor);

    if (bareMatch) {
      const trailingSpaces = bareMatch[1] ?? '';
      const prefix = trailingSpaces.length === 0 ? ' ' : '';

      // Cắt bỏ phần JOIN ở cuối để phân tích các bảng đã có trước đó
      const textBeforeJoin = textBeforeCursor.slice(0, bareMatch.index);
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

          // Trường hợp 1a: table_b trỏ tới existing_table (ví dụ orders.user_id -> users.id)
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

          // Trường hợp 1b: existing_table trỏ tới table_b (ví dụ orders.user_id -> users.id, đang ở orders)
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
    }

    // -------------------------------------------------------------------------
    // Trường hợp 2: Đã gõ tên bảng sau JOIN (JOIN with Target Table)
    // Ví dụ: "... JOIN orders " hoặc "... JOIN orders o " hoặc "... JOIN orders AS o"
    // -------------------------------------------------------------------------
    const joinWithTableRegex =
      /\b(?:(?:LEFT|RIGHT|INNER|FULL|CROSS)\s+)?JOIN\s+([a-zA-Z0-9_".`]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_"`]+))?(\s*)$/i;
    const tableMatch = joinWithTableRegex.exec(textBeforeCursor);

    if (tableMatch) {
      const rawTargetTable = tableMatch[1]?.replace(/["`]/g, '').trim();
      if (!rawTargetTable) return null;

      const targetTable = rawTargetTable.includes('.')
        ? rawTargetTable.split('.').pop()!
        : rawTargetTable;

      if (SQL_KEYWORDS.has(targetTable.toUpperCase())) {
        return null;
      }

      const rawTargetAlias = tableMatch[2]?.replace(/["`]/g, '').trim();
      if (rawTargetAlias) {
        const upperAlias = rawTargetAlias.toUpperCase();
        // Nếu người dùng đã gõ ON (ví dụ JOIN orders ON), không gợi ý tiếp
        if (upperAlias === 'ON' || SQL_KEYWORDS.has(upperAlias)) {
          return null;
        }
      }

      const targetAlias =
        rawTargetAlias && !SQL_KEYWORDS.has(rawTargetAlias.toUpperCase())
          ? rawTargetAlias
          : '';

      const targetRef = targetAlias || targetTable;

      const trailingSpaces = tableMatch[3] ?? '';
      const prefix = trailingSpaces.length === 0 ? ' ' : '';

      // Cắt bỏ phần JOIN này ở cuối để tìm các bảng đã có trước đó
      const textBeforeJoin = textBeforeCursor.slice(0, tableMatch.index);
      const existingTables = extractExistingTables(textBeforeJoin);
      if (existingTables.length === 0) {
        return null;
      }

      const targetNameLower = targetTable.toLowerCase();

      // Duyệt từ bảng xuất hiện gần nhất ngược lên
      for (let i = existingTables.length - 1; i >= 0; i--) {
        const existing = existingTables[i];
        const existingNameLower = existing.name.toLowerCase();

        // Không tự JOIN với chính nó
        if (existingNameLower === targetNameLower) continue;

        for (const fk of foreignKeys) {
          const fromTableLower = fk.fromTable.toLowerCase();
          const toTableLower = fk.toTable.toLowerCase();

          // Trường hợp 2a: targetTable trỏ tới existing_table (ví dụ orders.user_id -> users.id)
          if (fromTableLower === targetNameLower && toTableLower === existingNameLower) {
            const existingRef = existing.alias;
            return `${prefix}ON ${targetRef}.${fk.fromColumn} = ${existingRef}.${fk.toColumn}`;
          }

          // Trường hợp 2b: existing_table trỏ tới targetTable (ví dụ orders.user_id -> users.id, đang ở orders)
          if (fromTableLower === existingNameLower && toTableLower === targetNameLower) {
            const existingRef = existing.alias;
            return `${prefix}ON ${targetRef}.${fk.toColumn} = ${existingRef}.${fk.fromColumn}`;
          }
        }
      }

      return null;
    }

    return null;
  } catch {
    return null;
  }
}
