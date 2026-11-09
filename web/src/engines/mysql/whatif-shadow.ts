import type { Outcome } from "@/contracts/conclusion";
import type { ProbeStats, QueryResult, TryChangeResult } from "@/contracts/engine";
import { splitMysql } from "@/modules/sql-intake/parser/core";

export interface ChangeParseResult {
  targetTable: string;
  shadowTable: string;
  rewrittenChange: string;
}

const no = (reason: string): Outcome<TryChangeResult> => ({ kind: "not_simulated", reasonKey: `tryChange.${reason}` });
const EXPLAINABLE = /^\s*(select|insert|update|delete|replace|with)\b/i;

// 1. CREATE [UNIQUE] INDEX [IF NOT EXISTS] [index_name] ON [db.]table (col...) [options]
const CREATE_INDEX_RE = /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`?[a-zA-Z0-9_$]+`?\s+)?ON\s+(?:`?([a-zA-Z0-9_$]+)`?\.)?`?([a-zA-Z0-9_$]+)`?\s*(\([\s\S]*)$/i;

// 2. ALTER TABLE [db.]table ADD ...
const ALTER_TABLE_RE = /^\s*ALTER\s+TABLE\s+(?:`?([a-zA-Z0-9_$]+)`?\.)?`?([a-zA-Z0-9_$]+)`?\s+(ADD\b[\s\S]*)$/i;

// 3. DROP INDEX index_name ON [db.]table
const DROP_INDEX_RE = /^\s*DROP\s+INDEX\s+`?[a-zA-Z0-9_$]+`?\s+ON\s+(?:`?([a-zA-Z0-9_$]+)`?\.)?`?([a-zA-Z0-9_$]+)`?\s*$/i;

/** Phân tích câu lệnh DDL thay đổi và sinh câu lệnh trỏ vào bảng shadow __whatif_<targetTable>. */
export function parseAndRewriteChange(changeSql: string): ChangeParseResult | null {
  const trimmed = changeSql.trim().replace(/;+\s*$/, "");

  // CREATE INDEX
  const mCreate = CREATE_INDEX_RE.exec(trimmed);
  if (mCreate) {
    const db = mCreate[1];
    const targetTable = mCreate[2];
    const shadowTable = `__whatif_${targetTable}`;
    const onIndex = trimmed.search(/\bON\b/i);
    const prefix = trimmed.slice(0, onIndex + 2);
    const dbPrefix = db ? `\`${db}\`.` : "";
    const rest = mCreate[3];
    return {
      targetTable,
      shadowTable,
      rewrittenChange: `${prefix} ${dbPrefix}\`${shadowTable}\` ${rest}`,
    };
  }

  // ALTER TABLE
  const mAlter = ALTER_TABLE_RE.exec(trimmed);
  if (mAlter) {
    const db = mAlter[1];
    const targetTable = mAlter[2];
    const shadowTable = `__whatif_${targetTable}`;
    const dbPrefix = db ? `\`${db}\`.` : "";
    const rest = mAlter[3];
    return {
      targetTable,
      shadowTable,
      rewrittenChange: `ALTER TABLE ${dbPrefix}\`${shadowTable}\` ${rest}`,
    };
  }

  // DROP INDEX
  const mDrop = DROP_INDEX_RE.exec(trimmed);
  if (mDrop) {
    const db = mDrop[1];
    const targetTable = mDrop[2];
    const shadowTable = `__whatif_${targetTable}`;
    const onIndex = trimmed.search(/\bON\b/i);
    const prefix = trimmed.slice(0, onIndex + 2);
    const dbPrefix = db ? `\`${db}\`.` : "";
    return {
      targetTable,
      shadowTable,
      rewrittenChange: `${prefix} ${dbPrefix}\`${shadowTable}\``,
    };
  }

  return null;
}

/** Biến đổi câu query thăm dò (probe) trỏ các tham chiếu của bảng targetTable sang shadowTable __whatif_*. */
export function rewriteProbeQuery(probeSql: string, targetTable: string, shadowTable: string): string {
  const targetLower = targetTable.toLowerCase();
  const shadowIdent = `\`${shadowTable}\``;
  let out = "";
  let i = 0;
  const len = probeSql.length;

  while (i < len) {
    const ch = probeSql[i];
    const two = probeSql.slice(i, i + 2);

    // 1. Block comment /* ... */
    if (two === "/*") {
      const end = probeSql.indexOf("*/", i + 2);
      const close = end < 0 ? len : end + 2;
      out += probeSql.slice(i, close);
      i = close;
      continue;
    }

    // 2. Line comment -- or #
    if (ch === "#" || (two === "--" && (i + 2 >= len || /\s/.test(probeSql[i + 2])))) {
      const end = probeSql.indexOf("\n", i);
      const close = end < 0 ? len : end + 1;
      out += probeSql.slice(i, close);
      i = close;
      continue;
    }

    // 3. String literals '...' or "..."
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < len) {
        if (probeSql[j] === "\\") {
          j += 2;
        } else if (probeSql[j] === ch) {
          if (probeSql[j + 1] === ch) j += 2;
          else {
            j++;
            break;
          }
        } else {
          j++;
        }
      }
      out += probeSql.slice(i, j);
      i = j;
      continue;
    }

    // 4. Backtick identifier `...`
    if (ch === "`") {
      let j = i + 1;
      while (j < len && probeSql[j] !== "`") j++;
      const close = j < len ? j + 1 : len;
      const ident = probeSql.slice(i + 1, j);
      if (ident.toLowerCase() === targetLower) {
        out += shadowIdent;
      } else {
        out += probeSql.slice(i, close);
      }
      i = close;
      continue;
    }

    // 5. Plain identifier / word [a-zA-Z0-9_$]+
    if (/[a-zA-Z0-9_$]/.test(ch)) {
      let j = i + 1;
      while (j < len && /[a-zA-Z0-9_$]/.test(probeSql[j])) j++;
      const word = probeSql.slice(i, j);
      if (word.toLowerCase() === targetLower) {
        out += shadowIdent;
      } else {
        out += word;
      }
      i = j;
      continue;
    }

    // 6. Ký tự khác
    out += ch;
    i++;
  }

  return out;
}

/** Trích xuất chi phí (query_cost), kiểu quét (access_type) và số dòng duyệt (rows_examined_per_scan). */
export function extractMysqlProbeStats(raw: unknown): { stats: ProbeStats; plan: unknown } {
  const plan = typeof raw === "string" ? JSON.parse(raw) : raw;
  let totalCost = 0;
  let totalRowsExamined = 0;
  const accessTypes: string[] = [];

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    // query_block cost_info
    if (obj.cost_info && typeof obj.cost_info === "object") {
      const c = obj.cost_info as Record<string, unknown>;
      if (c.query_cost !== undefined) {
        const n = Number(c.query_cost);
        if (Number.isFinite(n) && n > totalCost) totalCost = n;
      }
    }

    // table
    if (obj.table && typeof obj.table === "object") {
      const t = obj.table as Record<string, unknown>;
      if (typeof t.access_type === "string") accessTypes.push(t.access_type);
      if (t.rows_examined_per_scan !== undefined) {
        const r = Number(t.rows_examined_per_scan);
        if (Number.isFinite(r)) totalRowsExamined += r;
      }
    }

    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) {
        val.forEach(walk);
      } else if (typeof val === "object" && val !== null) {
        walk(val);
      }
    }
  }

  walk(plan);

  return {
    stats: {
      rows: totalRowsExamined,
      sharedHitBlocks: 0,
      sharedReadBlocks: Math.max(1, Math.ceil(totalCost)),
      nodeTypes: [...new Set(accessTypes)],
    },
    plan,
  };
}

/**
 * Thực hiện Thử sửa What-if trên MySQL bằng Bảng Shadow (__whatif_*).
 * Đo đạc trước/sau bằng EXPLAIN FORMAT=JSON và tự động dọn dẹp bằng DROP TABLE IF EXISTS trong finally.
 */
export async function runMysqlWhatif(
  exec: (sql: string) => Promise<QueryResult[]>,
  change: string,
  probe: string,
): Promise<Outcome<TryChangeResult>> {
  const pStmts = splitMysql(probe);
  if (pStmts.length === 0) return no("empty");
  if (pStmts.length > 1) return no("probeSingle");
  if (!EXPLAINABLE.test(probe)) return no("unsupported");

  if (/\b(begin|commit|rollback|start\s+transaction|savepoint)\b/i.test(change)) return no("transaction");

  const cStmts = splitMysql(change);
  if (cStmts.length === 0) return no("empty");
  if (cStmts.length > 1) return no("singleChange");

  const parsed = parseAndRewriteChange(change);
  if (!parsed) return no("unsupportedDdl");

  const { targetTable, shadowTable, rewrittenChange } = parsed;
  const rewrittenProbe = rewriteProbeQuery(probe, targetTable, shadowTable);

  // 1. Đo kế hoạch trước khi thay đổi trên bảng thật
  let before: { stats: ProbeStats; plan: unknown };
  try {
    const beforeRes = await exec(`EXPLAIN FORMAT=JSON ${probe}`);
    before = extractMysqlProbeStats(beforeRes[0]?.rows[0]?.[0]);
  } catch {
    return no("unsupported");
  }

  // 2. Vòng đời Bảng Shadow với bảo đảm dọn dẹp tuyệt đối trong finally
  const shadowSql = `\`${shadowTable}\``;
  const targetSql = `\`${targetTable}\``;
  let shadowCreated = false;

  try {
    // Dọn bảng shadow cũ nếu lỡ còn sót
    await exec(`DROP TABLE IF EXISTS ${shadowSql}`);

    // Clone cấu trúc bảng
    await exec(`CREATE TABLE ${shadowSql} LIKE ${targetSql}`);
    shadowCreated = true;

    // Sao chép tối đa 10.000 dòng để bảo vệ quota 50MB (AC1, AC4)
    await exec(`INSERT INTO ${shadowSql} SELECT * FROM ${targetSql} LIMIT 10000`);

    // Thực thi câu lệnh DDL trên bảng shadow
    await exec(rewrittenChange);

    // Đo kế hoạch sau khi thay đổi trên bảng shadow
    const afterRes = await exec(`EXPLAIN FORMAT=JSON ${rewrittenProbe}`);
    const after = extractMysqlProbeStats(afterRes[0]?.rows[0]?.[0]);

    const pages = (s: ProbeStats) => s.sharedHitBlocks + s.sharedReadBlocks;
    return {
      kind: "conclusion",
      label: "real",
      data: {
        before: before.stats,
        after: after.stats,
        plans: { before: before.plan, after: after.plan },
      },
      evidence: [
        { kind: "pages_before", messageKey: "tryChange.pagesBefore", values: { pages: pages(before.stats) } },
        { kind: "pages_after", messageKey: "tryChange.pagesAfter", values: { pages: pages(after.stats) } },
      ],
    };
  } finally {
    // AC3: Luôn dọn dẹp sạch sẽ trong finally, kể cả khi DDL lỗi
    if (shadowCreated) {
      try {
        await exec(`DROP TABLE IF EXISTS ${shadowSql}`);
      } catch {
        /* Bỏ qua lỗi dọn dẹp để không che lấp lỗi chính */
      }
    }
  }
}
