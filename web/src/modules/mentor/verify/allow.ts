import type { ParsedStatement } from "@/modules/sql-intake/parser";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null;

// Chỉ hàm thuần, không tác dụng phụ. Mọi hàm khác (nextval, set_config, pg_*, lo_*, hàm người dùng) bị chặn.
const SAFE_FUNCS = new Set(
  ("count sum avg min max lower upper length char_length abs round ceil ceiling floor trunc concat concat_ws substr substring " +
    "trim ltrim rtrim replace left right now date_trunc date_part extract to_char age array_agg string_agg row_number rank " +
    "dense_rank lag lead bool_and bool_or md5 jsonb_agg").split(" "),
);
const ALTER_OK = new Set(["AT_AddColumn", "AT_AddConstraint", "AT_SetNotNull", "AT_DropNotNull", "AT_AlterColumnType", "AT_ColumnDefault"]);

const sval = (n: unknown) => (isObj(n) && isObj(n.String) && typeof n.String.sval === "string" ? n.String.sval : undefined);

// shortcut: người dùng tự tạo hàm/toán tử overload trùng tên hàm an toàn (vd public.length(int)) vẫn lọt; chỉ ảnh hưởng tab của chính họ, cùng họ rủi ro với DO (CLAUDE.md).
// Duyệt cả cây: true nếu có thứ không được chạy. shortcut: không biết view/hàm do người dùng tạo gọi gì bên trong, nâng lên khi cho AI sửa schema.
function unsafe(n: unknown): boolean {
  if (Array.isArray(n)) return n.some(unsafe);
  if (!isObj(n)) return false;
  for (const k of Object.keys(n)) {
    if (k === "intoClause" || k === "lockingClause") return true;
    // Câu ghi hoặc câu khác lồng trong CTE hay biểu thức.
    if (k.endsWith("Stmt") && k !== "SelectStmt") return true;
  }
  const fc = n.FuncCall;
  if (isObj(fc) && Array.isArray(fc.funcname)) {
    const parts = fc.funcname.map(sval);
    // Tên có chữ hoa (đã bọc "...") là hàm khác với hàm có sẵn cùng tên viết thường.
    const name = parts.at(-1);
    const qualifiedOk = parts.length === 1 || (parts.length === 2 && parts[0] === "pg_catalog");
    if (!name || !qualifiedOk || !SAFE_FUNCS.has(name)) return true;
  } else if (fc !== undefined) return true;
  return Object.values(n).some(unsafe);
}

/** true nếu câu nằm trong danh sách cho phép: SELECT thuần, CREATE INDEX, ALTER TABLE thêm cột/ràng buộc. */
export function allowed(s: ParsedStatement): boolean {
  const a = s.ast;
  // Bỏ khóa ngoài cùng (tên loại câu) để chỉ kiểm các câu lồng bên trong.
  if (!isObj(a) || unsafe(Object.values(a))) return false;
  if (s.kind === "select") return "SelectStmt" in a;
  if (s.kind === "create_index") return isObj(a.IndexStmt) && !a.IndexStmt.concurrent;
  if (s.kind === "alter_table") {
    const t = a.AlterTableStmt;
    if (!isObj(t) || t.objtype !== "OBJECT_TABLE" || !Array.isArray(t.cmds) || t.cmds.length === 0) return false;
    return t.cmds.every((c) => isObj(c) && isObj(c.AlterTableCmd) && ALTER_OK.has(String(c.AlterTableCmd.subtype)));
  }
  return false;
}
