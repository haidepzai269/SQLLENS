"use client";

/**
 * Khung xem snapshot ở chế độ chỉ đọc.
 *
 * Bám prototype `_bmad-output/share_preview_prototype.html` (màn hình 2): header 44px,
 * badge "Snapshot chỉ đọc", tab bar không có nút thêm/đóng, editor có số dòng và highlight.
 * Không có nút Fork/Chạy — hai việc đó thuộc Task147 và Task148.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Copy, GitFork, Loader2, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SqlEditor } from "@/components/sql-editor/sql-editor";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EngineId } from "@/contracts/engine";
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

const ENGINE_LABEL: Record<SnapshotV1["project"]["engine"], string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
};

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
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const [notice, setNotice] = useState<{ kind: "copied" | "failed"; nonce: number } | null>(null);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<ForkErrorCode | null>(null);
  // Lần fork thứ hai trong cùng trình duyệt phải hỏi lại, không im lặng nhân bản (AC3).
  const [confirmFork, setConfirmFork] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tabs = snapshot.tabs;
  const active = tabs[Math.min(activeIndex, tabs.length - 1)];
  const engineLabel = ENGINE_LABEL[snapshot.project.engine];

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (!active) return;
    const ok = await copyToClipboard(active.sql);
    setNotice({ kind: ok ? "copied" : "failed", nonce: Date.now() });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setNotice(null), 2500);
  };

  const forkErrorMessage = (code: ForkErrorCode) => {
    if (code === "FORK_QUOTA_EXCEEDED") return t("view.forkErrorQuota");
    if (code === "FORK_STORAGE_UNAVAILABLE") return t("view.forkErrorStorage");
    return t("view.forkError");
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
                  onClick={() => setActiveIndex(index)}
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
                key={`${activeIndex}-${active.name}`}
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
