// @vitest-environment node
// 100k luôn chạy. Phần 500k tốn RAM của PGlite nên chỉ chạy khi T055_BIG=1.
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineAdapter } from "@/contracts/engine";
import type { CapacitySample } from "@/contracts/whatif";
import { readBTree } from "@/engines/postgres/btree-read";
import { runExplain } from "@/engines/postgres/explain";
import { loadGuard } from "@/engines/postgres/guard";
import { createSession } from "@/engines/postgres/roles";
import { estimateCapacity, measureCapacity, samplePoint } from "./capacity";

const BIG = process.env.T055_BIG === "1";
let s: Awaited<ReturnType<typeof createSession>>;
const adapter: Pick<EngineAdapter, "readBTree" | "explain" | "execute"> = {
  execute: (sql) => s.run(sql),
  explain: (sql) => runExplain(s.run, sql),
  readBTree: (index, o) => s.adminSession((q) => readBTree(q, index, o)),
};
const INDEXES = { int: "t_i", text: "t_tx", uuid: "t_u" } as const;
const COLS = { int: "i", text: "tx", uuid: "u" } as const;
const PROBES = { int: "54321", text: "md5('54321')", uuid: "md5('54321u')::uuid" } as const;
type Kind = keyof typeof INDEXES;
const KINDS = Object.keys(INDEXES) as Kind[];

// Dựng lại index sau mỗi lần nạp: CREATE INDEX hàng loạt cho cùng độ đầy ở mẫu và ở số đo thật.
const rebuild = async () => {
  for (const k of KINDS) {
    await s.run(`DROP INDEX IF EXISTS ${INDEXES[k]}`);
    await s.run(`CREATE INDEX ${INDEXES[k]} ON t(${COLS[k]})`);
  }
};
const measure = async (k: Kind, probe?: string) => {
  const r = await measureCapacity(adapter, { index: INDEXES[k], table: "t", probe });
  if (r.kind !== "conclusion") throw new Error(r.reasonKey);
  return r;
};
// Đọc thẳng từ pageinspect và pg_relation_size, không đi qua code đang kiểm.
const truth = async (name: string) => {
  const [m] = await s.adminSession((q) => q(`SELECT level::int FROM public.bt_metap('public.${name}')`));
  const [z] = await s.adminSession((q) => q(`SELECT pg_relation_size('public.${name}')::bigint::text`));
  return { height: Number(m.rows[0][0]) + 1, pages: Number(z.rows[0][0]) / 8192 };
};

beforeAll(async () => {
  await loadGuard();
  s = await createSession(await PGlite.create({ extensions: { pageinspect } }));
  await s.run(`CREATE TABLE t(i int, tx text, u uuid);
    INSERT INTO t SELECT g, md5(g::text), md5(g::text || 'u')::uuid FROM generate_series(1, 100000) g;
    CREATE TABLE e(i int); CREATE INDEX e_i ON e(i);
    CREATE TABLE small(i int); INSERT INTO small SELECT generate_series(1, 100); CREATE INDEX small_i ON small(i);`);
  await rebuild();
}, 180_000);

describe("measureCapacity", { timeout: 60_000 }, () => {
  it.each(KINDS)("AC1 %s 100k: height và indexPages khớp bt_metap và pg_relation_size", async (k) => {
    const r = await measure(k);
    const t = await truth(INDEXES[k]);
    expect([r.data.height, r.data.indexPages]).toEqual([t.height, t.pages]);
    expect(r.label).toBe("real");
    expect(r.data.rows).toBe(100000);
  });

  it("leafPages tính cả hidden, khớp bt_page_stats đếm trực tiếp", async () => {
    const r = await measure("text");
    const t = await truth("t_tx");
    const [c] = await s.adminSession((q) =>
      q(`SELECT count(*)::int FROM generate_series(1, ${t.pages - 1}) g, LATERAL public.bt_page_stats('public.t_tx', g::bigint) x WHERE x.btpo_level = 0`),
    );
    expect(r.data.leafPages).toBe(Number(c.rows[0][0]));
    expect(r.data.leafPages).toBeGreaterThan(200); // maxNodes 1 chỉ đọc 1 node, phần còn lại nằm ở hidden
    expect(r.data.leafFanout).toBeCloseTo(100000 / r.data.leafPages);
    expect(r.data.internalFanout).toBeGreaterThan(1);
  });

  it("ca biên: height 1 chưa có internalFanout, bảng rỗng NotSimulated", async () => {
    const r = await measureCapacity(adapter, { index: "small_i", table: "small" });
    if (r.kind !== "conclusion") throw new Error(r.reasonKey);
    expect(r.data.height).toBe(1);
    expect(r.data.internalFanout).toBeUndefined();
    expect(await measureCapacity(adapter, { index: "e_i", table: "e" })).toEqual({ kind: "not_simulated", reasonKey: "capacity.empty" });
  });

  it("readBTree NotSimulated thì chuyển nguyên reasonKey", async () => {
    expect(await measureCapacity(adapter, { index: "khong_co", table: "t" })).toEqual({ kind: "not_simulated", reasonKey: "btreeRead.notFound" });
  });

  it("tên bảng có dấu nháy không phá câu đếm", async () => {
    await expect(measureCapacity(adapter, { index: "t_i", table: 't"; DROP TABLE t; --' })).rejects.toThrow();
    expect(Number((await s.run("SELECT count(*) FROM t"))[0].rows[0][0])).toBe(100000);
  });

  it("AC5: pagesRead đo từ plan thật khi có probe, không có thì để trống; evidence nêu nguồn và điểm lấy mẫu", async () => {
    const withProbe = await measure("int", "SELECT * FROM t WHERE i = 54321");
    expect(withProbe.data.pagesRead).toBeGreaterThan(0);
    expect((await measure("int")).data.pagesRead).toBeUndefined();
    expect(withProbe.evidence[0]).toMatchObject({ kind: "pageinspect", messageKey: "capacity.measured", values: { index: "t_i", rows: 100000 } });
  });
});

describe("estimateCapacity", () => {
  const base: CapacitySample = { index: "x", table: "t", rows: 100000, height: 2, indexPages: 300, leafPages: 270, leafFanout: 370, internalFanout: 270, pagesRead: 3 };
  const NS = (reason: string) => ({ kind: "not_simulated", reasonKey: `capacity.${reason}` });

  it("AC4: dưới ngưỡng, số xấu, quá lớn, fanout hỏng thì NotSimulated", () => {
    for (const n of [500_000, 100, 0, -5, NaN, Infinity]) expect(estimateCapacity(base, n)).toEqual(NS("mustMeasure"));
    expect(estimateCapacity(base, 1_000_000_001)).toEqual(NS("tooLarge"));
    expect(estimateCapacity({ ...base, leafFanout: 0 }, 600_000)).toEqual(NS("noFanout"));
    expect(estimateCapacity({ ...base, leafFanout: NaN }, 600_000)).toEqual(NS("noFanout"));
    expect(estimateCapacity({ ...base, internalFanout: undefined }, 600_000)).toEqual(NS("noInternalFanout"));
    expect(estimateCapacity({ ...base, internalFanout: 1 }, 600_000)).toEqual(NS("noInternalFanout"));
    expect(estimateCapacity(base, 500_001).kind).toBe("conclusion");
    expect(estimateCapacity(base, 1_000_000_000).kind).toBe("conclusion");
  });

  it("AC5: nhãn estimated, evidence có điểm lấy mẫu, pagesRead cộng chênh tầng, không có trường thời gian", () => {
    const r = estimateCapacity(base, 5_000_000);
    if (r.kind !== "conclusion") throw new Error("expected conclusion");
    expect(r.label).toBe("estimated");
    expect(r.evidence[0]).toMatchObject({ messageKey: "capacity.estimated", values: { fromRows: 100000, rows: 5_000_000, index: "x" } });
    expect(r.data.pagesRead).toBe(3 + (r.data.height - 2));
    expect(JSON.stringify(r)).not.toMatch(/time|qps|latency|duration/i);
    const noPages = estimateCapacity({ ...base, pagesRead: undefined }, 5_000_000);
    if (noPages.kind !== "conclusion") throw new Error("expected conclusion");
    expect("pagesRead" in noPages.data).toBe(false);
  });

  it("samplePoint: indexBytes là số trang nhân 8192", () => {
    expect(samplePoint(base)).toEqual({ rows: 100000, height: 2, indexBytes: 300 * 8192, pagesRead: 3 });
  });
});

describe.skipIf(!BIG)("500k trên PGlite (T055_BIG=1)", { timeout: 600_000 }, () => {
  it("AC1 + AC2: khớp bt_metap ở 500k; mẫu 100k tính cho mức ngay trên 500k đúng số tầng, indexBytes lệch tối đa 15%", async () => {
    const samples = {} as Record<Kind, CapacitySample>;
    for (const k of KINDS) samples[k] = (await measure(k, `SELECT * FROM t WHERE ${COLS[k]} = ${PROBES[k]}`)).data;
    await s.run("INSERT INTO t SELECT g, md5(g::text), md5(g::text || 'u')::uuid FROM generate_series(100001, 500000) g");
    await rebuild();
    const out: string[] = [];
    for (const k of KINDS) {
      const real = await measure(k);
      const t = await truth(INDEXES[k]);
      expect([real.data.height, real.data.indexPages]).toEqual([t.height, t.pages]);
      // Hợp đồng chỉ ngoại suy trên 500.000: so 500.001 với số đo thật ở 500.000 (chênh một dòng, dưới 0,001%).
      const est = estimateCapacity(samples[k], 500_001);
      if (est.kind !== "conclusion") throw new Error(est.reasonKey);
      const dev = Math.abs(est.data.indexBytes - t.pages * 8192) / (t.pages * 8192);
      out.push(`${k}: real h=${t.height} bytes=${t.pages * 8192}; est h=${est.data.height} bytes=${est.data.indexBytes}; lech ${(dev * 100).toFixed(2)}%`);
      expect(est.data.height).toBe(t.height);
      expect(dev).toBeLessThanOrEqual(0.15);
    }
    console.log(out.join("\n"));
  });
});
