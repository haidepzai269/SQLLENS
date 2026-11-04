/* eslint-disable react/jsx-no-literals -- route thử của Playwright, không phải giao diện sản phẩm */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { EngineAdapter } from "@/contracts/engine";
import type { EvidencePack } from "@/contracts/mentor";
import { createPostgresAdapter } from "@/engines/postgres/adapter";
import { MentorPanel } from "@/modules/mentor/ui/mentor-panel";

const PROBE = "SELECT * FROM orders WHERE customer_id = 42";

export function Harness() {
  const [adapter, setAdapter] = useState<EngineAdapter>();
  const evidence = useMemo<EvidencePack>(() => ({ engine: "postgres", sql: PROBE }), []);
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
      const stats = { cancels: 0, rebuilds: 0, explains: 0, tryChanges: 0 };
      // Bọc thật: câu có chú thích `-- hang` treo cho tới khi cancel, để thử nút dừng giữa bước chạy thử.
      let release: (() => void) | undefined;
      const wrapped: EngineAdapter = {
        ...real,
        explain: async (sql, o) => {
          stats.explains++;
          if (/-- hang/.test(sql)) await new Promise<void>((r) => (release = r));
          return real.explain(sql, o);
        },
        tryChange: (c, p) => {
          stats.tryChanges++;
          return real.tryChange(c, p);
        },
        cancel: async () => {
          stats.cancels++;
          release?.();
          await real.cancel();
        },
        rebuild: async () => {
          stats.rebuilds++;
          await real.rebuild();
        },
      };
      const checksum = async () =>
        String((await real.execute("SELECT md5(string_agg(o::text, '' ORDER BY id)) FROM orders o", { internal: true })).at(-1)!.rows[0][0]);
      const indexCount = async () =>
        Number((await real.execute("SELECT count(*) FROM pg_indexes WHERE tablename='orders'", { internal: true })).at(-1)!.rows[0][0]);
      Object.assign(window, { mentor: { stats, checksum, indexCount } });
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
      <MentorPanel adapter={adapter} evidence={evidence} probe={PROBE} />
    </main>
  );
}
