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
import { Textarea } from "@/components/ui/textarea";
import type { Conclusion } from "@/contracts/conclusion";
import { EngineError, type EngineAdapter, type LoadProgress, type QueryResult } from "@/contracts/engine";
import { createPostgresAdapter } from "@/engines/postgres/adapter";

type RunData = { statements: number; rows: number };
type Stop = "cancelled" | "timeout" | "worker_crashed";
type State =
  | { phase: "idle" | "loading" | "running" | "rebuilding" }
  | { phase: "load_error"; message: string }
  | { phase: "sql_error"; message: string; position?: number; sql: string }
  | { phase: "stopped"; code: Stop; count: number; rebuildError?: string }
  | { phase: "done"; results: QueryResult[]; conclusion: Conclusion<RunData> };
// Nhật ký chỉ có loại sự kiện và số liệu, không bao giờ có nội dung SQL.
type Log = { kind: "loaded" | "ran" | "error" | "cancelled" | "timeout" | "worker_crashed" | "rebuilt"; n?: number };

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
  const [state, setState] = useState<State>({ phase: "idle" });
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [log, setLog] = useState<Log[]>([]);
  const adapter = useRef<Promise<EngineAdapter> | null>(null);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const note = (l: Log) => setLog((x) => [...x.slice(-49), l]);

  // Rời trang thì dispose. Ref được xóa nên strict mode mount lại sẽ tạo instance mới.
  useEffect(
    () => () => {
      adapter.current?.then((a) => a.dispose(), () => {});
      adapter.current = null;
    },
    [],
  );

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
        note({ kind: code ?? "error" });
        setState(
          code
            ? { phase: "stopped", code, count: db.history().length }
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
      setState({ phase: "idle" });
    } catch (e) {
      setState({ phase: "stopped", code: stopCode(e) ?? "worker_crashed", count, rebuildError: errMsg(e) });
    } finally {
      busy.current = false;
    }
  }

  const working = state.phase === "loading" || state.phase === "running" || state.phase === "rebuilding";
  const mysql = engine === "mysql";

  const sqlZone = (
    <Pane title={ts("tab.sql")}>
      <label htmlFor="sql-input" className="text-sm font-medium">
        {t("sqlLabel")}
      </label>
      <Textarea
        id="sql-input"
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        placeholder={t("sqlPlaceholder")}
        className="max-h-72 min-h-40 font-mono"
        spellCheck={false}
      />
      <div>
        <Button onClick={run} disabled={sql.trim() === "" || working || state.phase === "stopped" || mysql}>
          {t("run")}
        </Button>
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
                <li key={i}>{t(`log.${l.kind}`, { n: l.n ?? 0 })}</li>
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
  return <WorkspaceLayout sql={sqlZone} terminal={terminalZone} findings={findingsZone} stage={stageZone} />;
}
