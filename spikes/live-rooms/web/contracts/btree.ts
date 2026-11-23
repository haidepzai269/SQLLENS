import type { EngineId } from "./engine";

// Một trang của index. level 0 là leaf. Chỉ chứa những trang đã đọc.
export type BTreeNode = {
  page: number;
  level: number;
  // Khóa dạng chữ để hiển thị. Có thể chỉ là một phần khi trang quá nhiều khóa, xem totalKeys.
  keys: string[];
  // Chỉ có ở trang không phải leaf: trang con, cùng thứ tự với keys. Khóa đầu của trang trong PostgreSQL là âm vô cực, để chuỗi rỗng.
  children?: number[];
  // Leaf bên phải, để vẽ range scan trượt ngang.
  next?: number;
  totalKeys: number;
  // Dữ liệu dòng tại leaf (cho Clustered Index hoặc Secondary Index hiển thị row / PK).
  leafRows?: Record<string, unknown>[];
};

export type BTreeModel = {
  engine: EngineId;
  index: string;
  table: string;
  columns: string[];
  // Số tầng, tính cả leaf.
  height: number;
  rootPage: number;
  nodes: BTreeNode[];
  // Trang chưa đọc theo từng tầng, để vẽ dạng "+206 node".
  hidden: { level: number; count: number }[];
  totalPages: number;
  // Mở rộng cho MySQL InnoDB:
  isClustered?: boolean;
  clusteredIndex?: BTreeModel;
  isCovering?: boolean;
  pkColumns?: string[];
  lookupKey?: string;
};

// Đường đi của một khóa từ root xuống leaf. heapPage chỉ có ở PostgreSQL (nhảy từ index sang heap).
// lookupPages và lookupKey cho MySQL InnoDB (nhảy từ secondary index sang clustered index).
export type BTreePath = {
  key: string;
  pages: number[];
  heapPage?: number;
  lookupKey?: string;
  lookupPages?: number[];
  isCovering?: boolean;
};
