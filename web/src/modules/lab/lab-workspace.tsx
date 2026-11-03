"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { SampleButton } from "@/components/sql-editor/sample-button";
import { SqlEditor } from "@/components/sql-editor/sql-editor";
import type { Conclusion } from "@/contracts/conclusion";
import { EngineError, type EngineAdapter, type LoadProgress, type QueryResult } from "@/contracts/engine";
import { createPostgresAdapter } from "@/engines/postgres/adapter";
import { GenerateDialog, type StopCode } from "@/modules/data-lab/ui/generate-dialog";
import { disposeParser, parseSql, type ParseOutcome } from "@/modules/sql-intake/parser";
import { StatementList } from "./statement-list";

type RunData = { statements: number; rows: number };
type Stop = "cancelled" | "timeout" | "worker_crashed";
type State =
  | { phase: "idle" | "loading" | "running" | "rebuilding" }
  | { phase: "load_error"; message: string }
  | { phase: "sql_error"; message: string; position?: number; sql: string }
  | { phase: "guard_error"; reasonKey: string; statementIndex?: number }
  | { phase: "stopped"; code: Stop; count: number; rebuildError?: string }
  | { phase: "done"; results: QueryResult[]; conclusion: Conclusion<RunData> };
// Nhật ký chỉ có loại sự kiện và số liệu, không bao giờ có nội dung SQL.
type Log = { kind: "loaded" | "ran" | "error" | "cancelled" | "timeout" | "worker_crashed" | "rebuilt" | "note" | "errorAt" | "blocked" | "escaped" | "guardOff"; n?: number; text?: string };

// Engine báo position 1-based theo code point; ô soạn cần chỉ số 0-based theo UTF-16.
const engineToEditorPos = (sql: string, p: number) => Array.from(sql).slice(0, p - 1).join("").length;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const mb = (b?: number) => (b === undefined ? undefined : (b / 1048576).toFixed(1));
const stopCode = (e: unknown): Stop | null =>
  e instanceof EngineError && (e.code === "cancelled" || e.code === "timeout" || e.code === "worker_crashed") ? e.code : null;

function Pane({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full min-w-0 flex-col">
      <div className="flex h-[var(--h-bar)] flex-none items-center border-b border-line px-[var(--edge)] font-semibold">{title}</div>
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
  const [parsed, setParsed] = useState<{ sql: string; engine: typeof engine; outcome: ParseOutcome } | null>(null);
  const [selected, setSelected] = useState(0);
  const [pendingSample, setPendingSample] = useState<string | null>(null);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [log, setLog] = useState<Log[]>([]);
  const adapter = useRef<Promise<EngineAdapter> | null>(null);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const note = (l: Log) => setLog((x) => [...x.slice(-49), l]);
  const [hasTables, setHasTables] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const generated = useRef(false); // đã sinh dữ liệu từ lần dựng gần nhất; dựng lại không giữ (câu sinh dữ liệu không vào history)
  const tth = useTranslations("data-lab");
  const tg = useTranslations() as unknown as (key: string, values: { index: number }) => string; // khóa guard.* của EngineError.guard.reasonKey

  // Sau mỗi lần phiên được dựng lại (tay, hoặc tự động khi lớp bảo vệ bắt đổi role): nói rõ dữ liệu sinh không được giữ, và báo nếu lớp một tắt.
  function afterRebuild(db: EngineAdapter) {
    if (generated.current) {
      generated.current = false;
      note({ kind: "note", text: tth("notKept") });
    }
    if (!db.guardActive) note({ kind: "guardOff" });
  }

  async function refreshTables(db: EngineAdapter) {
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
      adapter.current?.then((a) => a.dispose(), () => {});
      adapter.current = null;
      disposeParser();
    },
    [],
  );

  // Parse sau 300 ms yên lặng. Cleanup đặt cờ nên kết quả của lần gõ cũ không bao giờ đè lần mới.
  useEffect(() => {
    if (sql.trim() === "") return; // outcome tự về null vì parsed.sql không còn khớp
    let live = true;
    const h = setTimeout(() => {
      parseSql(sql, engine).then((outcome) => live && setParsed({ sql, engine, outcome }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [sql, engine]);

  async function run() {
    if (busy.current) return;
    busy.current = true;
    setMobileTab("terminal");
    if (!shell.open.terminal) toggle("terminal"); // vùng terminal đang tắt thì mở lại để thấy kết quả
    try {
      let db: EngineAdapter;
      try {
        if (!adapter.current) {
          setProgress(null);
          setState({ phase: "loading" });
          adapter.current = createPostgresAdapter({ onProgress: setProgress });
          db = await adapter.current;
          note({ kind: "loaded" });
          if (!db.guardActive) note({ kind: "guardOff" }); // parser của lớp bảo vệ một không tải được sau khi thử lại
        } else db = await adapter.current;
      } catch (e) {
        adapter.current = null; // cho phép thử lại
        note({ kind: "error" });
        setState({ phase: "load_error", message: errMsg(e) });
        return;
      }
      setState({ phase: "running" });
      const ctl = (abort.current = new AbortController());
      try {
        const results = await db.execute(sql, { signal: ctl.signal });
        const last = results[results.length - 1] ?? { columns: [], rows: [] };
        const data = { statements: results.length, rows: last.rows.length };
        note({ kind: "ran", n: results.length });
        await refreshTables(db);
        setState({
          phase: "done",
          results,
          conclusion: {
            kind: "conclusion",
            label: "real",
            data,
            evidence: [{ kind: "execution", messageKey: "evidence.executed", values: data }],
          },
        });
      } catch (e) {
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
                : { phase: "sql_error", message: errMsg(e), position: e instanceof EngineError ? e.position : undefined, sql },
        );
      }
    } finally {
      busy.current = false;
    }
  }

  async function rebuild() {
    if (busy.current || !adapter.current) return;
    busy.current = true;
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
      setState({ phase: "stopped", code: stopCode(e) ?? "worker_crashed", count, rebuildError: errMsg(e) });
    } finally {
      busy.current = false;
    }
  }

  const working = state.phase === "loading" || state.phase === "running" || state.phase === "rebuilding";
  const mysql = engine === "mysql";
  const outcome = parsed && parsed.sql === sql && parsed.engine === engine ? parsed.outcome : null;
  const statements = outcome?.ok ? outcome.statements : [];
  // Dấu lỗi gắn với đúng nội dung đã sinh ra nó: sửa chữ là dấu tự biến mất.
  const editorError =
    state.phase === "sql_error" && state.sql === sql && state.position !== undefined
      ? { position: engineToEditorPos(sql, state.position), message: state.message }
      : outcome && !outcome.ok && outcome.error.position !== undefined
        ? { position: outcome.error.position, message: outcome.error.message }
        : undefined;
  // Lỗi parse không vị trí là parser không chạy được (tải hỏng, worker chết), không phải SQL sai.
  const parserDown = Boolean(outcome && !outcome.ok && outcome.error.position === undefined);
  const loadSample = (text: string) => (sql.trim() === "" || sql === text ? setSql(text) : setPendingSample(text));

  const sqlZone = (
    <Pane title={ts("tab.sql")}>
      <span className="text-sm font-medium">{t("sqlLabel")}</span>
      <div className="h-56 border border-line" id="sql-input">
        <SqlEditor value={sql} onChange={setSql} engine={engine} error={editorError} ariaLabel={t("sqlLabel")} />
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
            <Button size="sm" onClick={() => (setSql(pendingSample), setPendingSample(null))}>
              {t("sampleReplace")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPendingSample(null)}>
              {t("sampleKeep")}
            </Button>
          </div>
        </div>
      )}
      {parserDown && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("parserDown")}
        </p>
      )}
      {statements.length > 0 && (
        <StatementList sql={sql} statements={statements} selected={Math.min(selected, statements.length - 1)} onSelect={setSelected} />
      )}
      <div>
        <Button onClick={run} disabled={sql.trim() === "" || working || state.phase === "stopped" || mysql}>
          {t("run")}
        </Button>
      </div>
      <div className="flex flex-col items-start gap-1">
        <Button
          variant="outline"
          onClick={() => setGenOpen(true)}
          disabled={!hasTables || working || state.phase === "stopped" || mysql}
          aria-describedby={hasTables ? undefined : "gen-hint"}
        >
          {tth("open")}
        </Button>
        {!hasTables && !mysql && (
          <p id="gen-hint" className="text-xs text-muted-foreground">
            {tth("openDisabled")}
          </p>
        )}
      </div>
    </Pane>
  );

  const terminalZone = (
    <Pane title={ts("tab.terminal")}>
      {mysql ? (
        <p role="status">{t("mysqlNeedsLogin")}</p>
      ) : (
        <>
          <div role="status" className="flex min-w-0 flex-col items-start gap-2 text-sm text-muted-foreground">
            {state.phase === "loading" && (
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
          {state.phase === "load_error" && (
            <Alert variant="destructive" data-testid="error">
              <AlertDescription className="flex flex-col items-start gap-2">
                {t("loadError", { message: state.message })}
                <Button variant="outline" onClick={run} disabled={sql.trim() === ""}>
                  {t("retry")}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {state.phase === "sql_error" && (
            <div data-testid="error">
              <SqlErrorView message={state.message} position={state.position} sql={state.sql} />
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
                <p>{t(`stopped.${state.code}`)}</p>
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
          {state.phase === "idle" && log.length === 0 && <p className="text-dim">{ts("placeholder.terminal")}</p>}
        </>
      )}
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
      </Pane>
    ) : (
      <ZonePlaceholder title={ts("tab.findings")} hint={ts("placeholder.findings")} />
    );

  const stageZone = <ZonePlaceholder title={ts("tab.stage")} hint={ts("placeholder.stage")} />;
  const onStopped = async (code: StopCode) => {
    const db = await adapter.current;
    note({ kind: code });
    setState({ phase: "stopped", code, count: db?.history().length ?? 0 });
  };
  return (
    <>
      <WorkspaceLayout sql={sqlZone} terminal={terminalZone} findings={findingsZone} stage={stageZone} />
      <GenerateDialog
        open={genOpen}
        onOpenChange={setGenOpen}
        getAdapter={() => adapter.current}
        onSummary={(text, wrote) => {
          if (wrote) generated.current = true;
          note({ kind: "note", text });
          setMobileTab("terminal");
          if (!shell.open.terminal) toggle("terminal");
        }}
        onStopped={onStopped}
      />
    </>
  );
}
