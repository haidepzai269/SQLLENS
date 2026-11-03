import { loadModule, parseSync } from "pgsql-parser";

// Mỗi khóa có một câu trong messages/<locale>/guard.json (namespace "guard", ví dụ t("role", { index })).
export const GUARD_REASONS = [
  "guard.role",
  "guard.resetAll",
  "guard.extension",
  "guard.load",
  "guard.copyProgram",
  "guard.roleDdl",
  "guard.grant",
  "guard.escaped",
] as const;
export type GuardReason = (typeof GUARD_REASONS)[number];
export type GuardResult = { ok: true } | { ok: false; reasonKey: GuardReason; statementIndex: number };

let ready = false;
export const isGuardReady = () => ready;

// libpg-query tìm file WASM cạnh script đang chạy, mà trong worker đó là thư mục chunk, nên chuyển hướng
// đúng một yêu cầu fetch sang `wasm`. shortcut: vá `fetch` tạm thời, bỏ khi libpg-query cho truyền locateFile.
export async function loadGuard(wasm?: URL): Promise<void> {
  const orig = globalThis.fetch;
  if (wasm) {
    globalThis.fetch = (input, init) =>
      String(input instanceof Request ? input.url : input).endsWith("libpg-query.wasm") ? orig(wasm, init) : orig(input, init);
  }
  try {
    await loadModule();
    ready = true;
  } catch {
    // Không tải được parser thì lớp một tắt, lớp hai (kiểm sau mỗi lần chạy) vẫn giữ ranh giới.
    ready = false;
  } finally {
    globalThis.fetch = orig;
  }
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null;

const SENSITIVE_GUC = new Set(["role", "session_authorization"]);

function strConst(n: unknown): string | undefined {
  if (!isObj(n)) return undefined;
  if (isObj(n.TypeCast)) return strConst(n.TypeCast.arg);
  const c = n.A_Const;
  return isObj(c) && isObj(c.sval) && typeof c.sval.sval === "string" ? c.sval.sval : undefined;
}

// Duyệt cả cây để bắt `SET role` trong SET của hàm và `set_config` lồng trong biểu thức.
function reasonInTree(n: unknown): GuardReason | undefined {
  if (Array.isArray(n)) {
    for (const x of n) {
      const r = reasonInTree(x);
      if (r) return r;
    }
    return undefined;
  }
  if (!isObj(n)) return undefined;
  const vs = n.VariableSetStmt;
  if (isObj(vs)) {
    if (vs.kind === "VAR_RESET_ALL") return "guard.resetAll";
    if (typeof vs.name === "string" && SENSITIVE_GUC.has(vs.name.toLowerCase())) return "guard.role";
  }
  const fc = n.FuncCall;
  if (isObj(fc) && Array.isArray(fc.funcname)) {
    const last = fc.funcname.at(-1) as Obj | undefined;
    const name = isObj(last) && isObj(last.String) ? last.String.sval : undefined;
    if (name === "set_config") {
      const first = strConst(Array.isArray(fc.args) ? fc.args[0] : undefined);
      // Tên tham số không phải hằng chuỗi thì không biết được, chặn luôn.
      if (first === undefined || SENSITIVE_GUC.has(first.toLowerCase())) return "guard.role";
    }
  }
  for (const v of Object.values(n)) {
    const r = reasonInTree(v);
    if (r) return r;
  }
  return undefined;
}

const BY_KIND: Record<string, GuardReason> = {
  CreateExtensionStmt: "guard.extension",
  LoadStmt: "guard.load",
  CreateRoleStmt: "guard.roleDdl",
  AlterRoleStmt: "guard.roleDdl",
  AlterRoleSetStmt: "guard.roleDdl",
  AlterDatabaseSetStmt: "guard.roleDdl",
  DropRoleStmt: "guard.roleDdl",
  GrantStmt: "guard.grant",
  GrantRoleStmt: "guard.grant",
  AlterDefaultPrivilegesStmt: "guard.grant",
};

function reasonOf(stmt: Obj): GuardReason | undefined {
  const kind = Object.keys(stmt)[0];
  const body = stmt[kind];
  if (BY_KIND[kind]) return BY_KIND[kind];
  if (kind === "CopyStmt" && isObj(body) && body.is_program) return "guard.copyProgram";
  if (kind === "DiscardStmt" && isObj(body) && body.target === "DISCARD_ALL") return "guard.resetAll";
  return reasonInTree(stmt);
}

/** Lớp một. statementIndex đếm từ 1. Câu parser không đọc được thì cho qua, lớp hai sẽ kiểm. */
export function checkUserSql(sql: string): GuardResult {
  if (!ready) return { ok: true };
  let stmts: unknown;
  try {
    stmts = (parseSync(sql) as { stmts?: unknown }).stmts;
  } catch {
    
    return { ok: true };
  }
  if (!Array.isArray(stmts)) return { ok: true };
  for (let i = 0; i < stmts.length; i++) {
    const s = (stmts[i] as Obj).stmt;
    const reason = isObj(s) ? reasonOf(s) : undefined;
    if (reason) return { ok: false, reasonKey: reason, statementIndex: i + 1 };
  }
  return { ok: true };
}
