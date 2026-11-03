// @vitest-environment node
import { loadModule, parseSync } from "pgsql-parser";
import mysqlParser from "node-sql-parser/build/mysql.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineId } from "@/contracts/engine";
import { parseMysql, parsePostgres, type MyParser, type PgParser } from "../../sql-intake/parser/core";
import { checkSchema } from "./index";

const my = new (mysqlParser as unknown as { Parser: new () => MyParser }).Parser();
beforeAll(() => loadModule(), 60_000);

function run(engine: EngineId, sql: string) {
  const r = engine === "postgres" ? parsePostgres(sql, parseSync as unknown as PgParser) : parseMysql(sql, my);
  if (!r.ok) throw new Error(r.error.message);
  return { hits: checkSchema(r.statements, engine), sql };
}
const ids = (engine: EngineId, sql: string, rule?: string) =>
  run(engine, sql)
    .hits.filter((h) => !rule || h.ruleId === rule)
    .map((h) => `${h.ruleId}:${h.table}${h.column ? "." + h.column : ""}`);
const both: EngineId[] = ["postgres", "mysql"];

describe.each(both)("%s", (e) => {
  it("AC1 missing-pk: báo, không báo, PK ở ALTER, PK cột, PK bị bỏ", () => {
    expect(ids(e, "CREATE TABLE t (a int)")).toEqual(["missing-pk:t"]);
    expect(ids(e, "CREATE TABLE t (a int PRIMARY KEY)")).toEqual([]);
    expect(ids(e, "CREATE TABLE t (a int, PRIMARY KEY (a))")).toEqual([]);
    expect(ids(e, "CREATE TABLE t (a int); ALTER TABLE t ADD PRIMARY KEY (a)")).toEqual([]);
    expect(ids(e, "CREATE TABLE t (a int); ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (a)")).toEqual([]);
  });

  it("bảng bị DROP thì không báo; tạo lại thì báo lại; ALTER bảng chưa khai báo bị bỏ qua", () => {
    expect(ids(e, "CREATE TABLE t (a int); DROP TABLE t")).toEqual([]);
    expect(ids(e, "CREATE TABLE t (a int); DROP TABLE t; CREATE TABLE t (b int)")).toEqual(["missing-pk:t"]);
    expect(ids(e, "ALTER TABLE ghost ADD COLUMN price float")).toEqual([]);
  });

  it("AC3 float-money", () => {
    const f = e === "postgres" ? ["real", "double precision", "float"] : ["float", "double"];
    for (const ty of f) expect(ids(e, `CREATE TABLE t (id int PRIMARY KEY, price ${ty})`)).toEqual(["float-money:t.price"]);
    expect(ids(e, "CREATE TABLE t (id int PRIMARY KEY, price numeric(10,2), total decimal(8,2))")).toEqual([]);
    expect(ids(e, "CREATE TABLE t (id int PRIMARY KEY, ratio float)")).toEqual([]);
    expect(ids(e, "CREATE TABLE t (id int PRIMARY KEY); ALTER TABLE t ADD COLUMN amount float")).toEqual(["float-money:t.amount"]);
    expect(ids(e, "CREATE TABLE t (id int PRIMARY KEY, cost float); ALTER TABLE t DROP COLUMN cost")).toEqual([]);
  });

  it("AC3 đổi kiểu sang numeric thì không báo", () => {
    const alter = e === "postgres" ? "ALTER COLUMN price TYPE numeric(10,2)" : "MODIFY COLUMN price numeric(10,2)";
    expect(ids(e, `CREATE TABLE t (id int PRIMARY KEY, price float); ALTER TABLE t ${alter}`)).toEqual([]);
  });

  it("AC4 varchar-too-large", () => {
    expect(ids(e, "CREATE TABLE t (id int PRIMARY KEY, a varchar(256), b varchar(255), c text)")).toEqual(["varchar-too-large:t.a"]);
    const h = run(e, "CREATE TABLE t (id int PRIMARY KEY, a varchar(1000))").hits[0];
    expect(h.values).toEqual({ length: 1000, threshold: 255 });
    expect(h.messageKey).toBe("findings.schema.varchar-too-large");
  });

  it("AC5 vị trí của câu lệnh sinh ra hit", () => {
    const sql = "CREATE TABLE ok (id int PRIMARY KEY);\nCREATE TABLE bad (a int);";
    const h = run(e, sql).hits[0];
    expect(h).toMatchObject({ table: "bad", statementIndex: 1 });
    expect(sql.slice(h.start, h.end)).toBe("CREATE TABLE bad (a int)");
  });

  it("AC6 không báo trùng, AC7 không rủi ro thì mảng rỗng", () => {
    expect(run(e, "CREATE TABLE t (id int PRIMARY KEY, price float, a varchar(999))").hits).toHaveLength(2);
    expect(ids(e, "CREATE TABLE t (id int PRIMARY KEY, n varchar(10))")).toEqual([]);
    expect(checkSchema([], e)).toEqual([]);
  });

  it("câu SELECT bị bỏ qua", () => {
    expect(ids(e, "SELECT 1; CREATE TABLE t (id int PRIMARY KEY)")).toEqual([]);
  });
});

describe("AC2 fk-no-index trên PostgreSQL", () => {
  const P = (s: string) => ids("postgres", `CREATE TABLE o (id int PRIMARY KEY); ${s}`, "fk-no-index");
  it("báo FK không index", () => {
    expect(P("CREATE TABLE t (id int PRIMARY KEY, o_id int REFERENCES o(id))")).toEqual(["fk-no-index:t.o_id"]);
    expect(P("CREATE TABLE t (id int PRIMARY KEY, o_id int, FOREIGN KEY (o_id) REFERENCES o(id))")).toEqual(["fk-no-index:t.o_id"]);
    expect(P("CREATE TABLE t (id int PRIMARY KEY, o_id int); ALTER TABLE t ADD CONSTRAINT f FOREIGN KEY (o_id) REFERENCES o(id)")).toEqual(["fk-no-index:t.o_id"]);
  });
  it("không báo khi là cột đầu của index, kể cả index tạo sau, PK, UNIQUE", () => {
    expect(P("CREATE TABLE t (o_id int REFERENCES o(id), x int); CREATE INDEX i ON t (o_id, x)")).toEqual([]);
    expect(P("CREATE TABLE t (id int PRIMARY KEY, o_id int REFERENCES o(id)); CREATE INDEX i ON t (o_id)")).toEqual([]);
    expect(P("CREATE TABLE t (o_id int PRIMARY KEY REFERENCES o(id))")).toEqual([]);
    expect(P("CREATE TABLE t (id int PRIMARY KEY, o_id int UNIQUE REFERENCES o(id))")).toEqual([]);
  });
  it("vẫn báo khi cột chỉ đứng sau trong index nhiều cột, hoặc index một phần", () => {
    expect(P("CREATE TABLE t (id int PRIMARY KEY, o_id int REFERENCES o(id), x int); CREATE INDEX i ON t (x, o_id)")).toEqual(["fk-no-index:t.o_id"]);
    expect(P("CREATE TABLE t (id int PRIMARY KEY, o_id int REFERENCES o(id)); CREATE INDEX i ON t (o_id) WHERE o_id > 0")).toEqual(["fk-no-index:t.o_id"]);
  });
  it("FK nhiều cột và tên có schema, ngoặc kép", () => {
    expect(P("CREATE TABLE public.t (a int, b int, PRIMARY KEY (a, b), FOREIGN KEY (b, a) REFERENCES o(id, id))")).toEqual([]);
    expect(P('CREATE TABLE "My T" (id int PRIMARY KEY, o_id int REFERENCES o(id)); CREATE INDEX i ON "My T" (o_id)')).toEqual([]);
    expect(P("CREATE TABLE t (id int PRIMARY KEY, o_id int REFERENCES o(id)); CREATE INDEX i ON public.t (o_id)")).toEqual([]);
    expect(P("CREATE TABLE s.t (id int PRIMARY KEY, o_id int REFERENCES o(id)); CREATE INDEX i ON t (o_id)")).toEqual(["fk-no-index:s.t.o_id"]);
  });
  it("cột FK bị bỏ thì hết báo", () => {
    expect(P("CREATE TABLE t (id int PRIMARY KEY, o_id int REFERENCES o(id)); ALTER TABLE t DROP COLUMN o_id")).toEqual([]);
  });
});

describe("AC2 MySQL: InnoDB tự tạo index cho FK nên không báo", () => {
  it("không báo dù không khai index", () => {
    expect(ids("mysql", "CREATE TABLE o (id int PRIMARY KEY); CREATE TABLE t (id int PRIMARY KEY, o_id int, FOREIGN KEY (o_id) REFERENCES o(id))")).toEqual([]);
  });
});

describe("tên có schema và ngoặc kép", () => {
  it("PostgreSQL: public.t trùng t, tên ngoặc kép phân biệt hoa thường", () => {
    expect(ids("postgres", "CREATE TABLE public.t (a int); ALTER TABLE t ADD PRIMARY KEY (a)")).toEqual([]);
    expect(ids("postgres", 'CREATE TABLE "T" (a int); ALTER TABLE t ADD PRIMARY KEY (a)')).toEqual(["missing-pk:T"]);
  });
  it("MySQL: tên bọc backtick và khác hoa thường vẫn là một bảng", () => {
    expect(ids("mysql", "CREATE TABLE `T` (a int); ALTER TABLE t ADD PRIMARY KEY (a)")).toEqual([]);
    expect(ids("mysql", "CREATE TABLE db.t (a int); ALTER TABLE db.t ADD PRIMARY KEY (a)")).toEqual([]);
  });
  it("MySQL: PK bị bỏ thì báo lại; CHANGE COLUMN giữ kiểu mới", () => {
    expect(ids("mysql", "CREATE TABLE t (a int PRIMARY KEY); ALTER TABLE t DROP PRIMARY KEY")).toEqual(["missing-pk:t"]);
    expect(ids("mysql", "CREATE TABLE t (id int PRIMARY KEY, x numeric(5,2)); ALTER TABLE t CHANGE COLUMN x price float")).toEqual(["float-money:t.price"]);
  });
  it("PostgreSQL: DROP CONSTRAINT t_pkey bỏ khóa chính", () => {
    expect(ids("postgres", "CREATE TABLE t (a int PRIMARY KEY); ALTER TABLE t DROP CONSTRAINT t_pkey")).toEqual(["missing-pk:t"]);
  });
  it("PostgreSQL: CREATE TABLE ... (LIKE x) không đoán missing-pk", () => {
    expect(ids("postgres", "CREATE TABLE t (LIKE o INCLUDING ALL)")).toEqual([]);
  });
});

it("AST lạ không ném lỗi", () => {
  const st = { index: 0, kind: "create_table", start: 0, end: 1, tables: [], ast: { CreateStmt: {} } };
  expect(() => checkSchema([st] as never, "postgres")).not.toThrow();
  expect(checkSchema([{ ...st, ast: null }] as never, "mysql")).toEqual([]);
});

describe.each(both)("%s sau review", (e) => {
  it("IF NOT EXISTS là no-op khi đã có", () => {
    expect(ids(e, "CREATE TABLE t (id int PRIMARY KEY); CREATE TABLE IF NOT EXISTS t (b int)")).toEqual([]);
    expect(ids(e, "CREATE TABLE IF NOT EXISTS t (b int)")).toEqual(["missing-pk:t"]);
  });
});

describe("sau review, PostgreSQL", () => {
  it("ADD COLUMN IF NOT EXISTS không đổi kiểu cột đã có (MySQL không có cú pháp này)", () => {
    expect(ids("postgres", "CREATE TABLE t (id int PRIMARY KEY, price float); ALTER TABLE t ADD COLUMN IF NOT EXISTS price numeric")).toEqual(["float-money:t.price"]);
  });
  it("bỏ PK thì index của PK cũng mất, FK trùng chỉ báo một lần", () => {
    expect(ids("postgres", "CREATE TABLE o (id int PRIMARY KEY); CREATE TABLE t (o_id int PRIMARY KEY REFERENCES o); ALTER TABLE t DROP CONSTRAINT t_pkey")).toEqual(["missing-pk:t", "fk-no-index:t.o_id"]);
    expect(ids("postgres", "CREATE TABLE o (id int PRIMARY KEY); CREATE TABLE t (a int PRIMARY KEY, o_id int, FOREIGN KEY (o_id) REFERENCES o(id), FOREIGN KEY (o_id) REFERENCES o(id))", "fk-no-index")).toEqual(["fk-no-index:t.o_id"]);
  });
});
