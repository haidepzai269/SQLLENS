/* eslint-disable react/jsx-no-literals -- route thử của Playwright, không phải giao diện sản phẩm */
"use client";

import { useEffect, useState } from "react";
import type { EngineAdapter } from "@/contracts/engine";
import { createPostgresAdapter } from "@/engines/postgres/adapter";
import { WhatIfCompare } from "@/modules/what-if/compare-ui/what-if-compare";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Harness() {
  const [adapter, setAdapter] = useState<EngineAdapter>();
  const [probe, setProbe] = useState("SELECT * FROM orders WHERE customer_id = 42");
  useEffect(() => {
    let a: EngineAdapter | undefined;
    let dead = false;
    void (async () => {
      a = await createPostgresAdapter();
      await a.execute("CREATE TABLE orders(id int primary key, customer_id int, note text)");
      await a.execute("INSERT INTO orders SELECT g, g % 1000, 'n' || g FROM generate_series(1, 20000) g");
      await a.execute("ANALYZE orders");
      if (dead) return;
      const real = a;
      const calls: string[] = [];
      // Bọc thật: lần chạy có chú thích `-- slow` trả muộn, để thử câu trả về muộn không ghi đè câu mới.
      const wrapped: EngineAdapter = {
        ...real,
        tryChange: async (c, p) => {
          calls.push(c);
          const r = await real.tryChange(c, p);
          if (/-- slow/.test(c)) await sleep(2500);
          return r;
        },
      };
      const checksum = async () =>
        String((await real.execute("SELECT md5(string_agg(o::text, '' ORDER BY id)) FROM orders o", { internal: true })).at(-1)!.rows[0][0]);
      const indexCount = async () =>
        Number((await real.execute("SELECT count(*) FROM pg_indexes WHERE tablename='orders'", { internal: true })).at(-1)!.rows[0][0]);
      Object.assign(window, { whatif: { checksum, indexCount, calls, history: () => real.history().length }, setProbe });
      setAdapter(wrapped);
    })();
    return () => {
      dead = true;
      void a?.dispose();
    };
  }, []);
  if (!adapter) return <p className="p-4 text-sm" data-testid="booting">booting</p>;
  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
      <WhatIfCompare adapter={adapter} probe={probe} />
    </main>
  );
}
