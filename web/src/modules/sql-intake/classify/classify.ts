import type { ParseOutcome, ParsedStatement } from "../parser/types";

export type InputKind = "empty" | "schema" | "query" | "both" | "unknown";
export type Classification = { kind: InputKind; schemaStatements: number[]; queryStatements: number[]; otherStatements: number[] };

const SCHEMA = new Set(["create_table", "create_index", "alter_table"]);
const QUERY = new Set(["select", "update", "delete"]);

// `SELECT set_config(...)` của pg_dump không phải truy vấn của người dùng. Tìm nút FuncCall tên set_config trong AST, không so chuỗi (tránh nhầm literal hay alias).
const hasConfigCall = (n: unknown): boolean => {
  if (Array.isArray(n)) return n.some(hasConfigCall);
  if (typeof n !== "object" || n === null) return false;
  const o = n as Record<string, unknown>;
  const fc = o.FuncCall as { funcname?: { String?: { sval?: string } }[] } | undefined;
  if (fc?.funcname?.at(-1)?.String?.sval === "set_config") return true;
  return Object.values(o).some(hasConfigCall);
};
const isConfigCall = (s: ParsedStatement) => s.kind === "select" && s.tables.length === 0 && hasConfigCall(s.ast);

export function classifyInput(outcome: ParseOutcome): Classification {
  const out: Classification = { kind: "unknown", schemaStatements: [], queryStatements: [], otherStatements: [] };
  if (!outcome.ok) return out;
  if (outcome.statements.length === 0) return { ...out, kind: "empty" };
  const inserts: number[] = [];
  for (const s of outcome.statements) {
    if (SCHEMA.has(s.kind)) out.schemaStatements.push(s.index);
    else if (s.kind === "insert") inserts.push(s.index);
    else if (QUERY.has(s.kind) && !isConfigCall(s)) out.queryStatements.push(s.index);
    else out.otherStatements.push(s.index);
  }
  // INSERT cạnh schema là dữ liệu mẫu; đứng một mình thì là query.
  if (out.schemaStatements.length) out.otherStatements.push(...inserts);
  else out.queryStatements.push(...inserts);
  out.queryStatements.sort((a, b) => a - b);
  out.otherStatements.sort((a, b) => a - b);
  const sc = out.schemaStatements.length > 0;
  const q = out.queryStatements.length > 0;
  out.kind = sc && q ? "both" : sc ? "schema" : q ? "query" : "unknown";
  return out;
}
