// Dạng chung của hai AST: mỗi câu DDL đổi thành vài sự kiện, rồi index.ts áp lên trạng thái schema.
export type Col = { name: string; type: string; len?: number };

export type Ev =
  | { k: "table"; t: string; cols: Col[]; opaque: boolean } // opaque: LIKE/INHERITS... không biết hết cột và khóa
  | { k: "col"; t: string; col: Col }
  | { k: "dropcol"; t: string; c: string }
  | { k: "pk"; t: string; cols: string[]; name?: string }
  | { k: "droppk"; t: string; name?: string } // name bỏ trống: bỏ khóa chính bất kể tên
  | { k: "idx"; t: string; cols: string[] } // "" là phần tử không phải cột thuần (biểu thức)
  | { k: "fk"; t: string; cols: string[] }
  | { k: "drop"; t: string };

// AST hai parser là JSON không có kiểu, đọc có chủ đích bằng any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type J = any;
