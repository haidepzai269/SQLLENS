export type Piece = { kind: "text"; text: string } | { kind: "sql"; sql: string };

const SQL_LANGS = new Set(["", "sql", "pgsql", "postgresql", "postgres", "mysql"]);
const OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;

/** Tách câu trả lời Markdown thành văn bản và khối SQL, giữ nguyên thứ tự. Khối chưa đóng kéo dài đến hết. Khối ngôn ngữ khác giữ nguyên là text. */
export function splitAnswer(answer: string): Piece[] {
  const out: Piece[] = [];
  const text = (t: string) => {
    if (!t) return;
    const last = out.at(-1);
    if (last?.kind === "text") last.text += t;
    else out.push({ kind: "text", text: t });
  };
  const lines = answer.split(/(?<=\n)/);
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i].replace(/\r?\n$/, ""));
    if (!m) {
      text(lines[i]);
      continue;
    }
    const fence = m[1];
    let j = i + 1;
    const body: string[] = [];
    // Dòng đóng: chỉ gồm cùng ký tự rào, không ngắn hơn dòng mở.
    const closes = (l: string) => {
      const t = l.replace(/\r?\n$/, "").trim();
      return t.length >= fence.length && t === fence[0].repeat(t.length) && /^ {0,3}\S/.test(l);
    };
    while (j < lines.length && !closes(lines[j])) body.push(lines[j++]);
    if (SQL_LANGS.has(m[2].toLowerCase())) out.push({ kind: "sql", sql: body.join("").trim() });
    else text(lines.slice(i, Math.min(j + 1, lines.length)).join(""));
    i = j;
  }
  return out;
}
