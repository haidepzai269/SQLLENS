export type StatementKind =
  | "create_table"
  | "alter_table"
  | "create_index"
  | "drop"
  | "select"
  | "insert"
  | "update"
  | "delete"
  | "transaction"
  | "set"
  | "other";

// start/end: vị trí ký tự (UTF-16) trong chuỗi JS, end không gồm dấu `;`. index đếm từ 0.
export type ParsedStatement = {
  index: number;
  kind: StatementKind;
  start: number;
  end: number;
  tables: string[];
  ast: unknown;
};

// position đếm từ 0, line và column đếm từ 1.
export type ParseError = { message: string; position?: number; line?: number; column?: number };

// Lỗi parse không được chặn việc chạy SQL: nơi gọi vẫn gửi SQL cho engine thật khi ok là false.
export type ParseOutcome = { ok: true; statements: ParsedStatement[] } | { ok: false; error: ParseError };
