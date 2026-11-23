"use client";

/**
 * Host của spike: dựng payload thật một lần (PGlite 100k dòng + EXPLAIN + 100 dòng kết quả),
 * mã hóa bằng codec SP022, rồi phát lên server theo nhịp.
 *
 * Dùng cho AC2 và AC4: viewer chỉ đọc, host mới phát. Nhịp phát đặt bằng query `?every=`.
 */

import { useEffect, useRef, useState } from "react";
import { encodeSnapshot } from "@/lib/codec";
import { liveRoomOf, publish, runWorker, snapshotOf, sqlBytesOf, type WorkerResult } from "@/lib/measure";

const ROWS = 100_000;
const PROBE_KEY = "42";

export default function HostPage() {
  const [phase, setPhase] = useState("chờ");
  const [info, setInfo] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const room = q.get("room") ?? "r1";
    const every = Number(q.get("every") ?? 5000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop = false;

    (async () => {
      try {
        const w: WorkerResult = await runWorker(ROWS, PROBE_KEY, (p) => setPhase(p));
        setPhase("mã hóa payload");
        const snap = snapshotOf(ROWS);
        const live = liveRoomOf(ROWS, w.plan, w.result);
        const payload = await encodeSnapshot(live as never);
        const sqlBytes = sqlBytesOf(snap.tabs);

        const meta = {
          room,
          every,
          payloadBytes: payload.length,
          sqlBytes,
          hasPlan: true,
          rows: w.resultRowCount,
          btreeGzipBytes: (w.btrees["orders_customer_id_idx"] as { gzipBytes: number }).gzipBytes,
        };
        setInfo(meta);
        publish("host", meta);
        (window as unknown as Record<string, unknown>).__hostPayload = payload;
        (window as unknown as Record<string, unknown>).__hostReady = true;

        let n = 0;
        const send = async () => {
          if (stop) return;
          try {
            const r = await fetch(`/api/room/${room}/publish`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                v: 0,
                payload,
                sqlBytes,
                bytes: payload.length,
                hasPlan: true,
                rows: w.resultRowCount,
              }),
            });
            n++;
            setPhase(`đã phát ${n} lần (HTTP ${r.status})`);
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          }
          if (!stop) timer = setTimeout(send, every);
        };
        void send();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
        setPhase("lỗi");
        publish("host", { error: msg });
      }
    })();

    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <main>
      <p style={{ color: "#f0b429", fontSize: 13 }}>SPIKE Task159 — trang đo, không phải sản phẩm.</p>
      <h1 style={{ fontSize: 18 }}>Host — phát payload thật lên phòng</h1>
      <p style={{ color: "#9aa4af" }}>pha: {phase}</p>
      {err && <pre style={{ color: "#ff7b72", whiteSpace: "pre-wrap" }}>{err}</pre>}
      <pre style={{ fontSize: 12 }}>{JSON.stringify(info, null, 2)}</pre>
    </main>
  );
}
