// Rào chắn SQL cho SQLite: SQL người dùng chạy trong WASM trong trình duyệt, nhưng ATTACH, DETACH,
// VACUUM INTO và load_extension() mở được đường ra ngoài hộp kín (file, thư viện động), nên chặn trước
// khi chạy bất cứ câu nào. Không sửa câu, không cắt câu: chỉ đọc rồi trả lời chạy được hay không.

export type SqliteGuardReason = "attach" | "vacuum_into" | "load_extension" | "attach_hidden";
export type SqliteGuardResult = { ok: true } | { ok: false; reason: SqliteGuardReason };

// Mỗi lý do một câu trong messages/<locale>/guard.json, đọc qua useTranslations() gốc.
export const SQLITE_GUARD_MESSAGE_KEY: Record<SqliteGuardReason, string> = {
  attach: "guard.sqlite.attach",
  vacuum_into: "guard.sqlite.vacuumInto",
  load_extension: "guard.sqlite.loadExtension",
  attach_hidden: "guard.sqlite.attachHidden",
};

const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
const isWord = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$";

/**
 * Đọc SQL như SQLite đọc: chuỗi, định danh có bọc và comment bị bỏ qua, nên `SELECT 'ATTACH'` không phải lệnh.
 * ATTACH/DETACH/VACUUM chỉ bị chặn khi đứng đầu một câu lệnh (sau `;` hoặc `EXPLAIN`), vì đây là các lệnh
 * chỉ hợp lệ ở vị trí đó — nhờ vậy `CREATE TABLE t (attach text)` vẫn chạy được.
 * `load_extension` bị chặn ở mọi vị trí (SQLite cho gọi như hàm trong biểu thức).
 * Câu không đọc hết được (chuỗi/comment/định danh chưa đóng) thì `attach_hidden`: phần còn lại có thể giấu lệnh.
 */
export function assertSqliteSafe(sql: string): SqliteGuardResult {
  let i = 0;
  let atStart = true; // câu hiện tại chưa có từ khóa nào
  let vacuum = false; // câu hiện tại bắt đầu bằng VACUUM
  const len = sql.length;

  while (i < len) {
    const c = sql[i];
    const next = sql[i + 1];

    if (isSpace(c)) {
      i++;
      continue;
    }

    // Comment dòng: -- ... hết dòng (SQLite cũng nhận -- ngay sau ký tự bất kỳ).
    if (c === "-" && next === "-") {
      const nl = sql.indexOf("\n", i + 2);
      i = nl < 0 ? len : nl + 1;
      continue;
    }

    // Comment khối: /* ... */
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) return { ok: false, reason: "attach_hidden" };
      i = end + 2;
      continue;
    }

    if (c === ";") {
      atStart = true;
      vacuum = false;
      i++;
      continue;
    }

    // Chuỗi: 'abc''def'. Không đóng chuỗi thì không biết phần sau là gì.
    if (c === "'") {
      let j = i + 1;
      for (; j < len; j++) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") j++;
          else break;
        }
      }
      if (j >= len) return { ok: false, reason: "attach_hidden" };
      i = j + 1;
      atStart = false;
      continue;
    }

    // Định danh có bọc: "..." `...` [...]. Tên bọc vẫn gọi được hàm, nên vẫn so `load_extension`.
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      let name = "";
      for (; j < len; j++) {
        const ch = sql[j];
        if (ch === close) {
          if (close !== "]" && sql[j + 1] === close) {
            name += ch;
            j++;
            continue;
          }
          break;
        }
        name += ch;
      }
      if (j >= len) return { ok: false, reason: "attach_hidden" };
      // `[load_extension](...)` / `"load_extension"(...)` vẫn là lời gọi hàm.
      if (name.toUpperCase() === "LOAD_EXTENSION" && sql.slice(j + 1).trimStart().startsWith("(")) {
        return { ok: false, reason: "load_extension" };
      }
      i = j + 1;
      atStart = false;
      continue;
    }

    if (isWord(c)) {
      let j = i;
      while (j < len && isWord(sql[j])) j++;
      const word = sql.slice(i, j).toUpperCase();
      i = j;

      if (word === "LOAD_EXTENSION") return { ok: false, reason: "load_extension" };

      if (atStart) {
        // EXPLAIN đứng trước câu thật (EXPLAIN ATTACH ... vẫn chặn).
        if (word === "EXPLAIN") continue;
        atStart = false;
        if (word === "ATTACH" || word === "DETACH") return { ok: false, reason: "attach" };
        if (word === "VACUUM") vacuum = true;
      } else if (vacuum && word === "INTO") {
        return { ok: false, reason: "vacuum_into" };
      }
      continue;
    }

    atStart = false;
    i++;
  }

  return { ok: true };
}
