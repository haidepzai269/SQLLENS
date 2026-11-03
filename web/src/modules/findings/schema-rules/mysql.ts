import type { Col, Ev, J } from "./events";

const tbl = (x: J): string => (x.db ? `${x.db}.${x.table}` : x.table);
const NUM = new Set(["float", "double", "real", "double precision"]);
const name = (c: J): string => (c?.type === "column_ref" && typeof c.column === "string" ? c.column : "");
const names = (a: J): string[] => (a ?? []).map(name);

function colOf(column: J, def: J): Col {
  const dt = String(def?.dataType ?? "").toLowerCase();
  return { name: name(column), type: NUM.has(dt) ? "float" : dt, len: def?.length };
}

// Cột khai kèm PRIMARY KEY, UNIQUE trên dòng. REFERENCES bỏ qua vì InnoDB tự tạo index cho FK (xem index.ts).
function colExtras(d: J, t: string): Ev[] {
  const c = name(d.column);
  return [
    ...(d.primary_key ? [{ k: "pk", t, cols: [c] } as Ev] : []),
    ...(d.unique ? [{ k: "idx", t, cols: [c] } as Ev] : []),
  ];
}

function def(d: J, t: string): Ev[] {
  if (d.resource === "column") return colExtras(d, t);
  const ctype = String(d.constraint_type ?? "").toLowerCase();
  const cols = names(d.definition);
  if (ctype === "primary key") return [{ k: "pk", t, cols, name: d.constraint ?? undefined }];
  if (ctype.startsWith("unique")) return [{ k: "idx", t, cols }];
  // KEY/INDEX thường; FULLTEXT và SPATIAL không phục vụ khóa.
  if (d.resource === "index" && !/fulltext|spatial/i.test(String(d.keyword ?? ""))) return [{ k: "idx", t, cols }];
  return [];
}

export function mysqlEvents(ast: J): Ev[] {
  if (ast.type === "create" && ast.keyword === "table") {
    const t = tbl(ast.table[0]);
    const defs: J[] = ast.create_definitions ?? [];
    const cols = defs.filter((d) => d.resource === "column").map((d) => colOf(d.column, d.definition));
    return [{ k: "table", t, cols, opaque: !defs.length }, ...defs.flatMap((d) => def(d, t))];
  }
  if (ast.type === "create" && ast.keyword === "index") {
    if (/fulltext|spatial/i.test(String(ast.index_type ?? ""))) return [];
    return [{ k: "idx", t: tbl(ast.table), cols: (ast.index_columns ?? []).map(name) }];
  }
  if (ast.type === "alter") {
    const t = tbl(ast.table[0]);
    return (ast.expr ?? []).flatMap((e: J): Ev[] => {
      if (e.action === "add" && e.resource === "column") return [{ k: "col", t, col: colOf(e.column, e.definition) }, ...colExtras(e, t)];
      if (e.action === "add" && e.resource === "constraint") return def(e.create_definitions, t);
      if (e.action === "add" && e.resource === "index") return def(e, t);
      if (e.action === "modify" || e.action === "change") {
        const col = colOf(e.column, e.definition);
        // CHANGE đổi tên: cột cũ biến mất, cột mới mang kiểu mới.
        return [...(e.action === "change" ? [{ k: "dropcol", t, c: name(e.old_column) } as Ev] : []), { k: "col", t, col }, ...colExtras(e, t)];
      }
      if (e.action === "drop" && e.resource === "column") return [{ k: "dropcol", t, c: name(e.column) }];
      if (e.action === "drop" && e.keyword === "primary key") return [{ k: "droppk", t }];
      return [];
    });
  }
  if (ast.type === "drop" && ast.keyword === "table") return (ast.name ?? []).map((n: J) => ({ k: "drop", t: tbl(n) }) as Ev);
  return [];
}
