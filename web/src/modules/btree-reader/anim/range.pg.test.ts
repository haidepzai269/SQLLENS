// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { beforeAll, describe, expect, it } from "vitest";
import type { BTreeModel } from "@/contracts/btree";
import { readBTree } from "@/engines/postgres/btree-read";
import { loadGuard } from "@/engines/postgres/guard";
import { createSession } from "@/engines/postgres/roles";
import { planRange } from "./range";

// Đối chiếu với PostgreSQL thật: số leaf một range scan đọc thêm so với tra một khóa, đo bằng buffers của Index Only Scan.
let db: PGlite;
let s: Awaited<ReturnType<typeof createSession>>;
beforeAll(async () => {
  await loadGuard();
  db = await PGlite.create({ extensions: { pageinspect } });
  s = await createSession(db);
  await s.run(`CREATE TABLE r(id int primary key); INSERT INTO r SELECT g FROM generate_series(1, 40000) g`);
  await db.exec("VACUUM r");
}, 120_000);

const buffers = async (a: number, b: number) => {
  await db.exec("SET enable_seqscan = off; SET enable_bitmapscan = off");
  const r = await db.query<{ p: unknown }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM r WHERE id BETWEEN ${a} AND ${b}`);
  const node = (r.rows[0].p ?? Object.values(r.rows[0])[0]) as { Plan: Record<string, unknown> }[];
  const plan = node[0].Plan;
  expect(plan["Node Type"]).toBe("Index Only Scan");
  return Number(plan["Shared Hit Blocks"]) + Number(plan["Shared Read Blocks"]);
};

describe("planRange trên index thật", { timeout: 60_000 }, () => {
  for (const [from, to] of [[100, 900], [1, 40000], [5000, 5000], [20000, 25000], [39990, 40000], [367, 367]] as const) {
    it(`khoảng ${from} đến ${to}: số leaf trượt thêm bằng số buffers đọc thêm của PostgreSQL`, async () => {
      const r = await s.adminSession((q) => readBTree(q, "r_pkey", { probeKey: String(from), maxNodes: 1000 }));
      if (r.model.kind !== "conclusion") throw new Error(r.model.reasonKey);
      const plan = planRange(r.model.data as BTreeModel, r.path!, String(to));
      if ("error" in plan) throw new Error(plan.error);
      expect(plan.end === "done" || plan.end === "lastLeaf").toBe(true);
      expect(plan.slide.length).toBe((await buffers(from, to)) - (await buffers(from, from)));
    });
  }
});
