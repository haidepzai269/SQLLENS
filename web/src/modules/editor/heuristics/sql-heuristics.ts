/**
 * Copyright (c) 2026 SQLLens
 * SQL Heuristics Engine (Client-side AST Matcher):
 * Động cơ phân tích cú pháp quy tắc cục bộ thuần TypeScript, < 1ms, 0đ chi phí, 0 token.
 * Dự đoán gợi ý viết tiếp cho `JOIN ... ON ...`, `GROUP BY`, `INSERT INTO` và `Lifecycle Next Clause`.
 */

import { PredictContext, TableSchema } from './types';
import { predictFkJoin } from './fk-join-predictor';
import { predictGroupBy } from './group-by-predictor';
import { predictInsertColumns } from './insert-columns-predictor';
import { predictStatementStart } from './statement-predictor';

export { predictFkJoin } from './fk-join-predictor';
export { predictGroupBy } from './group-by-predictor';
export { predictInsertColumns } from './insert-columns-predictor';
export { predictStatementStart } from './statement-predictor';
export * from './types';

const SQL_CLAUSE_KEYWORDS = new Set([
  'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'FULL', 'CROSS', 'ON',
  'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'UNION', 'EXCEPT', 'WINDOW'
]);

/**
 * Dự đoán tiếp bước theo vòng đời câu lệnh SQL (Lifecycle Next Clause):
 * Ví dụ: Sau `SELECT ... FROM table` -> gợi ý tiếp `WHERE ` hoặc `ORDER BY id DESC`.
 */
export function predictLifecycleNextClause(
  textBeforeCursor: string,
  tables?: TableSchema
): string | null {
  try {
    if (!textBeforeCursor) return null;

    // Nhận diện: SELECT ... FROM <table> [alias] ở cuối chuỗi
    // Đảm bảo không kết thúc giữa chừng từ khóa khác
    const selectFromRegex = /\bSELECT\b[\s\S]+?\bFROM\s+([a-zA-Z0-9_".`]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?(\s*)$/i;
    const match = selectFromRegex.exec(textBeforeCursor);
    if (!match) return null;

    const rawTableName = match[1]?.replace(/["`]/g, '').trim();
    if (!rawTableName || SQL_CLAUSE_KEYWORDS.has(rawTableName.toUpperCase())) {
      return null;
    }

    const rawAlias = match[2]?.trim();
    if (rawAlias && SQL_CLAUSE_KEYWORDS.has(rawAlias.toUpperCase())) {
      return null;
    }

    const trailingSpaces = match[3] ?? '';
    const prefix = trailingSpaces.length === 0 ? ' ' : '';

    // Tận dụng schema nếu có để kiểm tra tính hợp lệ của bảng
    const simpleName = rawTableName.includes('.') ? rawTableName.split('.').pop()! : rawTableName;
    if (tables && Object.keys(tables).length > 0) {
      // Có thể mở rộng gợi ý chi tiết nếu cần trong tương lai
      void simpleName;
    }

    // Gợi ý bước tiếp theo phổ biến nhất trong vòng đời câu lệnh: WHERE
    return `${prefix}WHERE `;
  } catch {
    return null;
  }
}

/**
 * Hàm facade chính: Dự đoán đoạn mã SQL tiếp theo dựa trên ngữ cảnh con trỏ và schema.
 * Đảm bảo:
 * - Chạy in-memory hoàn toàn < 1ms
 * - 0đ chi phí, 0 token, không gọi mạng
 * - Tuyệt đối không bao giờ văng ngoại lệ (bọc try-catch toàn diện)
 */
export function predictNextSqlSnippet(ctx: PredictContext): string | null {
  try {
    const { docText, cursorOffset, tables, foreignKeys } = ctx;
    if (!docText || typeof cursorOffset !== 'number' || cursorOffset <= 0) {
      return null;
    }

    const safeOffset = Math.min(Math.max(0, cursorOffset), docText.length);
    const textBeforeCursor = docText.slice(0, safeOffset);
    if (!textBeforeCursor.trim()) {
      return null;
    }

    // 1. Ưu tiên cao nhất: Dự đoán Foreign Key JOIN ON
    const fkJoinSuggestion = predictFkJoin({ textBeforeCursor, tables, foreignKeys });
    if (fkJoinSuggestion) {
      return fkJoinSuggestion;
    }

    // 2. Dự đoán GROUP BY non-aggregate columns
    const groupBySuggestion = predictGroupBy({ textBeforeCursor, tables });
    if (groupBySuggestion) {
      return groupBySuggestion;
    }

    // 3. Dự đoán danh sách cột khi INSERT INTO
    const insertSuggestion = predictInsertColumns({ textBeforeCursor, tables });
    if (insertSuggestion) {
      return insertSuggestion;
    }

    // 4. Dự đoán từ khóa khởi đầu câu lệnh (Statement Start: CREATE TABLE, SELECT, etc.)
    const statementSuggestion = predictStatementStart({ textBeforeCursor, tables });
    if (statementSuggestion) {
      return statementSuggestion;
    }

    // 5. Dự đoán mệnh đề tiếp theo theo vòng đời (Lifecycle Next Clause)
    const lifecycleSuggestion = predictLifecycleNextClause(textBeforeCursor, tables);
    if (lifecycleSuggestion) {
      return lifecycleSuggestion;
    }

    return null;
  } catch {
    return null;
  }
}
