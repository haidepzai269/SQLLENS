import type { Col, Ev, J } from "./events";

const rel = (r: J): string => (r.schemaname && r.schemaname !== "public" ? `${r.schemaname}.${r.relname}` : r.relname);
const keys = (a: J): string[] => (a ?? []).map((k: J) => k.String?.sval ?? "");

function colOf(cd: J): Col {
  const tn = cd.typeName ?? {};
  const last: string = (tn.names ?? []).map((n: J) => n.String?.sval).pop() ?? "";
  const base = last === "float4" || last === "float8" ? "float" : last;
  return { name: cd.colname, type: tn.arrayBounds ? `${base}[]` : base, len: tn.typmods?.[0]?.A_Const?.ival?.ival };
}

function constraint(c: J, t: string, own?: string): Ev[] {
  if (c.contype === "CONSTR_PRIMARY") return [{ k: "pk", t, cols: own ? [own] : keys(c.keys), name: c.conname }];
  if (c.contype === "CONSTR_UNIQUE") return [{ k: "idx", t, cols: own ? [own] : keys(c.keys) }];
  if (c.contype === "CONSTR_FOREIGN") return [{ k: "fk", t, cols: own ? [own] : keys(c.fk_attrs) }];
  return [];
}

function colDef(cd: J, t: string): Ev[] {
  return (cd.constraints ?? []).flatMap((c: J) => constraint(c.Constraint ?? {}, t, cd.colname));
}

export function postgresEvents(ast: J): Ev[] {
  if (ast.CreateStmt) {
    const s = ast.CreateStmt;
    const t = rel(s.relation);
    const elts: J[] = s.tableElts ?? [];
    const cols = elts.filter((e) => e.ColumnDef).map((e) => colOf(e.ColumnDef));
    const opaque = elts.some((e) => e.TableLikeClause) || !!s.inhRelations?.length || !!s.partbound;
    return [
      { k: "table", t, cols, opaque, skipIfExists: !!s.if_not_exists },
      ...elts.flatMap((e) => (e.ColumnDef ? colDef(e.ColumnDef, t) : e.Constraint ? constraint(e.Constraint, t) : [])),
    ];
  }
  if (ast.IndexStmt) {
    const s = ast.IndexStmt;
    // Index một phần hoặc không phải btree/hash không phục vụ tra cứu khóa ngoại.
    if (s.whereClause || (s.accessMethod ?? "btree") !== "btree") return [];
    const cols = (s.indexParams ?? []).map((p: J) => p.IndexElem?.name ?? "");
    return [{ k: "idx", t: rel(s.relation), cols }];
  }
  if (ast.AlterTableStmt) {
    const t = rel(ast.AlterTableStmt.relation);
    return (ast.AlterTableStmt.cmds ?? []).flatMap(({ AlterTableCmd: c }: J): Ev[] => {
      if (!c) return [];
      switch (c.subtype) {
        case "AT_AddConstraint":
          return constraint(c.def?.Constraint ?? {}, t);
        case "AT_AddColumn":
          return c.def?.ColumnDef ? [{ k: "col", t, col: colOf(c.def.ColumnDef) }, ...colDef(c.def.ColumnDef, t)] : [];
        case "AT_AlterColumnType":
          return c.def?.ColumnDef ? [{ k: "col", t, col: colOf({ ...c.def.ColumnDef, colname: c.name }), mod: true }] : [];
        case "AT_DropColumn":
          return [{ k: "dropcol", t, c: c.name }];
        case "AT_DropConstraint":
          return [{ k: "droppk", t, name: c.name }];
        default:
          return [];
      }
    });
  }
  if (ast.DropStmt?.removeType === "OBJECT_TABLE") {
    return (ast.DropStmt.objects ?? []).map((o: J) => {
      const p = keys(o.List?.items);
      return { k: "drop", t: p.length > 1 ? (p[p.length - 2] === "public" ? p[p.length - 1] : p.slice(-2).join(".")) : p[0] } as Ev;
    });
  }
  return [];
}
