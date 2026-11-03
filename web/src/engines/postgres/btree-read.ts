import type { BTreeModel, BTreeNode, BTreePath } from "@/contracts/btree";
import type { Outcome } from "@/contracts/conclusion";
import type { QueryResult } from "@/contracts/engine";
import { decodeKey, KINDS, parseProbe, Unsupported, type Kind, type Val } from "./btree-key";

type Q = (sql: string, params?: unknown[]) => Promise<QueryResult[]>;
export type BTreeRead = { model: Outcome<BTreeModel>; path?: BTreePath };
const LEAF_KEYS = 100; // leaf chỉ giữ ngần này khóa đầu; totalKeys vẫn đủ
const BLOCK = 8192;
const C_COLLATIONS = ["C", "POSIX", "C.UTF-8", "C.utf8", "ucs_basic"];
const no = (reason: string): BTreeRead => ({ model: { kind: "not_simulated", reasonKey: `btreeRead.${reason}` } });

type Item = { off: number; child: number; natts: number; htidPage?: number; nulls: boolean; data: string | null };
type Stat = { live: number; prev: number; next: number; level: number };
type Page = { node: BTreeNode; allKeys: string[]; highKey?: Val[]; items: { vals: Val[]; htidPage?: number }[] };

const tidOf = (tid: unknown) => {
  const m = /^\((\d+),(\d+)\)$/.exec(String(tid ?? ""));
  return m ? { block: Number(m[1]), off: Number(m[2]) } : undefined;
};
const cmp = (a: bigint | string, b: bigint | string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Đọc cây thật của một index B-Tree trong schema public. Mọi SQL ở đây do code này viết; tên index chỉ đi vào dưới dạng tham số.
 * `q` phải chạy dưới search_path = pg_catalog (adminSession), nên hàm pageinspect gọi bằng `public.`.
 */
export async function readBTree(q: Q, index: string, o: { probeKey?: string; maxNodes?: number } = {}): Promise<BTreeRead> {
  const maxNodes = Math.max(1, Math.floor(o.maxNodes ?? 200));
  try {
    return await read(q, index, o.probeKey, maxNodes);
  } catch (e) {
    if (e instanceof Unsupported) return no("keyType");
    const code = (e as { code?: string }).code;
    if (code === "42P01" || code === "42704") return no("dropped"); // index bị xóa giữa lúc đọc
    if (code === "25P02") return no("inTransaction");
    throw e;
  }
}

async function read(q: Q, index: string, probeKey: string | undefined, maxNodes: number): Promise<BTreeRead> {
  const [meta] = await q(
    `SELECT c.oid::int, c.relkind::text, am.amname::text, pg_catalog.format('%I.%I', n.nspname, c.relname), CASE WHEN t.oid IS NULL THEN NULL ELSE pg_catalog.format('%I.%I', tn.nspname, t.relname) END,
            i.indisvalid, i.indnkeyatts::int,
            (SELECT collname::text FROM pg_collation WHERE oid = i.indcollation[0]), (SELECT datcollate::text FROM pg_database WHERE datname = current_database())
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_am am ON am.oid = c.relam
       LEFT JOIN pg_index i ON i.indexrelid = c.oid
       LEFT JOIN pg_class t ON t.oid = i.indrelid
       LEFT JOIN pg_namespace tn ON tn.oid = t.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind NOT IN ('c', 'f', 'm', 'p', 't')`,
    [index],
  );
  const row = meta.rows[0] as [number, string, string | null, string, string | null, boolean | null, number, string | null, string] | undefined;
  if (!row) return no("notFound");
  const [oid, relkind, am, qname, table, valid, nkey, collname, dbcoll] = row;
  if (relkind !== "i") return no("notIndex");
  if (am !== "btree") return no("notBtree");
  if (!valid) return no("invalid");

  const [attrs] = await q(
    `SELECT a.attname::text, a.atttypid::int FROM pg_attribute a WHERE a.attrelid = $1::oid AND a.attnum > 0 AND a.attnum <= $2 ORDER BY a.attnum`,
    [oid, nkey],
  );
  const columns = attrs.rows.map((r) => String(r[0]));
  const kinds = attrs.rows.map((r) => KINDS[Number(r[1])]);
  if (!kinds.length || kinds.some((k) => !k)) return no("keyType");
  const ks = kinds as Kind[];

  const [mp] = await q(`SELECT root::int, level::int FROM public.bt_metap($1::text)`, [qname]);
  const [size] = await q(`SELECT pg_relation_size($1::text::regclass)::bigint::text`, [qname]);
  const [rootPage, rootLevel] = (mp.rows[0] as number[]).map(Number);
  const totalPages = Number(size.rows[0][0]) / BLOCK;
  const done = (nodes: BTreeNode[], hidden: BTreeModel["hidden"], path?: BTreePath): BTreeRead => ({
    model: {
      kind: "conclusion",
      label: "real",
      data: { engine: "postgres", index, table: table ?? "", columns, height: rootLevel + 1, rootPage, nodes, hidden, totalPages },
      evidence: [{ kind: "pageinspect", messageKey: "btreeRead.evidence", values: { height: rootLevel + 1, pages: totalPages } }],
    },
    path,
  });
  if (rootPage === 0) return done([], []); // chưa có trang root

  // Thống kê mọi trang trong một câu: đủ để đếm trang theo tầng và biết anh em của mỗi trang.
  const [st] = await q(
    `SELECT g::int, s.type::text, s.live_items::int, s.btpo_prev::int, s.btpo_next::int, s.btpo_level::int
       FROM generate_series(1, $2::int - 1) g, LATERAL public.bt_page_stats($1::text, g::bigint) s`,
    [qname, totalPages],
  );
  const stats = new Map<number, Stat>();
  for (const [g, type, liveItems, prev, next, level] of st.rows as [number, string, number, number, number, number][]) {
    if (type === "r" || type === "i" || type === "l") stats.set(g, { live: liveItems, prev, next, level });
  }

  const cache = new Map<number, Page>();
  async function load(pages: number[]) {
    const need = [...new Set(pages)].filter((p) => !cache.has(p) && stats.has(p));
    if (!need.length) return;
    const [r] = await q(
      `SELECT g::int, i.itemoffset::int, i.ctid::text, i.nulls, i.data, i.htid::text
         FROM unnest($2::text::int[]) g, LATERAL public.bt_page_items($1::text, g::bigint) i ORDER BY g, i.itemoffset`,
      [qname, `{${need.join(",")}}`],
    );
    const by = new Map<number, Item[]>();
    for (const [g, off, ctid, nulls, data, htid] of r.rows as [number, number, string, boolean, string | null, string | null][]) {
      const t = tidOf(ctid);
      const list = by.get(g) ?? [];
      list.push({ off, child: t?.block ?? 0, natts: t?.off ?? 0, htidPage: tidOf(htid)?.block, nulls, data });
      by.set(g, list);
    }
    for (const p of need) {
      const s = stats.get(p)!;
      const items = by.get(p) ?? [];
      const hasHigh = s.next !== 0; // trang không phải bên phải cùng: mục 1 là high key
      // Mục pivot (trang trong và high key) có thể bị cắt bớt cột; số cột nằm ở 12 bit thấp của offset trong ctid.
      const dec = (it: Item, pivot: boolean): Val[] => {
        if (it.nulls) {
          // bt_page_items không trả bitmap null: chỉ chắc chắn khi index một cột.
          if (nkey > 1) throw new Unsupported("null in multi-column key");
          return [{ text: "NULL", cmp: "" }];
        }
        return decodeKey(it.data, ks, pivot ? it.natts & 0x0fff : nkey);
      };
      const body = items.filter((it) => !(hasHigh && it.off === 1));
      const vals = body.map((it) => ({ vals: dec(it, s.level > 0), htidPage: it.htidPage }));
      const allKeys = vals.map((v) => v.vals.map((x) => x.text).join(", "));
      cache.set(p, {
        node: {
          page: p,
          level: s.level,
          keys: s.level === 0 ? allKeys.slice(0, LEAF_KEYS) : allKeys,
          ...(s.level > 0 ? { children: body.map((it) => it.child) } : {}),
          ...(s.level === 0 && s.next ? { next: s.next } : {}),
          totalKeys: body.length,
        },
        allKeys,
        highKey: hasHigh && items[0] ? dec(items[0], true) : undefined,
        items: vals,
      });
    }
  }
  const get = async (p: number) => (await load([p]), cache.get(p));

  let path: BTreePath | undefined;
  const chosen = new Set<number>([rootPage]);
  const pv = probeKey === undefined ? undefined : parseProbe(ks[0], probeKey);
  // Text chỉ so theo byte, đúng với collation C; collation khác thì không dựng đường đi thay vì đoán.
  const textOk = ks[0] !== "text" || C_COLLATIONS.includes(!collname || collname === "default" ? dbcoll : collname);
  if (pv !== undefined && textOk) {
    const pages: number[] = [];
    let page = rootPage;
    for (let guard = 0; guard < 1000; guard++) {
      const pg = await get(page);
      if (!pg) break;
      pages.push(page);
      if (pg.node.level === 0) {
        const found = pg.items.find((it) => it.vals[0] && cmp(it.vals[0].cmp, pv) === 0);
        // Khóa lớn hơn hoặc bằng high key nằm ở trang bên phải.
        if (!found && pg.highKey?.[0] && cmp(pg.highKey[0].cmp, pv) <= 0 && pg.node.next) {
          page = pg.node.next;
          continue;
        }
        // Leaf quá dài thì cửa sổ khóa xoay quanh khóa tìm, để khóa đó luôn hiện.
        const at = found ? pg.items.indexOf(found) : -1;
        if (at >= LEAF_KEYS) {
          const from = Math.min(at - LEAF_KEYS / 2, pg.allKeys.length - LEAF_KEYS);
          pg.node.keys = pg.allKeys.slice(from, from + LEAF_KEYS);
        }
        path = { key: probeKey!, pages, ...(found?.htidPage !== undefined ? { heapPage: found.htidPage } : {}) };
        break;
      }
      // Con của mục cuối có khóa nhỏ hơn hẳn khóa tìm; mục đầu là âm vô cực.
      let child = pg.node.children![0];
      pg.items.forEach((it, i) => {
        if (i > 0 && it.vals[0] && cmp(it.vals[0].cmp, pv) < 0) child = pg.node.children![i];
      });
      page = child;
    }
    if (path) {
      for (const p of pages) {
        chosen.add(p);
        const s = stats.get(p);
        if (s?.prev) chosen.add(s.prev);
        if (s?.next) chosen.add(s.next);
      }
    }
  }

  let order: number[];
  if (stats.size <= maxNodes) order = [...stats.keys()];
  else {
    order = [...chosen];
    // Không có đường đi thì mở rộng từ root xuống theo từng tầng cho đến khi hết ngân sách.
    for (let i = 0; !path && i < order.length && order.length < maxNodes; i++) {
      if (stats.get(order[i])?.level === 0) continue;
      for (const c of (await get(order[i]))?.node.children ?? []) if (order.length < maxNodes && !order.includes(c)) order.push(c);
    }
    order = order.slice(0, Math.max(maxNodes, path ? chosen.size : 0));
  }
  await load(order);
  const nodes = order
    .map((p) => cache.get(p)?.node)
    .filter((n): n is BTreeNode => !!n)
    .sort((a, b) => b.level - a.level || a.page - b.page);
  const per = new Map<number, number>();
  for (const s of stats.values()) per.set(s.level, (per.get(s.level) ?? 0) + 1);
  for (const n of nodes) per.set(n.level, (per.get(n.level) ?? 0) - 1);
  const hidden = [...per].filter(([, c]) => c > 0).sort((a, b) => b[0] - a[0]).map(([level, count]) => ({ level, count }));
  return done(nodes, hidden, path);
}
