import type { EngineId } from "./engine";

export type PlanKind =
  | "seq_scan"
  | "index_scan"
  | "index_only_scan"
  | "bitmap_scan"
  | "nested_loop"
  | "hash_join"
  | "merge_join"
  | "hash"
  | "sort"
  | "aggregate"
  | "limit"
  | "other";

// Một bước của plan. Số nào engine không cung cấp thì để undefined, không tự đoán.
// Không có trường thời gian: so sánh bằng số dòng và số trang (nguyên tắc 3 trong CLAUDE.md).
export type PlanNode = {
  id: string;
  kind: PlanKind;
  // Tên gốc của engine, ví dụ "Index Scan", để hiện đúng chữ engine dùng.
  label: string;
  table?: string;
  index?: string;
  // Điều kiện dùng để tìm trong index hoặc để nối (Index Cond, Recheck Cond, Hash Cond, Merge Cond).
  condition?: string;
  // Điều kiện lọc sau khi đã đọc dòng (Filter, Join Filter); không chứng tỏ index dùng được cột đó.
  filter?: string;
  estimatedRows?: number;
  actualRows?: number;
  loops?: number;
  pagesRead?: number;
  children: PlanNode[];
};

export type Plan = {
  engine: EngineId;
  // true khi đã thực sự chạy (EXPLAIN ANALYZE), nên actualRows và pagesRead là số thật.
  analyzed: boolean;
  root: PlanNode;
};
