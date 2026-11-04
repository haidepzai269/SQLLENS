// @vitest-environment node
// AC3: mẫu 500k ngoại suy 5.000.000 dòng, so với index thật cùng cỡ trên Postgres 18 thật.
// Cần T055_DATABASE_URL (chỉ localhost: test tạo và xóa bảng public.t055). Không có thì bỏ qua.
// Dùng: docker run -d --name t055-pg --memory 1g -p 54550:5432 -e POSTGRES_PASSWORD=t055 postgres:18
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { QueryResult } from "@/contracts/engine";
import { readBTree } from "@/engines/postgres/btree-read";
import { estimateCapacity, measureCapacity } from "./capacity";

const URL_ENV = process.env.T055_DATABASE_URL;
if (URL_ENV) {
  const u = new URL(URL_ENV);
  // pg cho "?host=" đè host, nên mọi query string đều bị từ chối.
  if (u.search || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname)) {
    throw new Error("T055_DATABASE_URL must point to localhost without a query string: this test creates and drops tables");
  }
} else console.warn("T055_DATABASE_URL not set: capacity pg test skipped");

const INDEXES = { int: "t055_i", text: "t055_tx", uuid: "t055_u" } as const;
const COLS = { int: "i", text: "tx", uuid: "u" } as const;
type Kind = keyof typeof INDEXES;
const KINDS = Object.keys(INDEXES) as Kind[];
const FROM = 500_000;
const TARGET = 5_000_000;
const c = new Client({ connectionString: URL_ENV });

const q = async (sql: string, params?: unknown[]): Promise<QueryResult[]> => {
  const r = await c.query({ text: sql, values: params, rowMode: "array" });
  return [{ columns: r.fields.map((f) => f.name), rows: r.rows }];
};
const adapter = {
  execute: (sql: string) => q(sql),
  explain: async () => ({ kind: "not_simulated" as const, reasonKey: "unused" }),
  readBTree: (index: string, o?: { probeKey?: string; maxNodes?: number }) => readBTree(q, index, o),
};
const rebuild = async () => {
  for (const k of KINDS) {
    await q(`DROP INDEX IF EXISTS public.${INDEXES[k]}`);
    await q(`CREATE INDEX ${INDEXES[k]} ON public.t055(${COLS[k]})`);
  }
};
const measure = async (k: Kind) => {
  const r = await measureCapacity(adapter, { index: INDEXES[k], table: "t055" });
  if (r.kind !== "conclusion") throw new Error(r.reasonKey);
  return r.data;
};
const truth = async (name: string) => {
  const [m] = await q(`SELECT level::int FROM public.bt_metap('public.${name}')`);
  const [z] = await q(`SELECT pg_relation_size('public.${name}')::bigint::text`);
  return { height: Number(m.rows[0][0]) + 1, pages: Number(z.rows[0][0]) / 8192 };
};

afterAll(async () => {
  if (!URL_ENV) return;
  await q("DROP TABLE IF EXISTS public.t055");
  await c.end();
});

describe.skipIf(!URL_ENV)("AC3 trên Postgres thật", { timeout: 1_800_000 }, () => {
  it("mẫu 500k, ngoại suy 5.000.000: số tầng đúng, indexBytes lệch tối đa 15%", async () => {
    await c.connect();
    await q("CREATE EXTENSION IF NOT EXISTS pageinspect");
    await q("SET search_path = pg_catalog, pg_temp"); // như kênh quản trị trong PGlite
    await q("DROP TABLE IF EXISTS public.t055");
    await q("CREATE TABLE public.t055(i int, tx text, u uuid)");
    const load = (a: number, b: number) =>
      q(`INSERT INTO public.t055 SELECT g, md5(g::text), md5(g::text || 'u')::uuid FROM generate_series(${a}, ${b}) g`);
    await load(1, FROM);
    await rebuild();
    const samples = {} as Record<Kind, Awaited<ReturnType<typeof measure>>>;
    for (const k of KINDS) samples[k] = await measure(k);
    await load(FROM + 1, TARGET);
    await rebuild();
    const out: string[] = [];
    for (const k of KINDS) {
      const real = await measure(k);
      const t = await truth(INDEXES[k]);
      expect([real.rows, real.height, real.indexPages]).toEqual([TARGET, t.height, t.pages]);
      const est = estimateCapacity(samples[k], TARGET);
      if (est.kind !== "conclusion") throw new Error(est.reasonKey);
      const dev = Math.abs(est.data.indexBytes - t.pages * 8192) / (t.pages * 8192);
      out.push(
        `${k}: mau 500k h=${samples[k].height} pages=${samples[k].indexPages} leafFanout=${samples[k].leafFanout.toFixed(1)} internalFanout=${samples[k].internalFanout?.toFixed(1)}; ` +
          `that 5M h=${t.height} bytes=${t.pages * 8192}; uoc luong h=${est.data.height} bytes=${est.data.indexBytes}; lech ${(dev * 100).toFixed(2)}%`,
      );
      expect(est.data.height).toBe(t.height);
      expect(dev).toBeLessThanOrEqual(0.15);
    }
    console.log(out.join("\n"));
  });
});
