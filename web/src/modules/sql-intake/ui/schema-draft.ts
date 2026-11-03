import type { EngineId } from "@/contracts/engine";
import type { InferredColumn, InferredTable } from "../infer";

export type DraftColumn = Omit<InferredColumn, "reason"> & { reason: InferredColumn["reason"] | "user" };
export type DraftTable = Omit<InferredTable, "columns"> & { columns: DraftColumn[] };
export type Draft = { tables: DraftTable[]; mode: "form" | "sql"; manualSql: string };
export type Issue = { key: "empty-name" | "duplicate-table" | "no-columns" | "empty-column" | "duplicate-column" | "multi-pk" | "placeholder"; table: number; column?: number };

export const PLACEHOLDER = "_sqllens_placeholder";
export const MAX_NAME = 63;
export const TYPES = ["integer", "bigint", "smallint", "numeric", "real", "double precision", "text", "varchar(255)", "boolean", "date", "timestamp", "timestamptz", "uuid", "jsonb"];

export const toDraft = (tables: InferredTable[]): Draft => ({ tables: structuredClone(tables) as DraftTable[], mode: "form", manualSql: "" });

// Bảng nào không cho xác nhận và vì sao. Rỗng nghĩa là xác nhận được. Tên bảng và cột được quote khi sinh SQL nên ký tự lạ không phải lỗi.
export function validate(d: Draft, engine: EngineId): Issue[] {
  if (d.mode === "sql") return [];
  const fold = (s: string) => (engine === "mysql" ? s.toLowerCase() : s);
  const out: Issue[] = [];
  const seen = new Set<string>();
  d.tables.forEach((t, ti) => {
    if (!t.name.trim()) out.push({ key: "empty-name", table: ti });
    else if (seen.has(fold(t.name))) out.push({ key: "duplicate-table", table: ti });
    seen.add(fold(t.name));
    if (!t.columns.length) out.push({ key: "no-columns", table: ti });
    const cols = new Set<string>();
    t.columns.forEach((c, ci) => {
      if (!c.name.trim()) out.push({ key: "empty-column", table: ti, column: ci });
      else if (c.name === PLACEHOLDER) out.push({ key: "placeholder", table: ti, column: ci });
      else if (cols.has(fold(c.name))) out.push({ key: "duplicate-column", table: ti, column: ci });
      cols.add(fold(c.name));
    });
    // toCreateSql ghi PRIMARY KEY ngay sau từng cột, nên hai cột khóa chính sẽ sinh SQL sai.
    if (t.columns.filter((c) => c.primaryKeyGuess).length > 1) out.push({ key: "multi-pk", table: ti });
  });
  return out;
}
