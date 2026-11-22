"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown, ChevronUp, Lock, Play, Terminal as TerminalIcon, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { ResultGrid } from "@/components/result-grid/result-grid";
import { SqlErrorView } from "@/components/result-grid/sql-error-view";
import { parseEngine } from "@/components/shell/engine-tabs";
import { useShell } from "@/components/shell/shell-provider";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { ZonePlaceholder } from "@/components/shell/zone-placeholder";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SAMPLE_SQL } from "@/components/sql-editor/samples";
import { SampleButton } from "@/components/sql-editor/sample-button";
import { SqlEditor } from "@/components/sql-editor/sql-editor";
import type { Conclusion } from "@/contracts/conclusion";
import { FindingsPanel, type Focus } from "@/modules/findings/ui/findings-panel";
import { hitsOf, useFindings } from "@/modules/findings/ui/use-findings";
import { EngineError, type EngineAdapter, type LoadProgress, type QueryResult } from "@/contracts/engine";
import { createPostgresAdapter } from "@/engines/postgres/adapter";
import { createSqliteAdapter, type SqliteAdapter } from "@/engines/sqlite/adapter";
import { assertSqliteSafe, SQLITE_GUARD_MESSAGE_KEY } from "@/engines/sqlite/guard";
import { GenerateDialog, type StopCode } from "@/modules/data-lab/ui/generate-dialog";
import { parseSchema } from "@/modules/data-lab/generate/plan-data";
import { classifyInput, prepareDump } from "@/modules/sql-intake/classify";
import { inferSchema, type InferWarning } from "@/modules/sql-intake/infer";
import { disposeParser, parseSql, type ParseOutcome } from "@/modules/sql-intake/parser";
import { ConfirmSchemaDialog } from "@/modules/sql-intake/ui/confirm-schema-dialog";
import { DumpNotice } from "@/modules/sql-intake/ui/dump-notice";
import { toDraft, type Draft } from "@/modules/sql-intake/ui/schema-draft";
import { useAuth } from "@/modules/auth/auth-provider";
import { GuestNote, LockedTab, guestCheck, guestRunDone, type GuestGate } from "@/modules/auth/guest";
import type { Failure } from "@/modules/auth/api";
import { MysqlGate, SandboxFailureView } from "@/modules/auth/mysql-access";
import { createMysqlAdapter, SandboxError, type MysqlAdapter } from "@/engines/mysql/adapter";
import { usePathname, useRouter } from "@/i18n/navigation";
import { stashSql, takeSql } from "@/modules/auth/sql-stash";
import { Tip } from "@/components/shell/tip";
import { applyStatementFix } from "@/components/sql-editor/statement-at-cursor";
import { UpgradeModal } from "@/modules/vip/upgrade-modal";
import { Stage, type StageFocus, type StageRun } from "./stage/stage";
import { packStash, unpackStash } from "./stage/stash";
import {
  lastSelect,
  memoExplain,
  MYSQL_SCHEMA_QUERY,
  mysqlSchema,
  SQLITE_SCHEMA_QUERY,
  sqliteSchema,
  STAGE_SCHEMA_QUERY,
} from "./stage/stage-data";
import { StatementList } from "./statement-list";
import type { ForeignKeyRelation } from "@/modules/editor/heuristics/types";
import { useWorkspaceStore } from "@/modules/workspace/store";
import { bootWorkspace, disposeWorkspace } from "@/modules/workspace/hydrate";
import type { WorkspaceScope } from "@/modules/workspace/types";
import { TabBar } from "@/modules/workspace/components/tab-bar";
import { ImportGuestBanner } from "@/modules/workspace/components/import-guest-banner";
import { SqliteFilePanel } from "@/modules/workspace/components/sqlite-file-panel";
import { changesSchema, notifySchemaChanged, useSchemaChangedNotice, useTabRuntime } from "@/modules/workspace/tab-runtime";
import { bindEngine, onProjectSwitch, releaseProjectResources } from "@/modules/workspace/engine-binding";
import { EngineReleaseToast } from "@/modules/workspace/components/engine-release-toast";
import { ConclusionBadge } from "@/components/ui/conclusion-badge";

type RunData = { statements: number; rows: number };
type Stop = "cancelled" | "timeout" | "worker_crashed";
type State =
  | { phase: "idle" | "loading" | "running" | "rebuilding" }
  | { phase: "sandbox_error"; failure: Failure; count: number }
  | { phase: "load_error"; message: string }
  | { phase: "sql_error"; message: string; position?: number; sql: string }
  | { phase: "guard_error"; reasonKey: string; statementIndex?: number }
  | { phase: "stopped"; code: Stop; count: number; rebuildError?: string }
  | { phase: "done"; results: QueryResult[]; conclusion: Conclusion<RunData> };
// Nhật ký chỉ có loại sự kiện và số liệu, không bao giờ có nội dung SQL.
type Log = { kind: "loaded" | "ran" | "error" | "cancelled" | "timeout" | "worker_crashed" | "rebuilt" | "note" | "errorAt" | "blocked" | "escaped" | "guardOff"; n?: number; text?: string };

// Engine báo position 1-based theo code point; ô soạn cần chỉ số 0-based theo UTF-16.
const engineToEditorPos = (sql: string, p: number) => Array.from(sql).slice(0, p - 1).join("").length;
const IDLE: State = { phase: "idle" };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const mb = (b?: number) => (b === undefined ? undefined : (b / 1048576).toFixed(1));
const stopCode = (e: unknown): Stop | null =>
  e instanceof EngineError && (e.code === "cancelled" || e.code === "timeout" || e.code === "worker_crashed") ? e.code : null;

function Pane({ title, children, headerRight, bar }: { title: ReactNode; children: ReactNode; headerRight?: ReactNode; bar?: ReactNode }) {
  return (
    <div className="flex min-h-full min-w-0 flex-col">
      <div className="sticky top-0 z-10 flex h-[var(--h-bar)] flex-none items-center justify-between border-b border-line bg-surface px-[var(--edge)] font-semibold">
        <span className="flex items-center gap-1.5">{title}</span>
        {headerRight && <div className="flex items-center gap-1.5">{headerRight}</div>}
      </div>
      {bar}
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-[var(--edge)]">{children}</div>
    </div>
  );
}

export function LabWorkspace() {
  const t = useTranslations("lab");
  const ts = useTranslations("shell");
  const { setMobileTab, state: shell, toggle } = useShell();
  const searchParams = useSearchParams();
  const engine = parseEngine(searchParams.get("engine"));
  const { sqlRef, markAnon, status: authStatus, user } = useAuth();
  const workspaceScope = useMemo<WorkspaceScope>(
    () => (user?.id ? { kind: "user", userId: user.id } : { kind: "guest" }),
    [user],
  );

  const activeTab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const sql = activeTab?.sql ?? "";
  const updateTabSql = useWorkspaceStore((s) => s.updateTabSql);
  const saveState = useWorkspaceStore((s) => s.saveState);
  const [warnStorageDismissed, setWarnStorageDismissed] = useState(false);
  const tw = useTranslations("workspace");

  const tabRuntime = useTabRuntime();
  const schemaNotice = useSchemaChangedNotice();

  // Workspace nạp bất đồng bộ: gõ ngay sau khi editor hiện mà store chưa có tab thì chữ
  // vẫn nằm trong CodeMirror nhưng không vào store, F5 là mất. Giữ lại rồi gán cho tab
  // đầu tiên ngay khi boot xong.
  const pendingSqlRef = useRef<string | null>(null);

  const setSql = useCallback(
    (next: string | ((prev: string) => string)) => {
      const curActiveId = useWorkspaceStore.getState().activeTabId;
      if (!curActiveId) {
        const cur = pendingSqlRef.current ?? "";
        pendingSqlRef.current = typeof next === "function" ? next(cur) : next;
        return;
      }
      const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === curActiveId);
      const currentSql = tab?.sql ?? "";
      const val = typeof next === "function" ? next(currentSql) : next;
      updateTabSql(curActiveId, val);
    },
    [updateTabSql],
  );

  // Rời Lab hoặc đổi tài khoản: ghi nốt phần đang chờ rồi đóng kết nối IndexedDB
  // của phiên cũ, không để subscription sống tiếp sau khi component đã gỡ.
  useEffect(() => {
    void bootWorkspace(workspaceScope)
      .then(() => {
        const pending = pendingSqlRef.current;
        if (!pending) return;
        pendingSqlRef.current = null;
        // Tab đầu tiên đã có nháp thì không ghi đè; chỉ nhận phần gõ trước lúc boot xong.
        setSql((cur) => (cur === "" ? pending : cur));
      })
      .catch(() => {});
    return () => {
      void disposeWorkspace();
    };
  }, [workspaceScope, setSql]);

  const [selection, setSelection] = useState<{ hasSelection: boolean; text: string }>({ hasSelection: false, text: "" });
  const isVip = Boolean(user?.isVip || user?.role === "vip");
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const tm = useTranslations("mysql");
  const router = useRouter();
  const pathname = usePathname();

  // AC2, AC3: Đồng bộ engine hai chiều giữa dự án và URL, nhả tài nguyên container khi rời MySQL
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const projects = useWorkspaceStore((s) => s.projects);
  const prevProjectIdRef = useRef<string | null>(null);
  const prevEngineRef = useRef(engine);

  useEffect(() => {
    if (!activeProjectId) return;
    const prevId = prevProjectIdRef.current;
    const prevEng = prevEngineRef.current;
    prevProjectIdRef.current = activeProjectId;
    prevEngineRef.current = engine;

    const currentProj = projects.find((p) => p.id === activeProjectId);
    if (!currentProj) return;

    // `?engine=` trên URL là người dùng chủ động chọn engine (bấm tab engine, hoặc mở link
    // `?engine=mysql`): tôn trọng URL và ghi engine đó vào dự án. Ghi đè URL bằng engine cũ
    // của dự án (hành vi trước Task158) làm `?engine=mysql` bị đổi ngược về postgres.
    // Không có `?engine=` thì giữ nguyên hành vi cũ: URL theo engine của dự án.
    // Chỉ một trong hai nhánh chạy nên không có vòng `router.replace` qua lại.
    const syncEngine = () => {
      if (searchParams.has("engine")) bindEngine(activeProjectId, engine);
      else router.replace(`${pathname}?engine=${currentProj.engine}`);
    };

    // Trường hợp 1: Chuyển dự án (activeProjectId thay đổi)
    if (prevId !== null && prevId !== activeProjectId) {
      void onProjectSwitch(prevId, activeProjectId);
      if (currentProj.engine !== engine) syncEngine();
      return;
    }

    // Trường hợp 2: Người dùng đổi Engine trên header (URL engine thay đổi trên cùng một dự án)
    if (prevEng !== engine) {
      if (currentProj.engine !== engine) {
        // Nếu rời MySQL (từ mysql sang postgres/sqlite), nhả container
        if (currentProj.engine === "mysql") {
          void releaseProjectResources(activeProjectId);
        }
        bindEngine(activeProjectId, engine);
      }
      return;
    }

    // Trường hợp 3: Khi mới mount/F5 mà URL không khớp engine của project
    if (prevId === null && currentProj.engine !== engine) {
      syncEngine();
    }
  }, [activeProjectId, projects, engine, pathname, router, searchParams]);
  const [gate, setGate] = useState<GuestGate | null>(null); // lý do khách bị chặn ở lần bấm Chạy gần nhất
  const guestRun = useRef(false); // lần chạy này của khách, tính lượt khi chạy xong
  // Câu hỏi của Mentor đi chung bản lưu tạm: lab giữ sqlRef, Mentor ghi câu hỏi qua askRef, đọc ra là bản ghép (stash.ts).
  const sqlNow = useRef("");
  const askText = useRef("");
  const askRef = useMemo<RefObject<string>>(
    () => ({
      get current() {
        return packStash(sqlNow.current, askText.current); // LoginDialog đọc để lưu tạm: phải là bản ghép
      },
      set current(v: string) {
        askText.current = v;
        sqlRef.current = packStash(sqlNow.current, v);
      },
    }),
    [sqlRef],
  );
  useEffect(() => {
    sqlNow.current = sql;
    sqlRef.current = packStash(sql, askText.current); // để hộp thoại đăng nhập lưu tạm đúng SQL đang soạn
  }, [sql, sqlRef]);
  // Quay về từ đăng nhập: trả SQL đã lưu (và xóa bản lưu) nếu ô soạn còn trống.
  useEffect(() => {
    const saved = takeSql();
    if (!saved) return;
    const { sql: back, ask } = unpackStash(saved);
    if (back) setSql((cur) => (cur === "" ? back : cur));
    if (ask) stashSql(ask); // trả lại cho ô hỏi của Mentor, nó tự đọc khi tab được mở
  }, [setSql]);
  // eff: SQL đã bỏ khối COPY và LOCK (prepareDump), là chuỗi thật sự được parse và chạy; vị trí trong outcome tính trên eff.
  const [parsed, setParsed] = useState<{ sql: string; engine: typeof engine; outcome: ParseOutcome; eff: string; removed: { copyBlocks: number; lockStatements: number } } | null>(null);
  // Bản nháp schema suy từ query, gắn với đúng sql và engine đã sinh ra nó: query đổi thì bỏ.
  const [draft, setDraft] = useState<{ sql: string; engine: typeof engine; d: Draft; warnings: InferWarning[] } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [schemaError, setSchemaError] = useState<string | undefined>();
  const applied = useRef<string | null>(null); // sql đã được tạo schema xong, chạy lại không hỏi nữa
  const runBtn = useRef<HTMLButtonElement | null>(null);
  const tin = useTranslations("sql-intake");
  const [selected, setSelected] = useState(0);
  const [pendingSample, setPendingSample] = useState<string | null>(null);
  // Trạng thái, nhật ký và cảnh stage thuộc về engine đã chạy ra chúng (owner); đổi sang engine khác thì hiện như chưa chạy, quay lại thì thấy lại.
  const [rawState, setState] = useState<State>(IDLE);
  const [owner, setOwner] = useState(engine);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [rawLog, setLog] = useState<Log[]>([]);
  const [mysqlReady, setMysqlReady] = useState(false);
  const pool = useRef<Partial<Record<typeof engine, Promise<EngineAdapter> | null>>>({});
  const adapter = useMemo(
    () => ({
      get current() {
        return pool.current[engine] ?? null;
      },
      set current(v: Promise<EngineAdapter> | null) {
        pool.current[engine] = v;
      },
    }),
    [engine],
  );
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const note = (l: Log) => setLog((x) => [...x.slice(-49), l]);
  const [hasTables, setHasTables] = useState(false);
  const [tablesSchema, setTablesSchema] = useState<Record<string, string[]>>({});
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyRelation[]>([]);
  // Dữ liệu cho vùng stage của lần chạy gần nhất đã xong; null khi đang chạy, lỗi, bị hủy hay engine dựng lại, để tab không hiện số cũ.
  const [rawStageRun, setStageRun] = useState<StageRun | null>(null);
  const mine = owner === engine;
  const state = mine ? rawState : IDLE;
  const log = mine ? rawLog : [];
  const stageRun = mine ? rawStageRun : null;
  // Rời MySQL: phiên bị hủy (effect bên dưới), nên bỏ luôn màn hình của nó.
  const [lastEngine, setLastEngine] = useState(engine);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [allOpen, setAllOpen] = useState<boolean | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  if (lastEngine !== engine) {
    setLastEngine(engine);
    setDurationMs(null);
    setAllOpen(null);
    setTablesSchema({});
    setForeignKeys([]);
    setHasTables(false);
    if (lastEngine === "mysql") {
      setMysqlReady(false);
      if (owner === "mysql") {
        setState(IDLE);
        setStageRun(null);
        setLog([]);
      }
    }
  }
  const stageSeq = useRef(0);
  const [focus, setFocus] = useState<(Focus & { nonce: number }) | null>(null); // mục rủi ro vừa bấm
  const [genOpen, setGenOpen] = useState(false);
  const [genLock, setGenLock] = useState(false); // khách bấm Sinh dữ liệu: hiện lời mời thay vì mở hộp thoại
  const generated = useRef(false); // đã sinh dữ liệu từ lần dựng gần nhất; dựng lại không giữ (câu sinh dữ liệu không vào history)
  const tth = useTranslations("data-lab");
  const tg = useTranslations() as unknown as (key: string, values: { index: number }) => string; // khóa guard.* của EngineError.guard.reasonKey

  // Sau mỗi lần phiên được dựng lại (tay, hoặc tự động khi lớp bảo vệ bắt đổi role): nói rõ dữ liệu sinh không được giữ, và báo nếu lớp một tắt.
  function afterRebuild(db: EngineAdapter) {
    if (generated.current) {
      generated.current = false;
      note({ kind: "note", text: tth("notKept") });
    }
    if (db.engine === "postgres" && !db.guardActive) note({ kind: "guardOff" });
  }

  async function refreshTables(db: EngineAdapter) {
    try {
      const my = db.engine === "mysql";
      const q = my ? MYSQL_SCHEMA_QUERY : db.engine === "sqlite" ? SQLITE_SCHEMA_QUERY : STAGE_SCHEMA_QUERY;
      const res = (await db.execute(q, { internal: true }))[0] ?? { columns: [], rows: [] };
      const tableInfos = parseSchema(my ? mysqlSchema(res) : db.engine === "sqlite" ? sqliteSchema(res) : res);
      const schemaDict: Record<string, string[]> = {};
      const fks: ForeignKeyRelation[] = [];
      for (const t of tableInfos) {
        schemaDict[t.name] = t.columns.map((c) => c.name);
        for (const c of t.columns) {
          if (c.references) {
            fks.push({
              fromTable: t.name,
              fromColumn: c.name,
              toTable: c.references.table,
              toColumn: c.references.column,
            });
          }
        }
      }
      setTablesSchema(schemaDict);
      setForeignKeys(fks);
      setHasTables(tableInfos.length > 0);
    } catch {
      /* giữ trạng thái cũ */
    }
  }

  // Một adapter SQLite duy nhất cho cả vùng chạy lẫn nhập/xuất file: file phải vào đúng database sẽ chạy.
  const sqliteRef = useRef<Promise<SqliteAdapter> | null>(null);
  function getSqliteAdapter(): Promise<SqliteAdapter> {
    sqliteRef.current ??= createSqliteAdapter({ onProgress: setProgress });
    return sqliteRef.current;
  }

  // Nhập xong thì database đã là của file: bỏ mọi thứ thuộc database cũ rồi đọc lại schema thật.
  async function onSqliteImported(info: { tables: string[]; bytes: number; name: string }) {
    const db = await getSqliteAdapter();
    applied.current = null; // bảng đã đổi, lần Chạy sau phải kiểm schema lại chứ không dùng kết luận cũ
    setOwner(engine);
    setLog([]);
    setStageRun(null);
    setDurationMs(null);
    setAllOpen(null);
    setState({ phase: "idle" });
    await refreshTables(db);
    setHasTables(info.tables.length > 0);
    // Bảng và dữ liệu bên dưới là **Thật**, nhưng đọc từ file chứ không phải từ câu Người dùng vừa
    // chạy: nói đúng nguồn thay vì "cập nhật từ <tab>" (Core Rule 1, review 17/11).
    const tabId = useWorkspaceStore.getState().activeTabId;
    if (tabId) notifySchemaChanged(tabId, "ddl", info.name);
  }

  // Rời trang thì dispose. Ref được xóa nên strict mode mount lại sẽ tạo instance mới.
  useEffect(
    () => () => {
      for (const p of Object.values(pool.current)) p?.then((a) => a.dispose(), () => {});
      pool.current = {};
      sqliteRef.current?.then((a) => a.dispose(), () => {});
      sqliteRef.current = null;
      disposeParser();
    },
    [],
  );
  // Rời MySQL thì hủy phiên của nó (Task075 AC4).
  useEffect(() => {
    if (engine !== "mysql") return;
    const slot = pool.current;
    return () => {
      slot.mysql?.then((a) => a.dispose(), () => {});
      slot.mysql = null;
    };
  }, [engine]);

  // Parse sau 300 ms yên lặng. Cleanup đặt cờ nên kết quả của lần gõ cũ không bao giờ đè lần mới.
  useEffect(() => {
    if (sql.trim() === "") return; // outcome tự về null vì parsed.sql không còn khớp
    let live = true;
    const h = setTimeout(() => {
      const prep = prepareDump(sql, engine);
      parseSql(prep.sql, engine).then((outcome) => live && setParsed({ sql, engine, outcome, eff: prep.sql, removed: prep.removed }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [sql, engine]);

  // Cổng của khách: mọi đường chạy (Chạy, Thử lại, xác nhận schema) đều qua đây. true là bị chặn: không chạy gì, không tính lượt.
  async function guestBlocked(target?: string): Promise<boolean> {
    if (authStatus !== "anon" || engine !== "postgres") return setGate(null), false;
    const g = await guestCheck(prepareDump(target ?? sql, engine).sql, engine);
    setGate(g);
    return g !== null;
  }

  async function run(schemaSql?: string, targetSql?: string) {
    if (busy.current) return;
    busy.current = true;
    let blocked = true; // lỗi bất ngờ ở cổng thì coi như bị chặn và vẫn thả cờ busy
    try {
      blocked = await guestBlocked(targetSql);
    } finally {
      if (blocked) busy.current = false;
    }
    if (blocked) return;
    guestRun.current = authStatus === "anon" && engine === "postgres"; // tính lượt ở cuối lần chạy này, và chỉ lần này
    setOwner(engine);
    if (!mine) setLog([]);
    setStageRun(null);
    setMobileTab("terminal");
    if (!shell.open.terminal) toggle("terminal"); // vùng terminal đang tắt thì mở lại để thấy kết quả
    const activeSql = targetSql ?? sql;
    const toRun = prepareDump(activeSql, engine).sql;
    // Rào chắn của SQLite chạy trước khi có worker: ATTACH/DETACH/VACUUM INTO/load_extension bị chặn
    // thì không câu nào trong chuỗi được chạy (Core Rule 8, AC1 và AC2 của Task133).
    if (engine === "sqlite") {
      const g = assertSqliteSafe(toRun);
      if (!g.ok) {
        busy.current = false; // chặn xong thì trả cờ, nếu không lần bấm Chạy sau bị bỏ qua
        setState({ phase: "guard_error", reasonKey: SQLITE_GUARD_MESSAGE_KEY[g.reason] });
        return;
      }
    }
    try {
      let db: EngineAdapter;
      try {
        if (!adapter.current) {
          setProgress(null);
          setState({ phase: engine === "mysql" ? "running" : "loading" }); // MySQL: phiên chỉ tạo ở câu đầu, adapter báo qua onStatus
          adapter.current =
            engine === "mysql"
              ? Promise.resolve(
                  createMysqlAdapter({
                    onStatus: (s) => {
                      setMysqlReady(s === "ready");
                      if (s !== "ended") setState({ phase: s === "starting" ? "loading" : "running" });
                    },
                    onAuthLost: markAnon,
                  }),
                )
              : engine === "sqlite"
                ? getSqliteAdapter()
                : createPostgresAdapter({ onProgress: setProgress });
          db = await adapter.current;
          if (engine === "postgres") note({ kind: "loaded" });
          if (db.engine === "postgres" && !db.guardActive) note({ kind: "guardOff" }); // parser của lớp bảo vệ một không tải được sau khi thử lại
        } else db = await adapter.current;
      } catch (e) {
        adapter.current = null; // cho phép thử lại
        note({ kind: "error" });
        setState({ phase: "load_error", message: errMsg(e) });
        return;
      }
      setState({ phase: "running" });
      const ctl = (abort.current = new AbortController());
      // Tab phát lệnh, không phải tab đang mở lúc chạy xong: người dùng có thể đã chuyển tab.
      const sourceTabId = useWorkspaceStore.getState().activeTabId;
      let step: "schema" | "query" = "query";
      try {
        if (schemaSql) {
          step = "schema";
          await db.execute(schemaSql, { signal: ctl.signal });
          note({ kind: "note", text: tin("log.applied") });
          await refreshTables(db);
          step = "query";
        }
        const t0 = performance.now();
        const results = await db.execute(toRun, { signal: ctl.signal });
        const elapsed = Math.round(performance.now() - t0);
        setDurationMs(elapsed);
        if (!targetSql) applied.current = sql; // chỉ khi query cũng chạy xong; nếu query lỗi thì lần Chạy sau kiểm lại bảng và có thể mở lại bản nháp
        const last = results[results.length - 1] ?? { columns: [], rows: [] };
        const data = { statements: results.length, rows: last.rows.length };
        note({ kind: "ran", n: results.length });
        await refreshTables(db);
        let select: StageRun["select"];
        let statements: StageRun["statements"];
        let schemaChanged = false;
        try {
          const po = await parseSql(toRun, engine);
          if (po.ok) {
            select = lastSelect(toRun, po.statements);
            statements = po.statements;
            // Chỉ báo khi parser nhận ra DDL và câu lệnh đã chạy xong thật.
            schemaChanged = changesSchema(po.statements);
          }
        } catch {
          /* không parse được thì không có câu SELECT để đo, các tab khác vẫn chạy */
        }
        if (schemaChanged && sourceTabId) notifySchemaChanged(sourceTabId, "ddl");
        // Chạy xong mới tính lượt; lỗi hoặc bị hủy thì không.
        if (guestRun.current) {
          guestRun.current = false;
          guestRunDone();
        }
        setStageRun({ id: ++stageSeq.current, db, select, sql: toRun, srcSql: activeSql, statements, explain: memoExplain(db) });

        setState({
          phase: "done",
          results,
          conclusion: {
            kind: "conclusion",
            label: "real",
            data,
            evidence: [{ kind: "execution", messageKey: engine === "mysql" ? "evidence.executedMysql" : "evidence.executed", values: data }],
          },
        });
      } catch (e) {
        // Lỗi SQL ở bước tạo bảng: quay lại màn hình xác nhận, bản nháp còn nguyên.
        if (step === "schema" && e instanceof EngineError && e.code === "sql" && !e.guard) {
          note({ kind: "error" });
          setSchemaError(e.message);
          setConfirmOpen(true);
          setState({ phase: "idle" });
          return;
        }
        if (e instanceof SandboxError) {
          setState({ phase: "sandbox_error", failure: e.failure, count: db.history().length });
          return;
        }
        const code = stopCode(e);
        const guard = e instanceof EngineError ? e.guard : undefined;
        const at = e instanceof EngineError ? e.statementIndex : undefined;
        note(
          code
            ? { kind: code }
            : guard
              ? guard.statementIndex ? { kind: "blocked", n: guard.statementIndex } : { kind: "escaped" }
              : at ? { kind: "errorAt", n: at } : { kind: "error" },
        );
        if (guard?.rebuilt) afterRebuild(db); // adapter đã tự dựng lại phiên
        setState(
          code
            ? { phase: "stopped", code, count: db.history().length }
            : guard
              ? { phase: "guard_error", reasonKey: guard.reasonKey, statementIndex: guard.statementIndex }
              : e instanceof EngineError && e.code === "load_failed"
                ? { phase: "load_error", message: e.message }
                : { phase: "sql_error", message: errMsg(e), position: e instanceof EngineError ? e.position : undefined, sql: toRun },
        );
      }
    } finally {
      busy.current = false;
    }
  }

  // Chỉ query (không có CREATE TABLE) thì cho người dùng xem bản nháp schema trước. Lỗi parse hoặc suy luận không chặn việc chạy.
  async function needsConfirm(): Promise<boolean> {
    if (engine !== "postgres" || applied.current === sql) return false;
    try {
      const outcome = await parseSql(prepareDump(sql, engine).sql, engine);
      if (!outcome.ok || classifyInput(outcome).kind !== "query") return false;
      const inf = inferSchema(outcome.statements, engine);
      if (!inf.tables.length) return false;
      if (adapter.current) {
        // Bảng đã có trong phiên (vừa tạo ở lần trước) thì không cần hỏi lại.
        const db = await adapter.current;
        const r = await db.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p')", { internal: true });
        const have = new Set(r[0]?.rows.map((x) => String(x[0])));
        if (inf.tables.every((x) => have.has(x.name))) return false;
      }
      setDraft((x) => (x && x.sql === sql && x.engine === engine ? x : { sql, engine, d: toDraft(inf.tables), warnings: inf.warnings }));
      return true;
    } catch {
      return false;
    }
  }

  async function onRun(targetSql?: string) {
    if (busy.current || (confirmOpen && dialogOn)) return;
    if (targetSql) {
      if (targetSql.trim() === "") return;
      void run(undefined, targetSql);
      return;
    }
    busy.current = true; // chặn bấm đúp trong lúc parse
    let ask = false;
    try {
      if (await guestBlocked()) return; // chặn trước khi hiện hộp xác nhận schema
      ask = await needsConfirm();
    } finally {
      busy.current = false;
    }
    if (ask) {
      setSchemaError(undefined);
      setConfirmOpen(true);
    } else void run();
  }

  function closeConfirm() {
    setConfirmOpen(false);
    note({ kind: "note", text: tin("log.cancelled") });
  }

  async function rebuild() {
    if (busy.current || !adapter.current) return;
    busy.current = true;
    setStageRun(null);
    setState({ phase: "rebuilding" });
    let count = 0;
    try {
      const db = await adapter.current;
      count = db.history().length;
      await db.rebuild();
      note({ kind: "rebuilt", n: count });
      afterRebuild(db);
      await refreshTables(db);
      setState({ phase: "idle" });
    } catch (e) {
      setState(
        e instanceof SandboxError
          ? { phase: "sandbox_error", failure: e.failure, count }
          : { phase: "stopped", code: stopCode(e) ?? "worker_crashed", count, rebuildError: errMsg(e) },
      );
    } finally {
      busy.current = false;
    }
  }

  async function resetClean() {
    if (busy.current || !adapter.current) return;
    busy.current = true;
    setStageRun(null);
    setState({ phase: "rebuilding" });
    try {
      const db = await adapter.current;
      await db.fresh();
      setHasTables(false);
      setTablesSchema({});
      setForeignKeys([]);
      applied.current = null;
      note({ kind: "rebuilt", n: 0 });
      afterRebuild(db);
      // Sandbox sạch: schema vừa đổi với mọi tab khác.
      const sourceTabId = useWorkspaceStore.getState().activeTabId;
      if (sourceTabId) notifySchemaChanged(sourceTabId, "reset");
      setState(IDLE);
    } catch (e) {
      setState(
        e instanceof SandboxError
          ? { phase: "sandbox_error", failure: e.failure, count: 0 }
          : { phase: "stopped", code: stopCode(e) ?? "worker_crashed", count: 0, rebuildError: errMsg(e) },
      );
    } finally {
      busy.current = false;
    }
  }

  const working = state.phase === "loading" || state.phase === "running" || state.phase === "rebuilding";
  const mysql = engine === "mysql";
  const outcome = parsed && parsed.sql === sql && parsed.engine === engine ? parsed.outcome : null;
  const statements = outcome?.ok ? outcome.statements : [];
  const dialogOn = Boolean(draft && draft.sql === sql && draft.engine === engine);
  const effSql = parsed && outcome ? parsed.eff : sql;
  // Dấu lỗi cú pháp khi đang soạn: gắn với đúng nội dung đã sinh ra nó, nên sửa một chữ là
  // dấu tự biến mất. Vị trí do parser trả về tính trên chuỗi ĐÃ bỏ khối `COPY ... FROM stdin`
  // và `LOCK TABLES`, nên khi prepareDump có xóa gì thì bỏ qua dấu lỗi thay vì tô sai chỗ.
  const removedAny = Boolean(parsed && outcome && (parsed.removed.copyBlocks || parsed.removed.lockStatements));
  const editorError =
    state.phase === "sql_error" && state.sql === sql && state.position !== undefined
      ? { position: engineToEditorPos(sql, state.position), message: state.message }
      : outcome && !outcome.ok && outcome.error.position !== undefined && !removedAny
        ? { position: outcome.error.position, message: outcome.error.message }
        : undefined;
  // Lỗi parse không vị trí là parser không chạy được (tải hỏng, worker chết), không phải SQL sai.
  const parserDown = Boolean(outcome && !outcome.ok && outcome.error.position === undefined);
  const frun = useMemo(
    () => stageRun && { id: stageRun.id, engine: stageRun.db.engine, sql: stageRun.sql, srcSql: stageRun.srcSql, statements: stageRun.statements, explain: stageRun.explain },
    [stageRun],
  );
  const found = useFindings(frun);
  const findingsHits = found?.kind === "ok" ? hitsOf(found.items) : undefined;
  const highlight =
    focus && stageRun && focus.runId === stageRun.id && stageRun.srcSql === sql && stageRun.sql === sql && focus.start !== undefined && focus.end !== undefined
      ? { from: focus.start, to: focus.end, nonce: focus.nonce }
      : undefined;
  const loadSample = (text: string) => {
    if (sql.trim() === "" || sql === text) setSql(text);
    else setPendingSample(text);
  };
  const canRun = sql.trim() !== "" && !working && !(confirmOpen && dialogOn) && state.phase !== "stopped" && !(mysql && authStatus !== "user");
  const hasSelectionToRun = Boolean(selection.hasSelection && selection.text.trim());
  const handlePlayClick = () => {
    if (hasSelectionToRun) {
      void onRun(selection.text);
    } else {
      void onRun();
    }
  };
  const handleEditorRun = (options?: { targetSql?: string; isSelection?: boolean }) => {
    if (canRun) void onRun(options?.targetSql);
  };

  const sqlLabel = mysql ? tm("sqlLabel") : t("sqlLabel");
  const projectName = projects.find((p) => p.id === activeProjectId)?.name ?? "SQLLens";
  const sqlHeaderRight = (
    <div className="flex items-center gap-1.5">
      <SqliteFilePanel
        engine={engine}
        projectName={projectName}
        hasContent={hasTables || sql.trim() !== ""}
        ensureAdapter={getSqliteAdapter}
        onImported={onSqliteImported}
        // Không khoá khi sandbox đang "stopped": nhập file là một cách lành lại, adapter tự dựng lại trước.
        busy={working}
      />
      <Tip label={ts("tip.generate")} side="bottom">
        <Button
          variant="outline"
          size="sm"
          onClick={() => (authStatus === "anon" ? setGenLock(true) : setGenOpen(true))}
          disabled={(!hasTables && authStatus !== "anon") || working || state.phase === "stopped" || mysql}
          aria-describedby={hasTables || authStatus === "anon" ? undefined : "gen-hint"}
        >
          {tth("open")}
          {authStatus === "anon" && <Lock className="h-3.5 w-3.5" aria-hidden />}
        </Button>
      </Tip>
      <Tip label={hasSelectionToRun ? ts("tip.runSelection") : ts("tip.run")} side="bottom">
        <Button
          ref={runBtn}
          size="sm"
          variant="default"
          onClick={handlePlayClick}
          disabled={!canRun}
          aria-label={hasSelectionToRun ? t("runSelected") : t("run")}
        >
          <Play className="h-4 w-4 fill-current" />
        </Button>
      </Tip>
    </div>
  );

  const sqlZone = (
    <Pane title={ts("tab.sql")} headerRight={sqlHeaderRight} bar={<TabBar />}>
      <ImportGuestBanner />
      <span className="text-sm font-medium">{sqlLabel}</span>
      {schemaNotice.message && (
        <div
          role="status"
          data-testid="schema-changed-notice"
          className="flex flex-wrap items-center gap-2 border border-line bg-raised px-2 py-1.5 text-xs"
        >
          {/* DDL vừa chạy xong thật trong sandbox: nhãn "Thật", không phải suy đoán. */}
          <ConclusionBadge label="real" className="h-4 px-1.5 text-[10px]" />
          <span className="min-w-0 flex-1 break-words">{schemaNotice.message}</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={schemaNotice.showSource}>
              {tw("schemaNotice.view")}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={schemaNotice.dismiss}>
              {tw("dismiss")}
            </Button>
          </div>
        </div>
      )}
      <div className="h-56 border border-line" id="sql-input">
        <SqlEditor
          value={sql}
          onChange={setSql}
          onEditorReady={tabRuntime.onEditorReady}
          engine={engine}
          error={editorError}
          highlight={highlight}
          ariaLabel={sqlLabel}
          onRun={handleEditorRun}
          onSelectionChange={(has, text) => setSelection({ hasSelection: has, text })}
          schema={tablesSchema}
          foreignKeys={foreignKeys}
          isVip={isVip}
          onRequireUpgrade={() => setIsUpgradeModalOpen(true)}
        />
      </div>
      {saveState === "error" && !warnStorageDismissed && (
        <Alert variant="destructive" className="flex items-center justify-between py-2 text-xs">
          <AlertDescription>{tw("storageUnavailable")}</AlertDescription>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setWarnStorageDismissed(true)}
          >
            {tw("dismiss")}
          </Button>
        </Alert>
      )}
      {sql.trim() === "" && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">{t("editorEmpty")}</p>
          <SampleButton engine={engine} onLoad={loadSample} />
        </div>
      )}
      {pendingSample !== null && (
        <div role="alertdialog" aria-label={t("sampleAsk")} className="flex flex-col items-start gap-2 border border-line p-2 text-sm">
          <p>{t("sampleAsk")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => (setSql(pendingSample), setPendingSample(null))}>
              {t("sampleReplace")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPendingSample(null)}>
              {t("sampleKeep")}
            </Button>
          </div>
        </div>
      )}
      {parsed && outcome && <DumpNotice removed={parsed.removed} />}
      {parserDown && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("parserDown")}
        </p>
      )}
      {statements.length > 0 && (
        <StatementList sql={effSql} statements={statements} selected={Math.min(selected, statements.length - 1)} onSelect={setSelected} />
      )}
      <GuestNote gate={gate} />
      {genLock && authStatus === "anon" && <LockedTab name={tth("open")} feature />}
      {!hasTables && !mysql && authStatus !== "anon" && (
        <p id="gen-hint" className="text-xs text-muted-foreground">
          {tth("openDisabled")}
        </p>
      )}
    </Pane>
  );

  const terminalDots = (
    <div className="flex items-center gap-1 mr-1">
      <span className="h-2 w-2 rounded-full bg-rose-500/80 inline-block" />
      <span className="h-2 w-2 rounded-full bg-amber-500/80 inline-block" />
      <span className="h-2 w-2 rounded-full bg-emerald-500/80 inline-block" />
    </div>
  );

  const engineName =
    engine === "postgres" ? "PostgreSQL (PGlite)" : engine === "sqlite" ? "SQLite (WASM)" : "MySQL (Sandbox)";
  const engineDotColor =
    state.phase === "running" || state.phase === "loading" || state.phase === "rebuilding"
      ? "bg-amber-500 animate-pulse"
      : state.phase === "sql_error" ||
          state.phase === "guard_error" ||
          state.phase === "load_error" ||
          state.phase === "sandbox_error" ||
          state.phase === "stopped"
        ? "bg-rose-500"
        : "bg-emerald-500";

  const clearTerminal = () => {
    setState(IDLE);
    setLog([]);
    setStageRun(null);
    setDurationMs(null);
    setAllOpen(null);
  };

  const terminalHeaderRight = (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span className={cn("h-1.5 w-1.5 rounded-full", engineDotColor)} />
        <span>{engineName}</span>
      </div>
      {state.phase === "done" && state.results.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAllOpen((cur) => (cur ? false : true))}
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {allOpen ? t("collapseAll") : t("expandAll")}
        </Button>
      )}
      {(state.phase !== "idle" || log.length > 0) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearTerminal}
          className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
          title={t("clear")}
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="sr-only sm:not-sr-only sm:text-xs">{t("clear")}</span>
        </Button>
      )}
    </div>
  );

  const successSummary = state.phase === "done" ? `✓ ${t("statementsSuccess", { count: state.results.length })}` : null;
  const durationSummary =
    durationMs !== null
      ? `• ${durationMs < 1000 ? t("durationMs", { ms: durationMs }) : t("durationSec", { s: (durationMs / 1000).toFixed(2) })}`
      : null;
  const logButtonLabel = `${t("log.systemTitle")} (${log.length})`;
  const logBullet = "›";

  const terminalZone = (
    <Pane
      title={
        <div className="flex items-center gap-1.5">
          {terminalDots}
          <span>{ts("tab.terminal")}</span>
        </div>
      }
      headerRight={terminalHeaderRight}
    >
      <MysqlGate on={mysql}>
        <>
          <div role="status" className="flex min-w-0 flex-col items-start gap-2 text-sm text-muted-foreground">
            {state.phase === "loading" && mysql && (
              <>
                <span>{tm("starting")}</span>
                <progress aria-label={tm("starting")} className="w-full max-w-xs" />
              </>
            )}
            {state.phase === "loading" && !mysql && (
              <>
                <span>{progress?.phase === "init" ? t("initializing") : t("loading")}</span>
                <progress
                  aria-label={t("loading")}
                  className="w-full max-w-xs"
                  max={progress?.totalBytes}
                  value={progress?.totalBytes ? progress.loadedBytes : undefined}
                />
                {progress?.loadedBytes !== undefined && (
                  <span>
                    {progress.totalBytes
                      ? t("downloadedOf", { loaded: mb(progress.loadedBytes)!, total: mb(progress.totalBytes)! })
                      : t("downloaded", { loaded: mb(progress.loadedBytes)! })}
                  </span>
                )}
              </>
            )}
            {state.phase === "running" && (
              <>
                <span>{t("running")}</span>
                <Button variant="outline" onClick={() => abort.current?.abort()}>
                  {t("cancel")}
                </Button>
              </>
            )}
            {state.phase === "rebuilding" && <span>{t("rebuilding")}</span>}
          </div>
          {mysql && mysqlReady && state.phase !== "loading" && (
            <p className="m-0 text-xs text-dim" data-testid="mysql-ready">{tm("ready")}</p>
          )}
          {state.phase === "sandbox_error" && (
            <SandboxFailureView
              failure={state.failure}
              historyCount={state.count}
              onRetry={() => run()}
              onFresh={async () =>
                ((await adapter.current) as MysqlAdapter | null)?.fresh().then(() => {
                  setHasTables(false);
                  setTablesSchema({});
                  setForeignKeys([]);
                  setState(IDLE);
                })
              }
              onReplay={rebuild}
              onUsePostgres={() => router.replace(`${pathname}?engine=postgres`)}
            />
          )}
          {state.phase === "load_error" && (
            <Alert variant="destructive" data-testid="error">
              <AlertDescription className="flex flex-col items-start gap-2">
                {t("loadError", { message: state.message })}
                <Button variant="outline" onClick={() => run()} disabled={sql.trim() === ""}>
                  {t("retry")}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {state.phase === "sql_error" && (
            <div data-testid="error">
              <SqlErrorView
                message={state.message}
                position={state.position}
                sql={state.sql}
                title={mysql ? tm("sqlErrorTitle") : undefined}
                // SQLite chưa có bộ gợi ý sửa lỗi riêng: không gán nhãn lỗi của PostgreSQL cho nó.
                engine={engine === "sqlite" ? undefined : engine}
                onApplyFix={(newSql) => {
                  const updated = applyStatementFix(sql, state.sql, newSql, state.position);
                  setSql(updated);
                }}
                onRebuild={resetClean}
                onAskAi={() => {}}
              />
            </div>
          )}
          {state.phase === "guard_error" && (
            <Alert variant="destructive" data-testid="error" role="alert">
              <AlertDescription>{tg(state.reasonKey, { index: state.statementIndex ?? 0 })}</AlertDescription>
            </Alert>
          )}
          {state.phase === "stopped" && (
            <Alert variant="destructive" data-testid="stopped">
              <AlertDescription className="flex flex-col items-start gap-2">
                <p>{t(mysql ? `stoppedMysql.${state.code}` : `stopped.${state.code}`)}</p>
                {state.count > 0 && <p>{t("rebuildHint", { count: state.count })}</p>}
                {state.rebuildError && <p>{t("rebuildError", { message: state.rebuildError })}</p>}
                <Button variant="outline" onClick={rebuild}>
                  {t("rebuild")}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {state.phase === "done" && (
            <div className="min-w-0">
              <ResultGrid results={state.results} rawSql={stageRun?.sql ?? sql} allOpen={allOpen} />
            </div>
          )}
          {state.phase === "idle" && log.length === 0 && <p className="text-dim">{mysql ? tm("idle") : ts("placeholder.terminal")}</p>}

          {(state.phase === "done" || log.length > 0) && (
            <div className="mt-auto flex flex-col gap-2 pt-2 border-t border-border/60">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  {successSummary && (
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      {successSummary}
                    </span>
                  )}
                  {durationSummary && <span>{durationSummary}</span>}
                </div>
                {log.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLogOpen((v) => !v)}
                    className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <TerminalIcon className="h-3 w-3 mr-1" />
                    <span>{logButtonLabel}</span>
                    {logOpen ? <ChevronDown className="h-3 w-3 ml-1" /> : <ChevronUp className="h-3 w-3 ml-1" />}
                  </Button>
                )}
              </div>

              {log.length > 0 && logOpen && (
                <div className="rounded-md border border-border/60 bg-muted/20 p-2 font-mono text-xs">
                  <ol aria-label={t("log.title")} className="m-0 list-none p-0 flex flex-col gap-1 max-h-36 overflow-y-auto text-muted-foreground">
                    {log.map((l, i) => (
                      <li key={i} className="flex items-start gap-1.5 leading-relaxed">
                        <span className="text-dim select-none">{logBullet}</span>
                        <span>{l.kind === "note" ? l.text : t(`log.${l.kind}`, { n: l.n ?? 0 })}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </>
      </MysqlGate>
    </Pane>
  );

  const findingsZone =
    state.phase === "done" ? (
      <Pane title={ts("tab.findings")}>
        <div className="flex flex-col gap-2" data-testid="conclusion">
          <Badge className="self-start">{t(`label.${state.conclusion.label}`)}</Badge>
          {state.conclusion.evidence.map((ev) => (
            <p key={ev.kind} className="text-sm">
              {t(ev.messageKey, ev.values)}
            </p>
          ))}
        </div>
        {stageRun && (
          <FindingsPanel
            key={stageRun.id}
            run={frun!}
            result={found}
            stale={stageRun.srcSql !== sql}
            planStatement={stageRun.select ? stageRun.select.n - 1 : undefined}
            onFocus={(f) => (setFocus({ ...f, nonce: Date.now() + Math.random() }), setMobileTab(f.where))}
          />
        )}
      </Pane>
    ) : (
      <ZonePlaceholder title={ts("tab.findings")} hint={ts("placeholder.findings")} />
    );

  const stageZone = (
    <Stage
      run={stageRun}
      working={working}
      askRef={askRef}
      focus={focus as StageFocus | null}
      findings={{ hits: findingsHits ?? [], pending: !!stageRun && found === null }}
      onLoadSample={() => loadSample(SAMPLE_SQL[engine])}
    />
  );
  const onStopped = async (code: StopCode) => {
    const db = await adapter.current;
    note({ kind: code });
    setStageRun(null);
    setState({ phase: "stopped", code, count: db?.history().length ?? 0 });
  };
  return (
    <>
      <WorkspaceLayout sql={sqlZone} terminal={terminalZone} findings={findingsZone} stage={stageZone} />
      {draft && dialogOn && (
        <ConfirmSchemaDialog
          open={confirmOpen}
          onOpenChange={(o) => (o ? setConfirmOpen(true) : closeConfirm())}
          engine={engine}
          draft={draft.d}
          onDraft={(d) => setDraft((x) => x && { ...x, d })}
          warnings={draft.warnings}
          error={schemaError}
          returnFocus={runBtn}
          onConfirm={(createSql) => (setConfirmOpen(false), void run(createSql))}
          onSkip={() => (setConfirmOpen(false), (applied.current = sql), void run())}
        />
      )}
      <GenerateDialog
        open={genOpen}
        onOpenChange={setGenOpen}
        getAdapter={() => adapter.current}
        onSummary={(text, wrote) => {
          if (wrote) {
            generated.current = true;
            setStageRun((r) => r && { ...r, id: ++stageSeq.current, explain: memoExplain(r.db) }); // dữ liệu đổi: plan, cây và rủi ro đọc lại
          }
          note({ kind: "note", text });
          setMobileTab("terminal");
          if (!shell.open.terminal) toggle("terminal");
        }}
        onStopped={onStopped}
      />
      <UpgradeModal open={isUpgradeModalOpen} onOpenChange={setIsUpgradeModalOpen} />
      <EngineReleaseToast />
    </>
  );
}
