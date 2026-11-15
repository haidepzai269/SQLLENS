/**
 * Copyright (c) 2026 SQLLens
 * Types definition for Client-side SQL Heuristic Matcher.
 */

/**
 * Mô tả một quan hệ khóa ngoại giữa 2 bảng trong schema CSDL.
 * fromTable.fromColumn tham chiếu tới toTable.toColumn (hoặc ngược lại).
 */
export interface ForeignKeyRelation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

/**
 * Bản đồ cấu trúc schema bảng và danh sách các cột: { tableName: [col1, col2, ...] }
 */
export type TableSchema = Record<string, string[]>;

/**
 * Ngữ cảnh đầu vào truyền tới bộ phân giải gợi ý viết tiếp.
 */
export interface PredictContext {
  docText: string;
  cursorOffset: number;
  tables?: TableSchema;
  foreignKeys?: ForeignKeyRelation[];
}

/**
 * Phân loại loại gợi ý ngữ cảnh SQL.
 */
export type PredictResultType = 'fk_join' | 'group_by' | 'insert_columns' | 'lifecycle' | 'statement_start';

/**
 * Kết quả phân tích chi tiết của động cơ gợi ý.
 */
export interface PredictResult {
  text: string;
  type: PredictResultType;
}
