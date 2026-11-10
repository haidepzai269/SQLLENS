"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Lock, Play } from "lucide-react";
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
import { SAMPLE_SQL } from "@/components/sql-editor/samples";
import { SampleButton } from "@/components/sql-editor/sample-button";
import { SqlEditor } from "@/components/sql-editor/sql-editor";
import type { Conclusion } from "@/contracts/conclusion";
import { FindingsPanel, type Focus } from "@/modules/findings/ui/findings-panel";
import { hitsOf, useFindings } from "@/modules/findings/ui/use-findings";
import { EngineError, type EngineAdapter, type LoadProgress, type QueryResult } from "@/contracts/engine";
import { createPostgresAdapter } from "@/engines/postgres/adapter";
import { GenerateDialog, type StopCode } from "@/modules/data-lab/ui/generate-dialog";
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
import { Stage, type StageFocus, type StageRun } from "./stage/stage";
import { packStash, unpackStash } from "./stage/stash";
import { lastSelect, memoExplain } from "./stage/stage-data";
import { StatementList } from "./statement-list";

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

function Pane({ title, children, headerRight }: { title: string; children: ReactNode; headerRight?: ReactNode }) {
  return (
    <div className="flex min-h-full min-w-0 flex-col">
      <div className="sticky top-0 z-10 flex h-[var(--h-bar)] flex-none items-center justify-between border-b border-line bg-surface px-[var(--edge)] font-semibold">
        <span>{title}</span>
        {headerRight && <div className="flex items-center gap-1.5">{headerRight}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-3 p-[var(--edge)]">{children}</div>
    </div>
  );
}

export function LabWorkspace() {
  const t = useTranslations("lab");
  const ts = useTranslations("shell");
  const { setMobileTab, state: shell, toggle } = useShell();
  const engine = parseEngine(useSearchParams().get("engine"));
  // Toàn bộ trạng thái phiên nằm ở đây, trên WorkspaceLayout, nên đổi qua mốc 900 px không mất gì.
  const [sql, setSql] = useState("");
  const { sqlRef, markAnon, status: authStatus } = useAuth();
  const tm = useTranslations("mysql");
  const router = useRouter();
  const pathname = usePathname();
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
    if (back) setSql((cur) => (cur === "" ? back : cur)); // eslint-disable-line react-hooks/set-state-in-effect -- đọc sessionStorage một lần sau mount
    if (ask) stashSql(ask); // trả lại cho ô hỏi của Mentor, nó tự đọc khi tab được mở
  }, []);
  // eff: SQL đã bỏ khối COPY và LOCK (prepareDump), là chuỗi thật sự được parse và chạy; vị trí trong outcome tính trên eff.
  const [parsed, setParsed] = useState<{ sql: string; engine: typeof engine; outcome: ParseOutcome; eff: string; removed: { copyBlocks: number; lockStatements: number } } | null>(null);
  // Bản nháp schema suy từ query, gắn với đúng sql và engine đã sinh ra nó: query đổi thì bỏ.
  const [draft, setDraft] = useState<{ sql: string; engine: typeof engine; d: Draft; warnings: InferWarning[] } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [schemaError, setSchemaError] = useState<string | undefined>();
  const applied = useRef<string | null>(null); // sql đã được tạo schema xong, chạy lại không hỏi nữa
  const runBtn = useRef<HTMLButtonElement | null>(null);
  const [showRunTip, setShowRunTip] = useState(false);
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
  // Dữ liệu cho vùng stage của lần chạy gần nhất đã xong; null khi đang chạy, lỗi, bị hủy hay engine dựng lại, để tab không hiện số cũ.
  const [rawStageRun, setStageRun] = useState<StageRun | null>(null);
  const mine = owner === engine;
  const state = mine ? rawState : IDLE;
  const log = mine ? rawLog : [];
  const stageRun = mine ? rawStageRun : null;
  // Rời MySQL: phiên bị hủy (effect bên dưới), nên bỏ luôn màn hình của nó.
  const [lastEngine, setLastEngine] = useState(engine);
  if (lastEngine !== engine) {
    setLastEngine(engine);
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
    if (db.engine !== "postgres") return; // câu kiểm bảng là catalog PostgreSQL
    try {
      const r = await db.execute(
        "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') LIMIT 1",
        { internal: true },
      );
      setHasTables((r[0]?.rows.length ?? 0) > 0);
    } catch {
      /* giữ trạng thái cũ */
    }
  }

  // Rời trang thì dispose. Ref được xóa nên strict mode mount lại sẽ tạo instance mới.
  useEffect(
    () => () => {
      for (const p of Object.values(pool.current)) p?.then((a) => a.dispose(), () => {});
      pool.current = {};
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
  async function guestBlocked(): Promise<boolean> {
    if (authStatus !== "anon" || engine !== "postgres") return setGate(null), false;
    const g = await guestCheck(prepareDump(sql, engine).sql, engine);
    setGate(g);
    return g !== null;
  }

  async function run(schemaSql?: string) {
    if (busy.current) return;
    busy.current = true;
    let blocked = true; // lỗi bất ngờ ở cổng thì coi như bị chặn và vẫn thả cờ busy
    try {
      blocked = await guestBlocked();
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
      const toRun = prepareDump(sql, engine).sql;
      let step: "schema" | "query" = "query";
      try {
        if (schemaSql) {
          step = "schema";
          await db.execute(schemaSql, { signal: ctl.signal });
          note({ kind: "note", text: tin("log.applied") });
          await refreshTables(db);
          step = "query";
        }
        const results = await db.execute(toRun, { signal: ctl.signal });
        applied.current = sql; // chỉ khi query cũng chạy xong; nếu query lỗi thì lần Chạy sau kiểm lại bảng và có thể mở lại bản nháp
        const last = results[results.length - 1] ?? { columns: [], rows: [] };
        const data = { statements: results.length, rows: last.rows.length };
        note({ kind: "ran", n: results.length });
        await refreshTables(db);
        let select: StageRun["select"];
        let statements: StageRun["statements"];
        try {
          const po = await parseSql(toRun, engine);
          if (po.ok) {
            select = lastSelect(toRun, po.statements);
            statements = po.statements;
          }
        } catch {
          /* không parse được thì không có câu SELECT để đo, các tab khác vẫn chạy */
        }
        // Chạy xong mới tính lượt; lỗi hoặc bị hủy thì không.
        if (guestRun.current) {
          guestRun.current = false;
          guestRunDone();
        }
        setStageRun({ id: ++stageSeq.current, db, select, sql: toRun, srcSql: sql, statements, explain: memoExplain(db) });

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

  async function onRun() {
    setShowRunTip(false);
    if (busy.current || (confirmOpen && dialogOn)) return;
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

  const working = state.phase === "loading" || state.phase === "running" || state.phase === "rebuilding";
  const mysql = engine === "mysql";
  const outcome = parsed && parsed.sql === sql && parsed.engine === engine ? parsed.outcome : null;
  const statements = outcome?.ok ? outcome.statements : [];
  const dialogOn = Boolean(draft && draft.sql === sql && draft.engine === engine);
  const effSql = parsed && outcome ? parsed.eff : sql;
  const removedAny = Boolean(parsed && outcome && (parsed.removed.copyBlocks || parsed.removed.lockStatements));
  // Dấu lỗi gắn với đúng nội dung đã sinh ra nó: sửa chữ là dấu tự biến mất.
  const editorError =
    state.phase === "sql_error" && state.sql === sql && state.position !== undefined
      ? { position: engineToEditorPos(sql, state.position), message: state.message }
      : outcome && !outcome.ok && outcome.error.position !== undefined && !removedAny // vị trí tính trên SQL đã bỏ khối COPY, không khớp ô soạn
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
    setShowRunTip(false);
    if (sql.trim() === "" || sql === text) setSql(text);
    else setPendingSample(text);
  };
  const canRun = sql.trim() !== "" && !working && !(confirmOpen && dialogOn) && state.phase !== "stopped" && !(mysql && authStatus !== "user");
  const handleEditorRun = () => {
    setShowRunTip(false);
    if (canRun) void onRun();
  };
  const handleSqlChange = (val: string) => {
    setShowRunTip(false);
    setSql(val);
  };

  // Debounce tooltip "Ấn để chạy" khi người dùng dừng gõ SQL (Task090 AC4)
  useEffect(() => {
    if (sql.trim() === "" || !canRun) return;
    const timer = setTimeout(() => {
      setShowRunTip(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [sql, canRun]);

  // Tự động tắt sau 3500ms nếu người dùng không thao tác
  useEffect(() => {
    if (!showRunTip) return;
    const timer = setTimeout(() => {
      setShowRunTip(false);
    }, 3500);
    return () => clearTimeout(timer);
  }, [showRunTip]);

  const activeRunTip = showRunTip && canRun;
  const sqlLabel = mysql ? tm("sqlLabel") : t("sqlLabel");
  const sqlHeaderRight = (
    <div className="flex items-center gap-1.5">
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
      <Tip
        label={activeRunTip ? ts("tip.clickToRun") : ts("tip.run")}
        side="bottom"
        open={activeRunTip ? true : undefined}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && showRunTip) setShowRunTip(false);
        }}
      >
        <Button
          ref={runBtn}
          size="sm"
          variant="default"
          onClick={onRun}
          disabled={!canRun}
          aria-label={t("run")}
        >
          <Play className="h-4 w-4 fill-current" />
        </Button>
      </Tip>
    </div>
  );

  const sqlZone = (
    <Pane title={ts("tab.sql")} headerRight={sqlHeaderRight}>
      <span className="text-sm font-medium">{sqlLabel}</span>
      <div className="h-56 border border-line" id="sql-input">
        <SqlEditor value={sql} onChange={handleSqlChange} engine={engine} error={editorError} highlight={highlight} ariaLabel={sqlLabel} onRun={handleEditorRun} />
      </div>
      {sql.trim() === "" && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">{t("editorEmpty")}</p>
          <SampleButton engine={engine} onLoad={loadSample} />
        </div>
      )}
      {sql.trim() !== "" && <SampleButton engine={engine} onLoad={loadSample} />}
      {pendingSample !== null && (
        <div role="alertdialog" aria-label={t("sampleAsk")} className="flex flex-col items-start gap-2 border border-line p-2 text-sm">
          <p>{t("sampleAsk")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => (setShowRunTip(false), setSql(pendingSample), setPendingSample(null))}>
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

  const terminalZone = (
    <Pane title={ts("tab.terminal")}>
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
              onFresh={async () => ((await adapter.current) as MysqlAdapter | null)?.fresh().then(() => setState(IDLE))}
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
                engine={engine}
                onApplyFix={(newSql) => setSql(newSql)}
                onRebuild={rebuild}
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
              <ResultGrid results={state.results} />
            </div>
          )}
          {log.length > 0 && (
            <ol aria-label={t("log.title")} className="m-0 list-none p-0 font-mono text-xs text-muted-foreground">
              {log.map((l, i) => (
                <li key={i}>{l.kind === "note" ? l.text : t(`log.${l.kind}`, { n: l.n ?? 0 })}</li>
              ))}
            </ol>
          )}
          {state.phase === "idle" && log.length === 0 && <p className="text-dim">{mysql ? tm("idle") : ts("placeholder.terminal")}</p>}
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
    </>
  );
}
