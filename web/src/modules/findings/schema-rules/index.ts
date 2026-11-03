import type { RuleHit } from "@/contracts/finding";
import type { EngineId } from "@/contracts/engine";
import type { ParsedStatement } from "../../sql-intake/parser/types";
import type { Col, Ev } from "./events";
import { mysqlEvents } from "./mysql";
import { postgresEvents } from "./postgres";

// varchar dài hơn mức này: MySQL cần 2 byte độ dài và bảng tạm/sort cấp đủ độ dài khai báo;
// PostgreSQL không tốn thêm, nhưng độ dài lớn thường là dấu hiệu chưa chọn giới hạn thật cho dữ liệu.
export const VARCHAR_THRESHOLD = 255;
const MONEY = new Set(["price", "amount", "total", "cost", "balance"]);

type Where = { index: number; start: number; end: number };
type Table = {
  name: string;
  at: Where;
  opaque: boolean;
  pk: boolean;
  pkName?: string;
  pkCols?: string[];
  cols: Map<string, { col: Col; at: Where }>;
  idx: string[][];
  fks: { cols: string[]; at: Where }[];
};

// Gợi ý cho STR041: vị trí là của cả câu lệnh vì parser không trả vị trí từng cột.
const pos = (w: Where) => ({ statementIndex: w.index, start: w.start, end: w.end });

/**
 * Đọc CREATE TABLE, ALTER TABLE, CREATE INDEX, DROP TABLE theo thứ tự và trả các rủi ro thiết kế của trạng thái cuối.
 * Câu parser không đọc được thì không có trong `statements`; câu lạ hoặc ALTER bảng chưa khai báo thì bị bỏ qua.
 * shortcut: không theo dõi RENAME, DROP INDEX, DROP CONSTRAINT khác khóa chính; thêm khi có ca thực tế.
 */
export function checkSchema(statements: ParsedStatement[], engine: EngineId): RuleHit[] {
  const mysql = engine === "mysql";
  const fold = (s: string) => (mysql ? s.toLowerCase() : s);
  const tables = new Map<string, Table>();

  for (const st of statements) {
    let evs: Ev[];
    try {
      evs = st.ast && typeof st.ast === "object" ? (mysql ? mysqlEvents(st.ast) : postgresEvents(st.ast)) : [];
    } catch {
      continue; // AST hình dạng lạ: bỏ qua câu này
    }
    const at = { index: st.index, start: st.start, end: st.end };
    for (const e of evs) {
      const key = fold(e.t);
      if (e.k === "table") {
        if (e.skipIfExists && tables.has(key)) break; // bỏ cả các sự kiện còn lại của câu; CREATE TABLE IF NOT EXISTS trên bảng đã có là no-op
        const cols = new Map<string, { col: Col; at: Where }>();
        e.cols.forEach((col) => cols.set(fold(col.name), { col, at }));
        tables.set(key, { name: e.t, at, opaque: e.opaque, pk: false, cols, idx: [], fks: [] });
        continue;
      }
      if (e.k === "drop") {
        tables.delete(key);
        continue;
      }
      const t = tables.get(key);
      if (!t) continue; // bảng không khai báo trong đoạn SQL này nên chưa biết gì về nó
      if (e.k === "col") {
        const c = fold(e.col.name);
        // ADD COLUMN IF NOT EXISTS trên cột đã có là no-op; chỉ ALTER TYPE/MODIFY/CHANGE mới đổi kiểu.
        if (e.mod || !t.cols.has(c)) t.cols.set(c, { col: e.col, at });
      }
      else if (e.k === "dropcol") {
        const c = fold(e.c);
        t.cols.delete(c);
        t.fks = t.fks.filter((f) => !f.cols.some((x) => fold(x) === c));
      } else if (e.k === "pk") {
        t.pk = true;
        t.pkName = e.name ?? `${e.t.split(".").pop()}_pkey`;
        t.pkCols = e.cols.map(fold);
        t.idx.push(t.pkCols);
      } else if (e.k === "droppk") {
        if (!e.name || e.name === t.pkName) {
          t.pk = false;
          const i = t.idx.findIndex((x) => x === t.pkCols); // index của khóa chính biến mất theo nó
          if (i >= 0) t.idx.splice(i, 1);
        }
      } else if (e.k === "idx") t.idx.push(e.cols.map(fold));
      else if (e.k === "fk" && !t.fks.some((f) => f.cols.join() === e.cols.join())) t.fks.push({ cols: e.cols, at });
    }
  }

  const hits: RuleHit[] = [];
  for (const t of tables.values()) {
    if (!t.pk && !t.opaque) hits.push({ ruleId: "missing-pk", messageKey: "findings.schema.missing-pk", table: t.name, ...pos(t.at) });

    // InnoDB tự tạo index cho cột FK nếu chưa có, nên MySQL không bao giờ thiếu index này.
    if (!mysql) {
      for (const f of t.fks) {
        const want = new Set(f.cols);
        const covered = t.idx.some((ix) => ix.length >= want.size && ix.slice(0, want.size).every((c) => want.has(c)));
        if (!covered)
          hits.push({ ruleId: "fk-no-index", messageKey: "findings.schema.fk-no-index", table: t.name, column: f.cols.join(", "), values: { columns: f.cols.join(", ") }, ...pos(f.at) });
      }
    }

    for (const { col, at } of t.cols.values()) {
      if (MONEY.has(col.name.toLowerCase()) && col.type === "float")
        hits.push({ ruleId: "float-money", messageKey: "findings.schema.float-money", table: t.name, column: col.name, values: { type: col.type }, ...pos(at) });
      if (col.type === "varchar" && (col.len ?? 0) > VARCHAR_THRESHOLD)
        hits.push({ ruleId: "varchar-too-large", messageKey: "findings.schema.varchar-too-large", table: t.name, column: col.name, values: { length: col.len!, threshold: VARCHAR_THRESHOLD }, ...pos(at) });
    }
  }
  return hits;
}
