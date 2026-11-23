"use client";

/**
 * AC1 — byte mỗi lần phát.
 *
 * Trang này chạy trong Chromium thật trên bản `next build` + `next start`. Nó dựng dữ liệu
 * thật trong PGlite (100k dòng, EXPLAIN thật, 100 dòng kết quả thật), rồi đo:
 *   (a) payload của phòng live (snapshot + plan + result) qua `encodeSnapshot` của SP022;
 *   (b) cùng dữ liệu đó dưới dạng URL fragment `/share` hiện có.
 *
 * (b) nhỏ hơn (a) một cách hợp lý vì `/share` chỉ mang 3 tab, không mang plan và result.
 * Vì vậy trang đo luôn cả payload "chỉ snapshot" để so sánh táo-với-táo.
 */

import { useEffect, useState } from "react";
import { encodeSnapshot } from "@/lib/codec";
import { SNAPSHOT_HARD_LIMIT_BYTES, SNAPSHOT_WARN_LIMIT_BYTES, MAX_SNAPSHOT_TABS, SnapshotError } from "@/lib/snapshot";
import {
  encodeLikeShare,
  liveRoomOf,
  publish,
  runWorker,
  snapshotOf,
  sqlBytesOf,
  type WorkerResult,
} from "@/lib/measure";

const ROWS = 100_000;
const PROBE_KEY = "42";
const enc = new TextEncoder();

type Row = {
  label: string;
  payloadBytes: number;
  jsonBytes: number;
  gzipBytes: number;
  sqlBytes: number;
  note: string;
};

export default function Ac1Page() {
  const [phase, setPhase] = useState("chờ");
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const w: WorkerResult = await runWorker(ROWS, PROBE_KEY, (p) => alive && setPhase(p));
        if (!alive) return;
        setPhase("đo byte");

        const snap = snapshotOf(ROWS);
        const live = liveRoomOf(ROWS, w.plan, w.result);

        // (a) payload phòng live: snapshot + plan + result, qua đúng encodeSnapshot của SP022.
        const livePayload = await encodeSnapshot(live as never);
        // (b) đúng dữ liệu đó nhưng ở dạng link /share: chỉ 3 tab, không plan, không result.
        const sharePayload = await encodeSnapshot(snap);
        // Đối chứng: snapshot + plan + result nhưng KHÔNG qua encodeSnapshot (tự nén), để
        // chắc rằng encodeSnapshot không thêm gì bất thường.
        const liveRaw = await encodeLikeShare(live);

        const sqlBytes = sqlBytesOf(snap.tabs);

        // Đo phần byte QUY ĐƯỢC CHO SQL: mã hóa lại đúng payload đó nhưng rỗng nội dung SQL.
        // Chênh lệch là số byte nén thật sự do SQL chiếm. Đây là phép đo, không phải suy đoán.
        const liveNoSql = { ...live, tabs: live.tabs.map((t) => ({ name: t.name, sql: "" })) };
        const liveNoSqlPayload = await encodeSnapshot(liveNoSql as never);
        const shareNoSql = { ...snap, tabs: snap.tabs.map((t) => ({ name: t.name, sql: "" })) };
        const shareNoSqlPayload = await encodeSnapshot(shareNoSql);

        const out: Row[] = [
          {
            label: "(a) payload phòng live — 3 tab + plan + 100 dòng",
            payloadBytes: livePayload.length,
            jsonBytes: liveRaw.jsonBytes,
            gzipBytes: liveRaw.gzipBytes,
            sqlBytes,
            note: "encodeSnapshot(SP022) trên SnapshotV1 + plan + result",
          },
          {
            label: "(b) link /share hiện có — chỉ 3 tab",
            payloadBytes: sharePayload.length,
            jsonBytes: enc.encode(JSON.stringify(snap)).length,
            gzipBytes: 0,
            sqlBytes,
            note: "encodeSnapshot(SP022) trên SnapshotV1 thuần",
          },
        ];

        // Ca biên: vượt 32 KB và vượt 100 tab. Đo cả hai ở phía phát.
        const edges: Record<string, unknown> = {};

        // 1) Kết quả lớn dần, mỗi dòng KHÁC NHAU (id tăng) để gzip không nén được nhờ lặp.
        // Đây mới là ca thật: người dùng chạy câu trả về nhiều dòng.
        for (const n of [500, 2000, 5000, 10000, 20000]) {
          const big = liveRoomOf(ROWS, w.plan, {
            columns: w.result.columns,
            rows: Array.from({ length: n }, (_, i) => {
              const base = w.result.rows[i % w.result.rows.length];
              return [String(1_000_000 + i), ...base.slice(1)];
            }),
          });
          try {
            const p = await encodeSnapshot(big as never);
            edges[`result_${n}_rows`] = { ok: true, bytes: p.length };
          } catch (e) {
            edges[`result_${n}_rows`] = {
              ok: false,
              code: e instanceof SnapshotError ? e.code : "unknown",
              message: e instanceof Error ? e.message : String(e),
            };
          }
        }

        // 1b) SQL dài dần (một tab chứa câu lặp lại nhưng khác tham số), để biết trần 32 KB
        // chặn ở đâu nếu người dùng dán nhiều tab.
        for (const n of [20_000, 40_000, 80_000]) {
          const bigSql = { ...snap, tabs: [...snap.tabs, { name: "big.sql", sql: "SELECT " + "a".repeat(n) + ";" }] };
          try {
            const p = await encodeSnapshot(bigSql as never);
            edges[`sql_${n}_chars`] = { ok: true, bytes: p.length };
          } catch (e) {
            edges[`sql_${n}_chars`] = {
              ok: false,
              code: e instanceof SnapshotError ? e.code : "unknown",
              message: e instanceof Error ? e.message : String(e),
            };
          }
        }

        // 2) 101 tab.
        const manyTabs = {
          ...snap,
          tabs: Array.from({ length: MAX_SNAPSHOT_TABS + 1 }, (_, i) => ({ name: `t${i}.sql`, sql: "SELECT 1;" })),
        };
        try {
          const p = await encodeSnapshot(manyTabs as never);
          edges[`tabs_${MAX_SNAPSHOT_TABS + 1}`] = { ok: true, bytes: p.length };
        } catch (e) {
          edges[`tabs_${MAX_SNAPSHOT_TABS + 1}`] = {
            ok: false,
            code: e instanceof SnapshotError ? e.code : "unknown",
            message: e instanceof Error ? e.message : String(e),
          };
        }

        // 3) 100 tab vừa đúng trần.
        const atLimit = {
          ...snap,
          tabs: Array.from({ length: MAX_SNAPSHOT_TABS }, (_, i) => ({ name: `t${i}.sql`, sql: "SELECT 1;" })),
        };
        try {
          const p = await encodeSnapshot(atLimit as never);
          edges[`tabs_${MAX_SNAPSHOT_TABS}`] = { ok: true, bytes: p.length };
        } catch (e) {
          edges[`tabs_${MAX_SNAPSHOT_TABS}`] = {
            ok: false,
            code: e instanceof SnapshotError ? e.code : "unknown",
            message: e instanceof Error ? e.message : String(e),
          };
        }

        const m = {
          rows: ROWS,
          probeKey: PROBE_KEY,
          limits: { hard: SNAPSHOT_HARD_LIMIT_BYTES, warn: SNAPSHOT_WARN_LIMIT_BYTES, maxTabs: MAX_SNAPSHOT_TABS },
          planJsonBytes: enc.encode(JSON.stringify(w.plan)).length,
          resultBytes: enc.encode(JSON.stringify(w.result)).length,
          resultRowCount: w.resultRowCount,
          resultColumns: w.result.columns,
          tabSqlBytes: snap.tabs.map((t) => ({ name: t.name, sqlBytes: enc.encode(t.sql).length })),
          // Byte mà SQL chiếm trong payload đã nén: hiệu của payload có SQL và payload rỗng SQL.
          sqlAttributable: {
            live: { withSql: livePayload.length, withoutSql: liveNoSqlPayload.length, delta: livePayload.length - liveNoSqlPayload.length },
            share: { withSql: sharePayload.length, withoutSql: shareNoSqlPayload.length, delta: sharePayload.length - shareNoSqlPayload.length },
            rawSqlBytes: sqlBytes,
          },
          edges,
          btreeGzipBytes: (w.btrees["orders_customer_id_idx"] as { gzipBytes: number }).gzipBytes,
        };
        setRows(out);
        setMeta(m);
        setPhase("xong");
        publish("ac1", { rows: out, meta: m });
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
        setPhase("lỗi");
        publish("ac1", { error: msg });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main>
      <p style={{ color: "#f0b429", fontSize: 13 }}>
        SPIKE Task159 — không phải sản phẩm. Trang này chỉ để đo.
      </p>
      <h1 style={{ fontSize: 18 }}>AC1 — byte mỗi lần phát</h1>
      <p style={{ color: "#9aa4af" }}>pha: {phase}</p>
      {err && <pre style={{ color: "#ff7b72", whiteSpace: "pre-wrap" }}>{err}</pre>}
      {rows.length > 0 && (
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["mục", "byte payload", "byte JSON", "byte gzip", "byte SQL", "ghi chú"].map((h) => (
                <th key={h} style={{ border: "1px solid #30363d", padding: "4px 8px", textAlign: "left" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td style={{ border: "1px solid #30363d", padding: "4px 8px" }}>{r.label}</td>
                <td style={{ border: "1px solid #30363d", padding: "4px 8px" }}>{r.payloadBytes}</td>
                <td style={{ border: "1px solid #30363d", padding: "4px 8px" }}>{r.jsonBytes}</td>
                <td style={{ border: "1px solid #30363d", padding: "4px 8px" }}>{r.gzipBytes || "-"}</td>
                <td style={{ border: "1px solid #30363d", padding: "4px 8px" }}>{r.sqlBytes}</td>
                <td style={{ border: "1px solid #30363d", padding: "4px 8px", color: "#9aa4af" }}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {Object.keys(meta).length > 0 && (
        <pre style={{ fontSize: 11, color: "#9aa4af", whiteSpace: "pre-wrap" }}>{JSON.stringify(meta, null, 2)}</pre>
      )}
    </main>
  );
}
