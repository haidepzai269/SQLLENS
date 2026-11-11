/**
 * Phân tích và bóc tách câu lệnh SQL tại vị trí con trỏ (dựa theo dấu chấm phẩy ; hợp lệ).
 * Bỏ qua dấu ; bên trong string literals, dollar quoting, và comments.
 */

export type StatementSpan = {
  start: number;
  end: number;
  text: string;
};

/**
 * Tách script SQL thành danh sách các câu lệnh theo dấu `;`.
 */
export function splitSqlStatements(sql: string): StatementSpan[] {
  const spans: StatementSpan[] = [];
  let first = -1;
  let i = 0;

  const pushStatement = (startIdx: number, endIdx: number) => {
    let s = startIdx;
    let e = endIdx;
    while (s < e && /\s/.test(sql[s])) s++;
    while (e > s && /\s/.test(sql[e - 1])) e--;
    if (s < e) {
      spans.push({ start: s, end: e, text: sql.slice(s, e) });
    }
  };

  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);

    // Block comment: /* ... */
    if (two === "/*") {
      const j = sql.indexOf("*/", i + 2);
      i = j < 0 ? sql.length : j + 2;
      continue;
    }

    // Line comments: -- or #
    if (two === "--" && (i + 2 >= sql.length || /\s/.test(sql[i + 2]))) {
      const j = sql.indexOf("\n", i + 2);
      i = j < 0 ? sql.length : j + 1;
      continue;
    }
    if (c === "#") {
      const j = sql.indexOf("\n", i + 1);
      i = j < 0 ? sql.length : j + 1;
      continue;
    }

    // Dollar quote của Postgres: $$...$$ hoặc $tag$...$tag$
    if (c === "$") {
      const match = sql.slice(i).match(/^\$([a-zA-Z0-9_]*)\$/);
      if (match) {
        const tag = match[0];
        if (first < 0) first = i;
        const closeIdx = sql.indexOf(tag, i + tag.length);
        if (closeIdx >= 0) {
          i = closeIdx + tag.length;
        } else {
          i = sql.length;
        }
        continue;
      }
    }

    // Strings & Quoted identifiers: '...', "...", `...`
    if (c === "'" || c === '"' || c === "`") {
      if (first < 0) first = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === "\\" && c !== "`") {
          i += 2;
        } else if (sql[i] === c) {
          if (sql[i + 1] === c) {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      continue;
    }

    // Semicolon separator
    if (c === ";") {
      if (first >= 0) {
        pushStatement(first, i);
        first = -1;
      }
      i++;
      continue;
    }

    // Whitespace hoặc ký tự code thường
    if (!/\s/.test(c) && first < 0) {
      first = i;
    }
    i++;
  }

  if (first >= 0) {
    pushStatement(first, sql.length);
  }

  return spans;
}

/**
 * Lấy câu lệnh SQL tại vị trí con trỏ (offset).
 * Nếu con trỏ nằm giữa các khoảng trắng, trả về câu lệnh gần nhất có nội dung.
 * Nếu editor không có câu lệnh hợp lệ nào, trả về null.
 */
export function getStatementAtOffset(sql: string, offset: number): string | null {
  const spans = splitSqlStatements(sql);
  if (spans.length === 0) return null;

  // 1. Nếu offset nằm trong [start, end] của câu lệnh nào đó (kể cả ngay tại biên)
  for (const span of spans) {
    if (offset >= span.start && offset <= span.end) {
      return span.text;
    }
  }

  // 2. Tìm câu lệnh có khoảng cách tới offset nhỏ nhất
  let nearest: StatementSpan = spans[0];
  let minDistance = Infinity;

  for (const span of spans) {
    let distance = 0;
    if (offset < span.start) {
      distance = span.start - offset;
    } else if (offset > span.end) {
      distance = offset - span.end;
    }
    if (distance < minDistance) {
      minDistance = distance;
      nearest = span;
    }
  }

  return nearest.text;
}
