/* eslint-disable react/jsx-no-literals -- route thử của Playwright, không phải giao diện sản phẩm */
"use client";

import { useEffect, useState } from "react";
import type { EngineAdapter } from "@/contracts/engine";
import { createPostgresAdapter } from "@/engines/postgres/adapter";
import { parseSchema, planData, SCHEMA_QUERY } from "@/modules/data-lab/generate/plan-data";
import { estimateCapacity, measureCapacity, samplePoint } from "@/modules/what-if/capacity/capacity";
import { CapacityPanel } from "@/modules/what-if/capacity-ui";

const I = { internal: true } as const;
const PROBE = "SELECT * FROM accounts WHERE email = 'user42@example.com'";

export function Harness() {
  const [adapter, setAdapter] = useState<EngineAdapter>();
  const [target, setTarget] = useState({ index: "accounts_pkey", table: "accounts" });
  useEffect(() => {
    let dead = false;
    (async () => {
      const a = await createPostgresAdapter({ timeoutMs: 120_000 });
      const noIndex = new URLSearchParams(location.search).get("case") === "noindex";
      await a.execute("CREATE TABLE accounts (email text PRIMARY KEY, note text); INSERT INTO accounts VALUES ('keep1@x.io','a'),('keep2@x.io','b'),('keep3@x.io','c')");
      if (noIndex) setTarget({ index: "accounts_missing_ix", table: "accounts" });
      // Gọi trực tiếp, độc lập với giao diện: nạp bảng accounts_ref bằng cùng đường sinh dữ liệu rồi đo bằng measureCapacity.
      const ref = async (n: number) => {
        await a.execute("CREATE TABLE accounts_ref (email text, note text)", I);
        try {
          const r = await a.execute(SCHEMA_QUERY, I);
          const tables = parseSchema(r[0])
            .filter((t) => t.name === "accounts_ref")
            .map((t) => ({ ...t, columns: t.columns.map((c) => (c.name === "email" ? { ...c, isPrimaryKey: true } : c)) })); // khóa duy nhất như bảng accounts
          // Cùng cách dựng với giao diện: nạp trước, CREATE INDEX sau (index gọn hơn index lớn dần qua nhiều lần INSERT).
          for (const b of planData(tables, { accounts_ref: n }).batches) await a.execute(b, I);
          await a.execute("CREATE INDEX accounts_ref_ix ON accounts_ref (email)", I);
          return await measureCapacity(a, { index: "accounts_ref_ix", table: "accounts_ref", probe: PROBE.replace("accounts", "accounts_ref") });
        } finally {
          await a.execute("DROP TABLE accounts_ref", I);
        }
      };
      const w = window as unknown as Record<string, unknown>;
      w.cap = {
        ref,
        estimateCapacity,
        samplePoint,
        count: async () => (await a.execute("SELECT count(*) FROM accounts", I))[0].rows[0][0],
        leftovers: async () => (await a.execute("SELECT count(*) FROM pg_class WHERE relname LIKE 'sqllens_capacity%'", I))[0].rows[0][0],
      };
      if (!dead) setAdapter(a);
    })();
    return () => {
      dead = true;
    };
  }, []);
  return (
    <main className="mx-auto w-full max-w-3xl overflow-y-auto p-4">
      {adapter ? <CapacityPanel adapter={adapter} index={target.index} table={target.table} probe={PROBE} /> : <p>loading</p>}
    </main>
  );
}
