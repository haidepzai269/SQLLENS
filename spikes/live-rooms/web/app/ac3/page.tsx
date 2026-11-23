"use client";

/**
 * AC3 — Plan và B-Tree có đi qua được mà không cần WASM hay không.
 *
 * Đo byte thật của `BTreeModel` (do `readBTree` thật đọc bằng `pageinspect`) và của `Plan`
 * (do `EXPLAIN` thật sinh ra). Cả hai được mã hóa qua đúng đường codec SP022 để ra số byte
 * phải gửi cho viewer.
 *
 * Nhãn: byte là **Thật**; phần suy luận "viewer xem được gì" là **Ước lượng**, ghi riêng
 * trong ket_qua_do.md, không trộn vào con số.
 */

import { useEffect, useState } from "react";
import { encodeLikeShare, liveRoomOf, publish, runWorker, type WorkerResult } from "@/lib/measure";
import { normalizePostgres } from "@/lib/normalize/postgres";

const ROWS = 100_000;
const PROBE_KEY = "42";
const enc = new TextEncoder();

type Out = Record<string, unknown>;

export default function Ac3Page() {
  const [phase, setPhase] = useState("chờ");
  const [out, setOut] = useState<Out>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const w = await runWorker(ROWS, PROBE_KEY, (p) => alive && setPhase(p));
        if (!alive) return;
        setPhase("đo byte");

        // Plan thật, đi qua đúng hàm chuẩn hóa của app (`normalizePostgres`) rồi serialize.
        const plan = normalizePostgres(w.plan);
        const planShare = await encodeLikeShare(plan);
        const planRaw = await encodeLikeShare(w.plan);

        // B-Tree thật của từng index: byte JSON, byte gzip, và byte sau khi đi qua đúng
        // đường codec SP022 (`encodeLikeShare` = canonical JSON → gzip → base64url).
        const btrees: Record<string, unknown> = {};
        for (const [name, b] of Object.entries(w.btrees)) {
          if ("error" in b) {
            btrees[name] = b;
            continue;
          }
          const payload = await encodeLikeShare(b.model);
          const payloadWithPath = await encodeLikeShare({ model: b.model, path: b.path });
          btrees[name] = {
            height: b.height,
            rootPage: b.rootPage,
            totalPages: b.totalPages,
            indexBytes: b.indexBytes,
            nodesRead: b.nodesRead,
            hidden: b.hidden,
            keysInModel: b.keysInModel,
            totalKeysInModel: b.totalKeysInModel,
            readMs: b.readMs,
            jsonBytes: b.jsonBytes,
            jsonPathBytes: b.jsonPathBytes,
            gzipBytes: b.gzipBytes,
            gzipPathBytes: b.gzipPathBytes,
            // Byte thật phải gửi nếu viewer nhận model này qua một payload kiểu /share.
            sharePayloadBytes: payload.payload.length,
            sharePayloadWithPathBytes: payloadWithPath.payload.length,
            hasPath: b.hasPath,
            pathPages: b.pathPages,
          };
        }

        const o: Out = {
          rows: ROWS,
          probeKey: PROBE_KEY,
          plan: {
            // Plan đã chuẩn hóa (thứ gửi cho viewer) vs JSON gốc của PostgreSQL.
            normalizedJsonBytes: enc.encode(JSON.stringify(plan)).length,
            normalizedGzipBytes: planShare.gzipBytes,
            normalizedPayloadBytes: planShare.payload.length,
            rawJsonBytes: enc.encode(JSON.stringify(w.plan)).length,
            rawGzipBytes: planRaw.gzipBytes,
            nodeCount: countNodes(plan.root as { children?: unknown[] }),
          },
          btrees,
          result: { rows: w.resultRowCount, bytes: enc.encode(JSON.stringify(w.result)).length },
        };

        // Chi tiết cho câu hỏi "viewer thấy được gì": model có phải toàn bộ cây hay chỉ một
        // phần, và phần bị ẩn là bao nhiêu trang. Số này quyết định AC3 kết luận thế nào.
        const detail: Out = {};
        for (const [name, b] of Object.entries(w.btrees)) {
          if ("error" in b) {
            detail[name] = b;
            continue;
          }
          const model = b.model as { nodes: { keys: string[] }[]; hidden: { level: number; count: number }[] };
          detail[name] = {
            nodes: model.nodes.length,
            hidden: model.hidden,
            hiddenTotal: model.hidden.reduce((a, h) => a + h.count, 0),
            keysShown: model.nodes.reduce((a, n) => a + n.keys.length, 0),
            totalKeys: b.totalKeysInModel,
            pathPages: b.hasPath ? b.pathPages : null,
            height: b.height,
            totalPages: b.totalPages,
          };
        }
        publish("ac3detail", {
          main: detail["orders_customer_id_idx"],
          pk: detail["orders_pkey"],
        });

        // Payload ĐẦY ĐỦ mà viewer cần để xem Plan và B-Tree mà không có engine: snapshot 3 tab
        // + plan + kết quả + model B-Tree. Đây mới là số phải so với link /share, vì AC1 chỉ đo
        // snapshot + plan + kết quả, chưa có B-Tree.
        const base = liveRoomOf(ROWS, plan, w.result);
        const main = w.btrees["orders_customer_id_idx"];
        const pk = w.btrees["orders_pkey"];
        const trees = {
          orders_customer_id_idx: "error" in main ? null : main.model,
          orders_pkey: "error" in pk ? null : pk.model,
        };
        const withTrees = await encodeLikeShare({ ...base, btrees: trees });
        const withTreesPath = await encodeLikeShare({
          ...base,
          btrees: {
            orders_customer_id_idx: "error" in main ? null : { model: main.model, path: main.path },
            orders_pkey: "error" in pk ? null : { model: pk.model, path: pk.path },
          },
        });
        publish("ac3full", {
          basePayloadBytes: (await encodeLikeShare(base)).payload.length,
          withTreesPayloadBytes: withTrees.payload.length,
          withTreesPathPayloadBytes: withTreesPath.payload.length,
          withTreesGzipBytes: withTrees.gzipBytes,
          withTreesJsonBytes: withTrees.jsonBytes,
          overHardLimit: withTrees.payload.length > 32768,
        });

        setOut(o);
        setPhase("xong");
        publish("ac3", o);
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
        setPhase("lỗi");
        publish("ac3", { error: msg });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main>
      <p style={{ color: "#f0b429", fontSize: 13 }}>SPIKE Task159 — trang đo, không phải sản phẩm.</p>
      <h1 style={{ fontSize: 18 }}>AC3 — byte của Plan và B-Tree 100k dòng</h1>
      <p style={{ color: "#9aa4af" }}>pha: {phase}</p>
      {err && <pre style={{ color: "#ff7b72", whiteSpace: "pre-wrap" }}>{err}</pre>}
      <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(out, null, 2)}</pre>
    </main>
  );
}

function countNodes(n: { children?: unknown[] } | undefined): number {
  if (!n) return 0;
  const kids = (n.children ?? []) as { children?: unknown[] }[];
  return 1 + kids.reduce((s, k) => s + countNodes(k), 0);
}
