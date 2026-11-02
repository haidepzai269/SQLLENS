import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";

let db;
const q = async (sql, params) => (await db.query(sql, params)).rows;
const int32 = (hex) => {
  const b = hex.split(" ").map((x) => parseInt(x, 16));
  return b.length >= 4 ? b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24) : null;
};
const blk = (ctid) => Number(ctid.match(/\((\d+),/)[1]);
const pagesOf = async (idx) => Number((await q(`select pg_relation_size('${idx}')/8192 p`))[0].p);
const lvl = (s) => Number(s.level ?? s.btpo_level);

const api = {
  async init() {
    const t = performance.now();
    db = await PGlite.create({ extensions: { pageinspect } });
    await db.exec("CREATE EXTENSION pageinspect");
    return { ms: Math.round(performance.now() - t), version: (await q("select version() v"))[0].v };
  },
  // wide=true makes long text keys so 10k rows still need an internal page.
  async seed(name, n, wide) {
    const t = performance.now();
    const key = wide ? "repeat(md5(g::text),4)" : "g";
    await db.exec(
      `CREATE TABLE ${name}(k ${wide ? "text" : "int"} PRIMARY KEY, v int); INSERT INTO ${name} SELECT ${key}, g FROM generate_series(1,${n}) g; ANALYZE ${name}`,
    );
    return { ms: Math.round(performance.now() - t), index_pages: await pagesOf(`${name}_pkey`) };
  },
  async inspect(name) {
    const idx = `${name}_pkey`;
    const meta = (await q(`select * from bt_metap('${idx}')`))[0];
    const n = await pagesOf(idx);
    const pages = [];
    for (let b = 1; b < n; b++) pages.push((await q(`select * from bt_page_stats('${idx}',${b})`))[0]);
    const show = async (s) =>
      s && {
        blkno: s.blkno,
        type: s.type,
        level: lvl(s),
        live_items: s.live_items,
        first_items: (await q(`select itemoffset, ctid, data from bt_page_items('${idx}',${s.blkno}) limit 4`)).map(
          (r) => `${r.itemoffset}:${r.ctid}:${String(r.data).slice(0, 40)}`,
        ),
      };
    return {
      meta: { root: meta.root, level: meta.level, fastroot: meta.fastroot, fastlevel: meta.fastlevel },
      pages: n - 1,
      root: await show(pages.find((s) => s.type === "r")),
      internal: await show(pages.find((s) => s.type === "i")),
      leaf: await show(pages.find((s) => s.type === "l")),
    };
  },
  // Walk root -> leaf for an int key using only bt_page_items; verify the leaf's heap tid equals the table's ctid.
  async descend(name, key) {
    const idx = `${name}_pkey`;
    let b = Number((await q(`select root from bt_metap('${idx}')`))[0].root);
    const path = [];
    for (;;) {
      const st = (await q(`select * from bt_page_stats('${idx}',${b})`))[0];
      let items = await q(`select * from bt_page_items('${idx}',${b})`);
      if (Number(st.btpo_next) !== 0) items = items.slice(1); // item 1 is the high key unless the page is rightmost
      const level = lvl(st);
      path.push({ blkno: b, type: st.type, level, items: items.length });
      if (level === 0) {
        const hit = items.find((r) => int32(r.data) === key);
        const heap = (await q(`select ctid::text c from ${name} where k=${key}`))[0]?.c;
        const htid = hit && (hit.htid ?? hit.ctid);
        return { path, found: !!hit, htid, heap, match: !!hit && htid === heap };
      }
      let child;
      for (const r of items) {
        if (r.data === "" || r.data === null || int32(r.data) <= key) child = blk(r.ctid);
        else break;
      }
      b = child;
    }
  },
  async readAll(name) {
    const idx = `${name}_pkey`;
    const t = performance.now();
    const n = await pagesOf(idx);
    let items = 0;
    for (let b = 1; b < n; b++) {
      await q(`select 1 from bt_page_stats('${idx}',${b})`);
      items += (await q(`select 1 from bt_page_items('${idx}',${b})`)).length;
    }
    return { pages: n - 1, items, ms: Math.round(performance.now() - t) };
  },
  async security(name) {
    const idx = `${name}_pkey`;
    const out = {};
    const tryq = async (label, sql) => {
      try {
        await db.exec(sql);
        out[label] = "OK";
      } catch (e) {
        out[label] = "ERR: " + e.message;
      }
    };
    out.session = (
      await q("select session_user su, current_user cu, (select rolsuper from pg_roles where rolname=session_user) super")
    )[0];
    out.bt_metap_acl = (await q("select proacl::text acl from pg_proc where proname='bt_metap'"))[0];
    await db.exec(`CREATE ROLE lowpriv NOLOGIN; GRANT SELECT ON ${name} TO lowpriv; GRANT USAGE ON SCHEMA public TO lowpriv`);
    await db.exec("SET ROLE lowpriv");
    out.low_current_user = (await q("select current_user cu"))[0].cu;
    await tryq("low_bt_metap", `select * from bt_metap('${idx}')`);
    await tryq("low_bt_page_stats", `select * from bt_page_stats('${idx}',1)`);
    await tryq("low_bt_page_items", `select * from bt_page_items('${idx}',1)`);
    await tryq("low_get_raw_page", `select get_raw_page('${name}',0)`);
    await tryq("low_select_table", `select count(*) from ${name}`);
    await tryq("low_create_extension", "CREATE EXTENSION IF NOT EXISTS amcheck");
    await tryq("low_set_role_postgres", "SET ROLE postgres");
    // Escape check: session_user is the superuser, so the low role can undo itself.
    await tryq("low_reset_role_then_call", `RESET ROLE; select * from bt_metap('${idx}')`);
    out.user_after_escape = (await q("select current_user cu"))[0].cu;
    await db.exec("RESET ROLE");
    await db.exec("CREATE ROLE granted NOLOGIN; GRANT EXECUTE ON FUNCTION bt_metap(text) TO granted; SET ROLE granted");
    await tryq("granted_bt_metap", `select * from bt_metap('${idx}')`);
    await tryq("granted_bt_page_stats", `select * from bt_page_stats('${idx}',1)`);
    await db.exec("RESET ROLE");
    await db.exec("CREATE ROLE mon NOLOGIN; GRANT pg_monitor, pg_read_all_data TO mon; SET ROLE mon");
    await tryq("pg_monitor_bt_metap", `select * from bt_metap('${idx}')`);
    await db.exec("RESET ROLE");
    return out;
  },
  async pgParse(sql) {
    const m = await import("/pg-parser.js");
    const t = performance.now();
    try {
      const r = await m.parse(sql);
      return { ok: true, ms: +(performance.now() - t).toFixed(1), stmt: Object.keys(r.stmts[0].stmt)[0] };
    } catch (e) {
      return { ok: false, ms: +(performance.now() - t).toFixed(1), message: e.message, pos: e.sqlDetails?.cursorPosition };
    }
  },
  async myParse(sql) {
    const m = await import("/my-parser.js");
    try {
      const r = m.parseMy(sql);
      return { ok: true, type: (Array.isArray(r) ? r[0] : r).type };
    } catch (e) {
      return { ok: false, message: String(e.message).split("\n")[0], loc: e.location?.start };
    }
  },
};
window.spike = api;
window.spikeReady = true;
