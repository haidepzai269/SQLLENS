import type { EngineId } from "@/contracts/engine";

export type PrepareResult = { sql: string; removed: { copyBlocks: number; lockStatements: number } };

const COPY_STDIN = /^copy\s[^;]*\sfrom\s+stdin\b[^;\n]*;[ \t]*\r?$/i;
const LOCK = /^(lock|unlock)\s+tables?\b[^;]*;[ \t]*\r?$/i;

// Quét một lượt, chỉ nhìn đầu dòng khi đang ở ngoài chuỗi, comment và dollar-quote, nên `COPY` hay `\.` trong chuỗi INSERT không bị cắt.
// shortcut: không xử lý `DELIMITER` của MySQL (khớp parser), thêm khi Task028 hỗ trợ.
export function prepareDump(sql: string, engine: EngineId): PrepareResult {
  const removed = { copyBlocks: 0, lockStatements: 0 };
  const pg = engine === "postgres";
  const n = sql.length;
  const parts: string[] = [];
  let keep = 0; // đầu đoạn chưa chép
  let i = 0;
  let atLineStart = true;
  let noTerminator = false; // đã quét tới cuối file mà không thấy `\.`, các COPY sau cũng không có: tránh quét lại O(n²)

  const lineEnd = (from: number) => {
    const e = sql.indexOf("\n", from);
    return e < 0 ? n : e + 1;
  };
  const skip = (from: number, to: number) => {
    parts.push(sql.slice(keep, from));
    keep = to;
    i = to;
    atLineStart = true;
  };

  while (i < n) {
    const c = sql[i];
    if (atLineStart) {
      atLineStart = false;
      const eol = lineEnd(i);
      const line = sql.slice(i, eol).replace(/\n$/, "");
      if (pg && c === "\\") {
        skip(i, eol); // lệnh psql như \connect
        continue;
      }
      if (pg && !noTerminator && COPY_STDIN.test(line)) {
        let p = eol;
        let end = -1;
        while (p < n) {
          const e = lineEnd(p);
          if (sql.slice(p, e).replace(/\r?\n$/, "") === "\\.") { end = e; break; }
          p = e;
        }
        if (end >= 0) { removed.copyBlocks++; skip(i, end); continue; }
        noTerminator = true;
        // Thiếu `\.`: giữ nguyên, để parse báo lỗi thay vì xóa nhầm phần sau.
      } else if (!pg && LOCK.test(line)) {
        removed.lockStatements++;
        skip(i, eol);
        continue;
      }
    }
    if (c === "\n") { atLineStart = true; i++; continue; }
    if (c === "'" || c === '"' || (!pg && c === "`")) {
      const esc = c !== "`" && (!pg || (c === "'" && /[eE]/.test(sql[i - 1] ?? "")));
      i++;
      while (i < n) {
        if (esc && sql[i] === "\\") i += 2;
        else if (sql[i] === c) { if (sql[i + 1] === c) i += 2; else break; }
        else i++;
      }
      i++;
    } else if (c === "-" && sql[i + 1] === "-") i = sql.indexOf("\n", i) < 0 ? n : sql.indexOf("\n", i);
    else if (c === "/" && sql[i + 1] === "*") {
      const e = sql.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
    } else if (pg && c === "$") {
      const m = /^\$([A-Za-z_\x80-￿][\w\x80-￿]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const e = sql.indexOf(m[0], i + m[0].length);
        i = e < 0 ? n : e + m[0].length;
      } else i++;
    } else i++;
  }
  parts.push(sql.slice(keep));
  return { sql: parts.join(""), removed };
}
