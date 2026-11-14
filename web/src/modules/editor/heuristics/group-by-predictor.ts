/**
 * Copyright (c) 2026 SQLLens
 * GROUP BY Predictor: Tự động trích xuất các cột non-aggregate trong mệnh đề SELECT.
 */

import { TableSchema } from './types';

export interface PredictGroupByInput {
  textBeforeCursor: string;
  tables?: TableSchema;
}

const AGGREGATE_FUNCTIONS_REGEX = /\b(?:COUNT|SUM|AVG|MIN|MAX|STRING_AGG|GROUP_CONCAT|ARRAY_AGG)\s*\(/i;

/**
 * Loại bỏ alias (AS alias hoặc alias ngầm định) khỏi một biểu thức cột trong SELECT.
 */
function stripColumnAlias(expr: string): string {
  const trimmed = expr.trim();
  // 1. Dạng tường minh: expr AS alias
  const asMatch = trimmed.match(/^(.*?)\s+AS\s+[a-zA-Z0-9_"`]+$/i);
  if (asMatch && asMatch[1]) {
    return asMatch[1].trim();
  }

  // 2. Dạng ngầm định: expr alias (không có AS)
  // Chỉ bóc tách khi phần sau là một định danh hợp lệ và không phải keyword của SQL
  const implicitMatch = trimmed.match(/^(.*?[a-zA-Z0-9_")`\]])\s+([a-zA-Z0-9_]+)$/);
  if (implicitMatch && implicitMatch[1] && implicitMatch[2]) {
    const candidateAlias = implicitMatch[2].toUpperCase();
    const disallowedAliases = new Set(['ASC', 'DESC', 'NULL', 'IS', 'NOT', 'TRUE', 'FALSE']);
    if (!disallowedAliases.has(candidateAlias)) {
      return implicitMatch[1].trim();
    }
  }

  return trimmed;
}

/**
 * Tách danh sách biểu thức trong SELECT list theo dấu phẩy cấp cao nhất (không nằm trong ngoặc).
 */
function splitSelectList(selectText: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < selectText.length; i++) {
    const ch = selectText[i];
    if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      if (depth > 0) depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      if (current.trim()) {
        items.push(current.trim());
      }
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items;
}

/**
 * Kiểm tra xem một biểu thức có phải là một giá trị hằng số (literal) không cần thiết phải đưa vào GROUP BY.
 */
function isLiteralExpression(expr: string): boolean {
  const trimmed = expr.trim();
  // Số nguyên hoặc số thực
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return true;
  // Chuỗi ký tự '...'
  if (/^'([^'\\]|\\.)*'$/.test(trimmed)) return true;
  // Boolean hoặc NULL
  if (/^(?:TRUE|FALSE|NULL)$/i.test(trimmed)) return true;
  // Dấu sao *
  if (trimmed === '*') return true;
  return false;
}

/**
 * Dự đoán danh sách các cột cho mệnh đề `GROUP BY`.
 * Quét ngược lại mệnh đề SELECT, bóc tách các cột trần không nằm trong hàm aggregate.
 */
export function predictGroupBy(input: {
  textBeforeCursor: string;
  tables?: TableSchema;
}): string | null {
  try {
    const { textBeforeCursor } = input;
    if (!textBeforeCursor) return null;

    // Kiểm tra xem vị trí con trỏ có đang nằm ngay sau `GROUP BY` không
    const groupByEndRegex = /\bGROUP\s+BY(\s*)$/i;
    const match = groupByEndRegex.exec(textBeforeCursor);
    if (!match) return null;

    const trailingSpaces = match[1] ?? '';
    const prefix = trailingSpaces.length === 0 ? ' ' : '';

    // Lấy đoạn văn bản trước `GROUP BY`
    const beforeGroupBy = textBeforeCursor.slice(0, match.index);

    // Tìm mệnh đề SELECT gần nhất tương ứng với truy vấn hiện tại
    const selectMatches = Array.from(beforeGroupBy.matchAll(/\bSELECT\b/gi));
    if (selectMatches.length === 0) return null;

    const lastSelectMatch = selectMatches[selectMatches.length - 1];
    const selectStartIdx = (lastSelectMatch.index ?? 0) + lastSelectMatch[0].length;

    // Tìm vị trí `FROM` nằm sau SELECT này
    const textAfterSelect = beforeGroupBy.slice(selectStartIdx);
    const fromMatch = /\bFROM\b/i.exec(textAfterSelect);
    if (!fromMatch) return null;

    const selectClauseRaw = textAfterSelect.slice(0, fromMatch.index).trim();
    if (!selectClauseRaw) return null;

    // Loại bỏ DISTINCT ở đầu nếu có
    const selectClause = selectClauseRaw.replace(/^DISTINCT\s+/i, '').trim();

    // Bóc tách danh sách các mục trong SELECT list
    const items = splitSelectList(selectClause);
    if (items.length === 0) return null;

    const nonAggregateCols: string[] = [];

    for (const item of items) {
      // Nếu mục có chứa hàm aggregate -> Bỏ qua
      if (AGGREGATE_FUNCTIONS_REGEX.test(item)) {
        continue;
      }

      // Bóc tách alias (u.dept AS dept -> u.dept)
      const rawCol = stripColumnAlias(item);
      if (!rawCol || isLiteralExpression(rawCol)) {
        continue;
      }

      nonAggregateCols.push(rawCol);
    }

    // Nếu không có cột non-aggregate nào (ví dụ toàn COUNT(*), SUM(...)) -> Không cần GROUP BY
    if (nonAggregateCols.length === 0) {
      return null;
    }

    // Loại bỏ các cột trùng lặp nếu có
    const uniqueCols = Array.from(new Set(nonAggregateCols));

    return `${prefix}${uniqueCols.join(', ')}`;
  } catch {
    return null;
  }
}
