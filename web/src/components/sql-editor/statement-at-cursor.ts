/**
 * Phân tích và bóc tách câu lệnh SQL tại vị trí con trỏ (dựa theo dấu chấm phẩy ; hợp lệ).
 * Bỏ qua dấu ; bên trong string literals, dollar quoting, và comments.
 */

export type StatementSpan = {
  start: number;
  end: number;
  text: string;
};

export type DetailedStatementSpan = StatementSpan & {
  semicolonIndex?: number;
};

/**
 * Tách script SQL thành danh sách các câu lệnh theo dấu `;` kèm thông tin vị trí dấu `;`.
 */
export function splitSqlStatementsDetailed(sql: string): DetailedStatementSpan[] {
  const spans: DetailedStatementSpan[] = [];
  let first = -1;
  let i = 0;

  const pushStatement = (startIdx: number, endIdx: number, semiIdx?: number) => {
    let s = startIdx;
    let e = endIdx;
    while (s < e && /\s/.test(sql[s])) s++;
    while (e > s && /\s/.test(sql[e - 1])) e--;
    if (s < e) {
      spans.push({ start: s, end: e, text: sql.slice(s, e), semicolonIndex: semiIdx });
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
        pushStatement(first, i, i);
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
    pushStatement(first, sql.length, undefined);
  }

  return spans;
}

/**
 * Tách script SQL thành danh sách các câu lệnh theo dấu `;`.
 */
export function splitSqlStatements(sql: string): StatementSpan[] {
  return splitSqlStatementsDetailed(sql).map(({ start, end, text }) => ({ start, end, text }));
}

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/#.*$/gm, " ");
}

function normalizeSqlForMatch(s: string): string {
  return stripComments(s)
    .trim()
    .replace(/;+$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Tính toán chuỗi tài liệu mới, định vị chính xác vị trí câu lệnh targetSql trong fullDoc
 * (kết hợp errorPosition nếu có nhiều câu lệnh giống nhau) và thay thế bằng replacementSql,
 * bảo toàn 100% các câu lệnh trước và sau, định dạng và comments xung quanh.
 */
export function applyStatementFix(
  fullDoc: string,
  targetSql: string,
  replacementSql: string,
  errorPosition?: number
): string {
  // Edge case 1: Tài liệu rỗng hoặc chỉ có khoảng trắng
  if (!fullDoc || fullDoc.trim() === "") {
    return replacementSql;
  }

  // Edge case 2: Không có replacementSql
  if (replacementSql === undefined || replacementSql === null) {
    return fullDoc;
  }

  const spans = splitSqlStatementsDetailed(fullDoc);

  // Không bóc tách được câu lệnh nào trong fullDoc (ví dụ chỉ có comment)
  if (spans.length === 0) {
    return fullDoc.trim() === "" ? replacementSql : `${fullDoc}\n${replacementSql}`;
  }

  const normTarget = normalizeSqlForMatch(targetSql);
  const normFullDoc = normalizeSqlForMatch(fullDoc);
  const replSpans = splitSqlStatementsDetailed(replacementSql);

  // AC1: Trường hợp đơn câu lệnh
  if (spans.length === 1) {
    const single = spans[0];
    const replEndsWithSemi = replacementSql.trim().endsWith(";");
    const replaceFrom = single.start;
    let replaceTo = single.end;
    if (single.semicolonIndex !== undefined) {
      replaceTo = replEndsWithSemi ? single.semicolonIndex + 1 : single.semicolonIndex;
    }
    return fullDoc.slice(0, replaceFrom) + replacementSql.trim() + fullDoc.slice(replaceTo);
  }

  // AC2 & AC3: Đa câu lệnh trong fullDoc
  // Nếu targetSql bao trùm toàn bộ fullDoc (chạy toàn bộ script) và replacementSql cũng có nhiều câu lệnh
  // (ví dụ: kết quả từ Quick-Fix đã thay thế sẵn trên fullDoc)
  if (normTarget === normFullDoc && replSpans.length > 1) {
    return replacementSql;
  }

  // Tìm các span ứng viên khớp với targetSql
  let candidates: DetailedStatementSpan[] = [];
  if (normTarget !== "" && normTarget !== normFullDoc) {
    // 1. Khớp chính xác nội dung câu lệnh
    candidates = spans.filter((s) => normalizeSqlForMatch(s.text) === normTarget);

    // 2. Nếu không khớp chính xác, tìm câu lệnh chứa hoặc được chứa trong targetSql
    if (candidates.length === 0) {
      candidates = spans.filter((s) => {
        const n = normalizeSqlForMatch(s.text);
        return n.includes(normTarget) || normTarget.includes(n);
      });
    }
  }

  // Nếu không tìm thấy candidate nào, hoặc targetSql là toàn bộ script nhưng replacementSql là 1 câu đơn
  if (candidates.length === 0) {
    candidates = spans;
  }

  // Chọn span mục tiêu từ danh sách candidates:
  let targetSpan: DetailedStatementSpan;

  if (errorPosition !== undefined && Number.isFinite(errorPosition) && errorPosition > 0) {
    // errorPosition thường là 1-based index (Postgres/MySQL)
    const pos0 = errorPosition - 1;

    // Tìm span trong candidates mà pos0 nằm trong phạm vi của nó
    const enclosing = candidates.find((s) => {
      const bound = s.semicolonIndex !== undefined ? s.semicolonIndex + 1 : s.end;
      return pos0 >= s.start && pos0 <= bound;
    });

    if (enclosing) {
      targetSpan = enclosing;
    } else {
      // Nếu pos0 không nằm lọt bên trong span nào, tìm span gần pos0 nhất
      let best = candidates[0];
      let minDist = Infinity;
      for (const sp of candidates) {
        let dist = 0;
        if (pos0 < sp.start) dist = sp.start - pos0;
        else if (pos0 > sp.end) dist = pos0 - sp.end;
        if (dist < minDist) {
          minDist = dist;
          best = sp;
        }
      }
      targetSpan = best;
    }
  } else {
    // Không có errorPosition, lấy candidate đầu tiên
    targetSpan = candidates[0];
  }

  // Tiến hành thay thế targetSpan bằng replacementSql
  const replEndsWithSemi = replacementSql.trim().endsWith(";");
  const replaceFrom = targetSpan.start;
  let replaceTo = targetSpan.end;

  if (targetSpan.semicolonIndex !== undefined) {
    // Nếu replacementSql đã có dấu ; ở cuối thì thay luôn dấu ; cũ trong doc
    // Nếu replacementSql không có dấu ; thì giữ lại dấu ; cũ
    replaceTo = replEndsWithSemi ? targetSpan.semicolonIndex + 1 : targetSpan.semicolonIndex;
  }

  return fullDoc.slice(0, replaceFrom) + replacementSql.trim() + fullDoc.slice(replaceTo);
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
