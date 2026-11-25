"use client";

/**
 * Khung xem snapshot ở chế độ chỉ đọc.
 *
 * Bám prototype `_bmad-output/share_preview_prototype.html` (màn hình 2): header 44px,
 * badge "Snapshot chỉ đọc", tab bar không có nút thêm/đóng, editor có số dòng và highlight.
 * Không có nút Fork/Chạy — hai việc đó thuộc Task147 và Task148.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Copy, GitFork, Loader2, Lock, Play, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { formatCell } from "@/components/result-grid/format-cell";
import { SqlEditor } from "@/components/sql-editor/sql-editor";
import { ConclusionBadge } from "@/components/ui/conclusion-badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EngineId, LoadProgress } from "@/contracts/engine";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  ForkError,
  forkSnapshot,
  hasForkedSnapshot,
  resolveWorkspaceScope,
  snapshotFingerprint,
  type ForkErrorCode,
} from "../fork";
import type { SnapshotV1 } from "../snapshot";
import {
  runSnapshotTab,
  SnapshotRunError,
  type SnapshotRunOutcome,
} from "../try-run";

const ENGINE_LABEL: Record<SnapshotV1["project"]["engine"], string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
};

/** Số dòng mỗi trang của bảng kết quả. Kết quả 100k dòng vẫn xem được mà không dựng 100k nút. */
export const RUN_ROWS_PER_PAGE = 100;

type RunResult = Extract<SnapshotRunOutcome, { kind: "result" }>;

/**
 * Trạng thái của một lần chạy thử. Kết quả chỉ sống trong bộ nhớ của trang: không vào URL,
 * không vào localStorage, tải lại là mất (AC6).
 */
export type RunState =
  | { phase: "idle" }
  /** `stage`: tải WASM → khởi tạo engine → chạy SQL. Ba nhãn riêng để người xem biết đang chờ gì. */
  | { phase: "busy"; stage: "loading" | "starting" | "running"; progress?: LoadProgress }
  | { phase: "done"; result: RunResult; setupTabs: number }
  | { phase: "empty" }
  | { phase: "sandbox" }
  | { phase: "error"; error: SnapshotRunError };

/** Câu của các tab đứng trước, để tab truy vấn vẫn thấy bảng do tab schema tạo ra. */
export function setupSqlFor(tabs: SnapshotV1["tabs"], index: number): string {
  return tabs
    .slice(0, index)
    .map((tab) => tab.sql.trim())
    .filter((sql) => sql !== "")
    .join(";\n");
}

/**
 * Clipboard API bị chặn ở một số trình duyệt/ngữ cảnh; thử đường sao chép cũ trước khi báo lỗi.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // rơi xuống fallback
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function ReadonlyWorkspace({ snapshot }: { snapshot: SnapshotV1 }) {
  const t = useTranslations("share");
  // Câu giải thích rào chắn nằm ở namespace gốc (guard.json), dùng chung với phòng lab.
  const tg = useTranslations() as unknown as (key: string, values?: Record<string, string | number>) => string;
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const [notice, setNotice] = useState<{ kind: "copied" | "failed"; nonce: number } | null>(null);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<ForkErrorCode | null>(null);
  // Lần fork thứ hai trong cùng trình duyệt phải hỏi lại, không im lặng nhân bản (AC3).
  const [confirmFork, setConfirmFork] = useState(false);
  // Kết quả chạy thử chỉ nằm trong bộ nhớ trang (AC6); `run` là lượt đang chạy để nút Hủy có
  // đúng AbortController, và `runSeq` bỏ kết quả của lượt cũ khi người dùng bấm Chạy lần nữa.
  const [runState, setRunState] = useState<RunState>({ phase: "idle" });
  const [page, setPage] = useState(0);
  const runAbort = useRef<AbortController | null>(null);
  const runSeq = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tabs = snapshot.tabs;
  const active = tabs[Math.min(activeIndex, tabs.length - 1)];
  const activeIdx = Math.min(activeIndex, tabs.length - 1);
  const engineLabel = ENGINE_LABEL[snapshot.project.engine];

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Rời trang giữa lúc chạy: dừng worker của người xem, không để nó chạy tiếp sau khi unmount.
      runAbort.current?.abort();
    };
  }, []);

  // Đổi tab thì kết quả của tab trước không còn đúng ngữ cảnh: ẩn đi, không xóa khỏi máy.
  // Lượt đang chạy của tab cũ cũng phải dừng, nếu không nó chạy tiếp rồi trả kết quả của tab cũ
  // vào vùng kết quả của tab mới.
  const selectTab = (index: number) => {
    if (index !== activeIdx) {
      runSeq.current++; // bỏ kết quả của lượt cũ dù nó có về muộn
      runAbort.current?.abort();
      runAbort.current = null;
    }
    setActiveIndex(index);
    setRunState({ phase: "idle" });
    setPage(0);
  };

  const cancelRun = useCallback(() => {
    runAbort.current?.abort();
  }, []);

  const run = async () => {
    if (!active || runState.phase === "busy") return;
    const seq = ++runSeq.current;
    const setupSql = setupSqlFor(tabs, activeIdx);
    // Dừng lượt cũ trước khi mở lượt mới: bấm Chạy 5 lần liên tiếp không được có 5 phiên sống.
    runAbort.current?.abort();
    const ctl = (runAbort.current = new AbortController());
    setPage(0);
    setRunState({ phase: "busy", stage: "loading" });

    try {
      const outcome = await runSnapshotTab(active, snapshot.project.engine, {
        signal: ctl.signal,
        setupSql,
        onProgress: (progress) => {
          if (seq !== runSeq.current) return;
          setRunState({
            phase: "busy",
            // `download` = đang tải WASM, `init` = WASM xong, engine đang khởi tạo.
            stage: progress.phase === "init" ? "starting" : "loading",
            progress,
          });
        },
        onExecuting: () => {
          if (seq === runSeq.current) setRunState({ phase: "busy", stage: "running" });
        },
      });
      if (seq !== runSeq.current) return; // lượt mới đã bắt đầu: bỏ kết quả cũ
      if (outcome.kind === "needs_sandbox") setRunState({ phase: "sandbox" });
      else if (outcome.kind === "empty") setRunState({ phase: "empty" });
      else {
        const setupTabs = tabs.slice(0, activeIdx).filter((tab) => tab.sql.trim() !== "").length;
        setRunState({ phase: "done", result: outcome, setupTabs });
      }
    } catch (e) {
      if (seq !== runSeq.current) return;
      setRunState({
        phase: "error",
        error: e instanceof SnapshotRunError ? e : new SnapshotRunError("sql", e instanceof Error ? e.message : String(e)),
      });
    } finally {
      if (runAbort.current === ctl) runAbort.current = null;
    }
  };

  const handleCopy = async () => {
    if (!active) return;
    const ok = await copyToClipboard(active.sql);
    setNotice({ kind: ok ? "copied" : "failed", nonce: Date.now() });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setNotice(null), 2500);
  };

  const runErrorMessage = (error: SnapshotRunError): string => {
    switch (error.code) {
      case "timeout":
        return t("view.runTimeout");
      case "cancelled":
        return t("view.runCancelled");
      case "load_failed":
        return t("view.runLoadFailed", { message: error.message });
      case "guard":
        // Lý do chặn đã có câu giải thích trong `guard.json` (lab dùng cùng khóa này). Hiện
        // nguyên văn tiếng Anh của engine cho người xem Việt là vô nghĩa (review vòng 1).
        if (error.guardReasonKey) {
          try {
            return tg(error.guardReasonKey, { index: error.statementIndex ?? 0 });
          } catch {
            return t("view.runGuardTitle");
          }
        }
        return t("view.runGuardTitle");
      default:
        return error.message;
    }
  };

  const forkErrorMessage = (code: ForkErrorCode) => {
    switch (code) {
      case "FORK_QUOTA_EXCEEDED":
        return t("view.forkErrorQuota");
      case "FORK_STORAGE_UNAVAILABLE":
        return t("view.forkErrorStorage");
      case "FORK_TOO_LARGE":
      case "FORK_LIMIT_REACHED":
      case "FORK_FAILED":
        return t("view.forkError");
    }
  };

  // Scope được hỏi đúng lúc bấm Fork: trang /share không gọi /api/me khi tải.
  const runFork = async () => {
    setForking(true);
    setForkError(null);
    try {
      const scope = await resolveWorkspaceScope();
      const result = await forkSnapshot(snapshot, scope, { suffix: t("view.forkSuffix") });
      setConfirmFork(false);
      // Toaster toàn cục, nên thông báo sống qua bước điều hướng về workspace.
      toast.success(t("view.forkDone", { count: result.tabs }));
      router.push("/");
    } catch (err) {
      setForkError(err instanceof ForkError ? err.code : "FORK_FAILED");
      setConfirmFork(false);
    } finally {
      setForking(false);
    }
  };

  const handleForkClick = () => {
    if (hasForkedSnapshot(snapshotFingerprint(snapshot))) {
      setConfirmFork(true);
      return;
    }
    void runFork();
  };

  return (
    <div
      data-testid="readonly-workspace"
      className="share-page flex h-dvh w-full flex-col overflow-hidden bg-stage font-sans text-text"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line bg-ground px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex shrink-0 items-center gap-2 text-sm font-bold">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5">
              <circle cx="10" cy="10" r="8.5" fill="none" strokeWidth="1.5" stroke="var(--text)" />
              <path
                d="M10 6v3M10 9H6.5v2.5M10 9h3.5v2.5"
                fill="none"
                strokeWidth="1.2"
                stroke="var(--text)"
              />
              <rect x="8.5" y="4" width="3" height="3" fill="var(--lamp)" />
              <rect x="5" y="11.5" width="3" height="3" fill="var(--text)" />
              <rect x="12" y="11.5" width="3" height="3" fill="var(--text)" />
            </svg>
            <span className="tracking-tight">SQLLens</span>
          </span>

          <span className="hidden h-4 w-px bg-line sm:block" aria-hidden="true" />

          <span
            data-testid="readonly-badge"
            className="hidden shrink-0 items-center gap-1.5 rounded-xs border border-severity-uncertain/40 bg-severity-uncertain-bg px-2 py-0.5 font-mono text-[11px] text-severity-uncertain-foreground sm:inline-flex"
          >
            <span className="size-1.5 rounded-full bg-severity-uncertain" aria-hidden="true" />
            {t("view.badge")}
          </span>

          <h1
            data-testid="share-project-name"
            className="min-w-0 truncate text-xs font-semibold text-text"
            title={snapshot.project.name}
          >
            {snapshot.project.name}
          </h1>

          <span className="hidden shrink-0 rounded-xs border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] text-dim sm:inline">
            {engineLabel}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <p className="sr-only">{t("view.readOnlyNote")}</p>
          {forkError && (
            <span
              role="alert"
              data-testid="share-fork-error"
              className="hidden max-w-[240px] truncate text-[11px] text-negative sm:inline"
            >
              {forkErrorMessage(forkError)}
            </span>
          )}
          <button
            type="button"
            data-testid="share-run-btn"
            data-print-hide
            onClick={() => void run()}
            disabled={!active || runState.phase === "busy"}
            aria-busy={runState.phase === "busy" || undefined}
            title={t("view.runLocalNote")}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius)] border border-line bg-raised px-2.5 text-xs font-medium text-ink2 transition-colors hover:bg-control hover:text-text focus:outline-none focus-visible:ring-1 focus-visible:ring-lamp disabled:opacity-60"
          >
            {runState.phase === "busy" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-3.5 text-severity-passed" aria-hidden="true" />
            )}
            <span>{runState.phase === "busy" ? t("view.runRunning") : t("view.run")}</span>
          </button>
          <button
            type="button"
            data-testid="share-fork-btn"
            data-print-hide
            onClick={handleForkClick}
            disabled={forking}
            aria-busy={forking || undefined}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius)] border border-lamp/60 bg-lamp/10 px-2.5 text-xs font-medium text-lamp transition-colors hover:bg-lamp/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-lamp disabled:opacity-60"
          >
            {forking ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <GitFork className="size-3.5" aria-hidden="true" />
            )}
            <span>{forking ? t("view.forking") : t("view.fork")}</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line bg-ground px-3">
          <div
            role="tablist"
            aria-label={t("view.tabsLabel")}
            className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto scrollbar-none"
          >
            {tabs.map((tab, index) => {
              const isActive = index === Math.min(activeIndex, tabs.length - 1);
              return (
                <button
                  key={`${index}-${tab.name}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  title={tab.name}
                  data-testid={`share-tab-${index}`}
                  onClick={() => selectTab(index)}
                  className={cn(
                    "relative flex h-7 max-w-[200px] shrink-0 items-center gap-1.5 rounded-t-[var(--radius)] border border-b-0 px-2.5 font-mono text-[11px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-lamp",
                    isActive
                      ? "border-line bg-surface text-lamp"
                      : "border-transparent bg-ground/70 text-dim hover:bg-surface/50 hover:text-text",
                  )}
                >
                  <Lock className="size-3 shrink-0 text-dim" aria-hidden="true" />
                  <span className="truncate">{tab.name}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            data-testid="share-copy-sql"
            data-print-hide
            onClick={handleCopy}
            disabled={!active}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius)] px-2 text-xs text-dim transition-colors hover:bg-raised hover:text-lamp focus:outline-none focus-visible:ring-1 focus-visible:ring-lamp disabled:opacity-50"
          >
            <Copy className="size-3.5" aria-hidden="true" />
            <span>{t("view.copy")}</span>
          </button>
        </div>

        <div className="relative min-h-0 flex-1 bg-surface">
          {active ? (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-6 bottom-4 z-10 font-mono text-3xl font-bold tracking-widest text-line/80 select-none"
              >
                READ_ONLY
              </span>
              <SqlEditor
                key={`${activeIdx}-${active.name}`}
                value={active.sql}
                onChange={() => {}}
                engine={snapshot.project.engine as EngineId}
                ariaLabel={t("view.editorLabel", { name: active.name })}
                readOnly
              />
              {active.sql.trim() === "" && (
                <p className="absolute inset-x-0 top-3 text-center text-xs text-dim">
                  {t("view.emptyTab")}
                </p>
              )}
            </>
          ) : (
            <p className="p-6 text-center text-sm text-dim">{t("view.noTabs")}</p>
          )}
        </div>

        <RunPanel
          state={runState}
          engineLabel={engineLabel}
          page={page}
          onPage={setPage}
          onCancel={cancelRun}
          onClose={() => setRunState({ phase: "idle" })}
          errorMessage={runErrorMessage}
        />
      </div>

      <Dialog open={confirmFork} onOpenChange={setConfirmFork}>
        <DialogContent data-testid="share-fork-confirm" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("view.forkAgainTitle")}</DialogTitle>
            <DialogDescription>{t("view.forkAgainBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              data-testid="share-fork-cancel"
              onClick={() => setConfirmFork(false)}
              className="inline-flex h-8 items-center rounded-[var(--radius)] border border-line bg-ground px-3 text-xs text-text transition-colors hover:bg-raised focus:outline-none focus-visible:ring-1 focus-visible:ring-lamp"
            >
              {t("view.forkAgainCancel")}
            </button>
            <button
              type="button"
              data-testid="share-fork-confirm-btn"
              onClick={() => void runFork()}
              disabled={forking}
              className="inline-flex h-8 items-center rounded-[var(--radius)] bg-lamp px-3 text-xs font-semibold text-stage transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-lamp disabled:opacity-60"
            >
              {t("view.forkAgainConfirm")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        role="status"
        aria-live="polite"
        data-testid="share-toast"
        className={cn(
          "pointer-events-none fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 font-mono text-xs text-text shadow-xl transition-all duration-200",
          notice ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        )}
      >
        <Check
          className={cn("size-3.5", notice?.kind === "failed" ? "text-negative" : "text-severity-passed")}
          aria-hidden="true"
        />
        <span>
          {notice?.kind === "failed" ? t("view.copyFailed") : notice?.kind === "copied" ? t("view.copied") : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * Vùng kết quả dưới editor.
 *
 * Bám prototype (console cao cố định ở đáy cột SQL) và luôn có mặt, nên chuyển từ trạng thái
 * rỗng sang đang chạy rồi ra kết quả **không đẩy layout nhảy**: chiều cao khung là hằng số,
 * chỉ phần thân cuộn bên trong đổi. Kết quả mang nhãn `Thật` của `ConclusionBadge` — database
 * trong máy vừa chạy ra đúng những dòng này (Core Rule 1), và không bao giờ dùng nhãn
 * Mô phỏng/Ước lượng cho nó.
 */
function RunPanel({
  state,
  engineLabel,
  page,
  onPage,
  onCancel,
  onClose,
  errorMessage,
}: {
  state: RunState;
  engineLabel: string;
  page: number;
  onPage: (page: number) => void;
  onCancel: () => void;
  onClose: () => void;
  errorMessage: (error: SnapshotRunError) => string;
}) {
  const t = useTranslations("share");
  const busy = state.phase === "busy";
  const result = state.phase === "done" ? state.result : null;
  const setupTabs = state.phase === "done" ? state.setupTabs : 0;

  const pages = result ? Math.max(1, Math.ceil(result.rows.length / RUN_ROWS_PER_PAGE)) : 1;
  const current = Math.min(page, pages - 1);
  const shown = result ? result.rows.slice(current * RUN_ROWS_PER_PAGE, (current + 1) * RUN_ROWS_PER_PAGE) : [];

  // Một chỗ duy nhất quyết định câu trạng thái, để dòng tiêu đề và phần thân không nói lệch nhau.
  const busyLabel =
    state.phase !== "busy"
      ? ""
      : state.stage === "loading"
        ? t("view.runLoading", { engine: engineLabel })
        : state.stage === "starting"
          ? t("view.runStarting", { engine: engineLabel })
          : t("view.runRunning");

  const status = (() => {
    switch (state.phase) {
      case "idle":
        return t("view.runLocalNote");
      case "busy":
        return busyLabel;
      case "done":
        return [
          t("view.runStatements", { count: state.result.statements }),
          state.result.fields.length > 0
            ? t("view.runRows", { count: state.result.totalRows })
            : state.result.affectedRows !== undefined
              ? t("view.runAffected", { count: state.result.affectedRows })
              : null,
        ]
          .filter(Boolean)
          .join(" · ");
      case "error":
        // Cùng một câu với tiêu đề trong phần thân: không nói "không chạy được" ở đây rồi
        // "bị rào chắn chặn" ở dưới.
        if (state.error.code === "timeout") return t("view.runTimeout");
        return state.error.code === "guard" ? t("view.runGuardTitle") : t("view.runFailedTitle");
      case "sandbox":
        return t("view.runNeedsSandboxTitle");
      case "empty":
        return t("view.runEmptyTitle");
    }
  })();

  return (
    <section
      data-testid="share-run-panel"
      data-phase={state.phase}
      aria-label={t("view.runResultTitle")}
      className="flex h-[186px] shrink-0 flex-col border-t border-line bg-stage font-mono text-[11px]"
    >
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line/70 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              busy ? "animate-pulse bg-lamp" : state.phase === "error" ? "bg-negative" : "bg-severity-passed",
            )}
          />
          <span className="truncate text-dim">{status}</span>
          {result && <ConclusionBadge label="real" testId="share-run-label" className="shrink-0" />}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {busy && (
            <button
              type="button"
              data-testid="share-run-cancel"
              onClick={onCancel}
              className="inline-flex h-6 items-center gap-1 rounded-[var(--radius)] border border-line bg-ground px-2 text-[11px] text-text transition-colors hover:bg-raised focus:outline-none focus-visible:ring-1 focus-visible:ring-lamp"
            >
              <X className="size-3" aria-hidden="true" />
              {t("view.runCancel")}
            </button>
          )}
          {result && pages > 1 && (
            <>
              <button
                type="button"
                data-testid="share-run-prev"
                aria-label={t("view.runPrev")}
                disabled={current === 0}
                onClick={() => onPage(current - 1)}
                className="inline-flex size-6 items-center justify-center rounded-[var(--radius)] text-dim transition-colors hover:bg-raised hover:text-text disabled:opacity-40"
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" />
              </button>
              <span data-testid="share-run-page" className="text-[10px] text-dim">
                {t("view.runPage", { page: current + 1, pages })}
              </span>
              <button
                type="button"
                data-testid="share-run-next"
                aria-label={t("view.runNext")}
                disabled={current >= pages - 1}
                onClick={() => onPage(current + 1)}
                className="inline-flex size-6 items-center justify-center rounded-[var(--radius)] text-dim transition-colors hover:bg-raised hover:text-text disabled:opacity-40"
              >
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            </>
          )}
          {state.phase !== "idle" && !busy && (
            <button
              type="button"
              data-testid="share-run-close"
              aria-label={t("view.runClose")}
              onClick={onClose}
              className="inline-flex size-6 items-center justify-center rounded-[var(--radius)] text-dim transition-colors hover:bg-raised hover:text-text"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {state.phase === "idle" && (
          <p className="text-dim">{t("view.runLocalNote")}</p>
        )}

        {busy && (
          <div role="status" aria-live="polite" data-testid="share-run-busy" data-stage={state.stage} className="flex flex-col gap-1.5 text-dim">
            <span>{busyLabel}</span>
            {state.stage === "loading" && state.progress?.loadedBytes !== undefined && (
              <progress
                aria-label={busyLabel}
                className="w-full max-w-xs"
                max={state.progress.totalBytes}
                value={state.progress.totalBytes ? state.progress.loadedBytes : undefined}
              />
            )}
          </div>
        )}

        {state.phase === "empty" && (
          <p data-testid="share-run-empty" className="text-dim">
            {t("view.runEmptyBody")}
          </p>
        )}

        {state.phase === "sandbox" && (
          <p data-testid="share-run-sandbox" className="text-severity-uncertain-foreground">
            {t("view.runNeedsSandboxBody")}
          </p>
        )}

        {state.phase === "error" && (
          <div role="alert" data-testid="share-run-error" className="flex flex-col gap-1">
            <p className="flex items-center gap-1.5 font-semibold text-negative">
              <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
              {state.error.code === "guard" ? t("view.runGuardTitle") : t("view.runFailedTitle")}
            </p>
            <p className="whitespace-pre-wrap break-words text-ink2">{errorMessage(state.error)}</p>
            {state.error.statementIndex !== undefined && (
              <p className="text-dim">{t("view.runStatementAt", { n: state.error.statementIndex })}</p>
            )}
          </div>
        )}

        {result && (
          <div data-testid="share-run-result" className="flex flex-col gap-1.5">
            {setupTabs > 0 && (
              <p className="text-dim">{t("view.runSetup", { count: setupTabs })}</p>
            )}
            {result.fields.length === 0 ? (
              <p className="text-ink2">
                {result.affectedRows !== undefined
                  ? t("view.runAffected", { count: result.affectedRows })
                  : t("view.runNoRows")}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-[var(--radius)] border border-line">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="bg-raised text-dim">
                        <th scope="col" className="w-10 px-2 py-1 text-center font-normal">
                          {t("view.runRowNumber")}
                        </th>
                        {result.fields.map((field, i) => (
                          <th key={i} scope="col" className="whitespace-nowrap px-2 py-1 font-semibold text-ink2">
                            {field}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row, r) => (
                        <tr key={current * RUN_ROWS_PER_PAGE + r} className="border-t border-line/50">
                          <td className="px-2 py-0.5 text-center text-dim/70">
                            {current * RUN_ROWS_PER_PAGE + r + 1}
                          </td>
                          {result.fields.map((_, c) => {
                            const cell = formatCell(row[c]);
                            return (
                              <td
                                key={c}
                                data-kind={cell.kind}
                                className={cn(
                                  "max-w-[280px] truncate px-2 py-0.5",
                                  cell.kind === "null" && "text-dim/60 italic",
                                  cell.kind === "number" && "text-right text-ink2",
                                )}
                                title={cell.text}
                              >
                                {cell.text}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.rows.length === 0 && <p className="text-dim">{t("view.runNoRows")}</p>}
                {result.truncated && (
                  <p className="text-severity-uncertain-foreground">
                    {t("view.runTruncated", { max: result.rows.length, total: result.totalRows })}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
