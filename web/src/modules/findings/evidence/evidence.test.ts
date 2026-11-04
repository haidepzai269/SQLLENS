// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { loadModule, parseSync } from "pgsql-parser";
import { beforeAll, describe, expect, it } from "vitest";
import type { Evidence, Outcome } from "@/contracts/conclusion";
import type { FindingData, RuleHit } from "@/contracts/finding";
import type { Plan, PlanNode } from "@/contracts/plan";
import { runExplain } from "@/engines/postgres/explain";
import { loadGuard } from "@/engines/postgres/guard";
import { createSession } from "@/engines/postgres/roles";
import { parsePostgres, type PgParser } from "@/modules/sql-intake/parser/core";
import en from "../../../../messages/en/findings.json";
import vi from "../../../../messages/vi/findings.json";
import { checkQueries } from "../query-rules";
import { checkSchema } from "../schema-rules";
import { attachEvidence } from "./index";

const node = (o: Partial<PlanNode> & { id: string; kind: PlanNode["kind"] }): PlanNode => ({ label: o.kind, children: [], ...o });
const plan = (root: PlanNode, analyzed = true, engine: Plan["engine"] = "postgres"): Outcome<Plan> => ({
  kind: "conclusion",
  label: analyzed ? "real" : "estimated",
  data: { engine, analyzed, root },
  evidence: [{ kind: "x", messageKey: "x" }],
});
const hit = (o: Partial<RuleHit> = {}): RuleHit => ({ ruleId: "leading-wildcard", messageKey: "findings.query.leading-wildcard", table: "t", column: "c", statementIndex: 0, ...o });
const only = (hits: RuleHit[], plans: { statementIndex: number; plan: Outcome<Plan> }[]) => attachEvidence(hits, { plans })[0];
const data = (o: Outcome<FindingData>) => {
  if (o.kind !== "conclusion") throw new Error(`not_simulated ${o.reasonKey}`);
  return o;
};

describe("attachEvidence, plan tổng hợp", () => {
  it("AC1: seq_scan thật là broken, nhãn real, có số dòng, số trang và planNodeId", () => {
    const o = data(only([hit()], [{ statementIndex: 0, plan: plan(node({ id: "n1", kind: "seq_scan", table: "t", actualRows: 7, pagesRead: 3 })) }]));
    expect(o.label).toBe("real");
    expect(o.data).toMatchObject({ severity: "broken", planNodeId: "n1" });
    expect(o.evidence[1]).toMatchObject({ values: { rows: 7, pages: 3 } });
    expect(JSON.stringify(o)).not.toMatch(/time|ms/i);
  });

  it("AC2: plan dùng index là not_broken, nhãn real", () => {
    for (const kind of ["index_scan", "index_only_scan", "bitmap_scan"] as const) {
      const o = data(only([hit()], [{ statementIndex: 0, plan: plan(node({ id: "n1", kind, table: "t", actualRows: 1, pagesRead: 2 })) }]));
      expect(o).toMatchObject({ label: "real", data: { severity: "not_broken" } });
      expect(o.evidence[0].messageKey).toBe("findings.evidence.scanIndex");
    }
  });

  it("AC3: không plan, plan NotSimulated: NotSimulated; MySQL ước lượng: unverified, estimated", () => {
    expect(only([hit()], [])).toEqual({ kind: "not_simulated", reasonKey: "findings.notSimulated.noPlan" });
    expect(only([hit()], [{ statementIndex: 0, plan: { kind: "not_simulated", reasonKey: "plan.notSimulated.multiple" } }])).toEqual({ kind: "not_simulated", reasonKey: "plan.notSimulated.multiple" });
    const o = data(only([hit()], [{ statementIndex: 0, plan: plan(node({ id: "n1", kind: "seq_scan", table: "t", estimatedRows: 900 }), false, "mysql") }]));
    expect(o).toMatchObject({ label: "estimated", data: { severity: "unverified" } });
    expect(o.evidence.map((e: Evidence) => e.messageKey)).toEqual(["findings.evidence.estimatedScanSeq", "findings.evidence.estimatedRows"]);
  });

  it("AC4: luật schema là unverified, estimated, không có planNodeId", () => {
    const h = hit({ ruleId: "missing-pk", messageKey: "findings.schema.missing-pk", statementIndex: undefined });
    const o = data(only([h], []));
    expect(o).toMatchObject({ label: "estimated", data: { severity: "unverified" } });
    expect(o.data.planNodeId).toBeUndefined();
  });

  it("ca biên: statementIndex lệch, không table, bảng không có trong plan, hai bí danh, join nhiều bảng, không hit", () => {
    const p = [{ statementIndex: 1, plan: plan(node({ id: "n1", kind: "seq_scan", table: "t" })) }];
    expect(only([hit()], p)).toMatchObject({ reasonKey: "findings.notSimulated.noPlan" });
    expect(only([hit({ table: undefined, statementIndex: 1 })], p)).toMatchObject({ reasonKey: "findings.notSimulated.noTable" });
    expect(only([hit({ table: "zzz", statementIndex: 1 })], p)).toMatchObject({ reasonKey: "findings.notSimulated.tableNotInPlan" });
    const two = (a: PlanNode["kind"], b: PlanNode["kind"]) => [{ statementIndex: 0, plan: plan(node({ id: "j", kind: "nested_loop", children: [node({ id: "a", kind: a, table: "t" }), node({ id: "b", kind: b, table: "t" })] })) }];
    expect(only([hit()], two("seq_scan", "index_scan"))).toMatchObject({ reasonKey: "findings.notSimulated.ambiguousTable" });
    expect(data(only([hit()], two("seq_scan", "seq_scan"))).data.planNodeId).toBe("a");
    const join = plan(node({ id: "j", kind: "hash_join", children: [node({ id: "a", kind: "seq_scan", table: "other" }), node({ id: "b", kind: "hash", children: [node({ id: "c", kind: "index_scan", table: "t" })] })] }));
    expect(data(only([hit()], [{ statementIndex: 0, plan: join }])).data).toMatchObject({ severity: "not_broken", planNodeId: "c" });
    expect(attachEvidence([], { plans: [] })).toEqual([]);
    expect(only([hit({ messageKey: "findings.other.x" })], p)).toMatchObject({ reasonKey: "findings.notSimulated.unknownRule" });
  });
});

describe("attachEvidence với explain thật trên PGlite (AC7)", () => {
  let s: Awaited<ReturnType<typeof createSession>>;
  beforeAll(async () => {
    await loadModule();
    await loadGuard();
    s = await createSession(await PGlite.create({ extensions: { pageinspect } }));
    await s.run(`CREATE TABLE users (id int PRIMARY KEY, email text, a int, b int);
      INSERT INTO users SELECT g, 'u' || g, g, g FROM generate_series(1, 20000) g;
      CREATE INDEX ie ON users (email); CREATE INDEX iab ON users (a, b); ANALYZE;`);
  }, 120_000);

  async function finding(query: string) {
    const ddl = "CREATE TABLE users (id int PRIMARY KEY, email text, a int, b int); CREATE INDEX ie ON users (email); CREATE INDEX iab ON users (a, b); ";
    const sql = ddl + query;
    const r = parsePostgres(sql, parseSync as unknown as PgParser);
    if (!r.ok) throw new Error(r.error.message);
    const hits = checkQueries(r.statements, "postgres", sql);
    expect(hits).toHaveLength(1);
    const statementIndex = hits[0].statementIndex!;
    const p = await runExplain(s.run, query);
    return data(attachEvidence(hits, { plans: [{ statementIndex, plan: p }] })[0]);
  }

  it.each([
    ["bọc hàm", "SELECT * FROM users WHERE lower(email) = 'u5'", "function-on-indexed-column"],
    ["LIKE '%x'", "SELECT * FROM users WHERE email LIKE '%77'", "leading-wildcard"],
    ["sai tiền tố trái", "SELECT * FROM users WHERE b = 5", "composite-prefix"],
  ])("%s: seq_scan thật là broken", async (_n, q, ruleId) => {
    const o = await finding(q);
    expect(o.data.hit.ruleId).toBe(ruleId);
    expect(o).toMatchObject({ label: "real", data: { severity: "broken" } });
    expect(o.data.planNodeId).toBeTruthy();
    expect(o.evidence[1].values!.pages).toBeGreaterThan(0);
  }, 30_000);
});

describe("câu dịch (AC5)", () => {
  const flat = (o: object, p = ""): [string, string][] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v as string]]));
  const BAD = /thiết kế (này )?(ổn|tốt)|\b(tốt|an toàn)\b|\b(good|fine|safe|ok|okay)\b|no problem/i;

  it("không câu nào hàm ý thiết kế ổn", () => {
    for (const [k, v] of [...flat(vi), ...flat(en)]) expect(v, k).not.toMatch(BAD);
  });

  it("có đủ hai ngôn ngữ cho khóa của luật, bằng chứng và lý do không mô phỏng được", () => {
    const keys = new Set<string>();
    const parsed = parsePostgres("CREATE TABLE a (id int, price float, n varchar(900)); CREATE TABLE b (id int PRIMARY KEY, a_id int REFERENCES a(id));", parseSync as unknown as PgParser);
    const sch = checkSchema(parsed.ok ? parsed.statements : [], "postgres");
    expect(sch.length).toBe(4);
    sch.forEach((h) => keys.add(h.messageKey));
    ["function-on-indexed-column", "leading-wildcard", "composite-prefix", "implicit-cast"].forEach((r) => keys.add(`findings.query.${r}`));
    const scan = (k: PlanNode["kind"], analyzed: boolean) => only([hit()], [{ statementIndex: 0, plan: plan(node({ id: "n", kind: k, table: "t", actualRows: 1, pagesRead: 1, estimatedRows: 1 }), analyzed) }]);
    for (const o of [scan("seq_scan", true), scan("index_scan", true), scan("seq_scan", false), scan("index_scan", false), only([sch[0]], [])]) {
      data(o).evidence.forEach((e) => keys.add(e.messageKey));
    }
    ["noPlan", "noTable", "tableNotInPlan", "ambiguousTable", "unknownRule"].forEach((r) => keys.add(`findings.notSimulated.${r}`));
    for (const m of [vi, en]) {
      const have = new Set(flat(m).map(([k]) => `findings.${k}`));
      for (const k of keys) expect(have.has(k), k).toBe(true);
    }
  });

  it("mọi biến trong câu dịch luật schema đều có giá trị trong data.hit.values", () => {
    const parsed = parsePostgres("CREATE TABLE a (id int, price float, n varchar(900)); CREATE TABLE b (id int PRIMARY KEY, a_id int REFERENCES a(id));", parseSync as unknown as PgParser);
    const hits = checkSchema(parsed.ok ? parsed.statements : [], "postgres");
    for (const o of attachEvidence(hits, { plans: [] })) {
      const h = data(o).data.hit;
      const msg = (vi.schema as Record<string, string>)[h.ruleId];
      for (const [, name] of msg.matchAll(/\{(\w+)\}/g)) expect(h.values, `${h.ruleId} ${name}`).toHaveProperty(name);
    }
  });

  it("implicit-cast phân biệt ba effect", () => {
    for (const m of [vi, en]) for (const e of ["literal-cast", "column-cast", "error"]) expect(m.query["implicit-cast"]).toContain(`${e} {`);
  });
});
