"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Download,
  Loader2,
  Share2,
  ShieldAlert,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { encodeSnapshot } from "../codec";
import { isSnapshotWarnSize, MAX_SNAPSHOT_TABS, SnapshotError, type SnapshotV1 } from "../snapshot";
import { useWorkspaceStore } from "@/modules/workspace/store";

export interface ShareDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  trigger?: ReactNode;
}

/**
 * `blocked` = snapshot quá 32 KB nên không nhét vừa URL.
 * `blocked-tabs` = snapshot quá 100 tab: khác hẳn nguyên nhân, và file `.sqllens` cũng không
 * dùng được vì `decodeSnapshot` từ chối đúng ngưỡng đó, nên không được mời tải file.
 * `failed` = lỗi khác (dữ liệu hỏng, phiên bản lạ) — không được báo nhầm thành "quá 32 KB".
 */
export type ShareStatus = "idle" | "loading" | "ok" | "warn" | "blocked" | "blocked-tabs" | "failed";

/**
 * Ánh xạ lỗi khi mã hoá snapshot sang trạng thái giao diện. Tách riêng để kiểm được cả ba
 * nhánh mà không phải dựng cảnh encode hỏng từ bên ngoài.
 */
export function statusForEncodeError(err: unknown): ShareStatus {
  if (!(err instanceof SnapshotError)) {
    return "failed";
  }
  switch (err.code) {
    case "SNAPSHOT_TOO_MANY_TABS":
      return "blocked-tabs";
    case "SNAPSHOT_TOO_LARGE":
      return "blocked";
    default:
      return "failed";
  }
}

/**
 * Làm sạch tên dự án cho tên file, thay thế các ký tự cấm: /\:*?"<>|
 */
export function sanitizeFileName(name?: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "sqllens";
  const cleaned = trimmed
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "sqllens";
}

/**
 * Format timestamp YYYYMMDD-HHmm cho tên file.
 */
export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

/**
 * Tạo tên file snapshot .sqllens: <tên dự án>-snapshot-<YYYYMMDD-HHmm>.sqllens
 */
export function getSnapshotFileName(projectName: string | undefined, now: Date = new Date()): string {
  const cleanProject = sanitizeFileName(projectName);
  const timeStr = formatTimestamp(now);
  return `${cleanProject}-snapshot-${timeStr}.sqllens`;
}

/**
 * Tải file an toàn 100% client-side (Core Rule 7: 0 byte mạng).
 */
export function saveBlob(blob: Blob, fileName: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const createObjectURL = window.URL?.createObjectURL || (() => "blob:mock");
  const revokeObjectURL = window.URL?.revokeObjectURL || (() => {});

  const url = createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => revokeObjectURL(url), 1000);
}

/**
 * Dựng cấu trúc SnapshotV1 từ state của workspace store.
 */
export function buildSnapshotFromStore(
  activeProjectId: string | null,
  projects: Array<{ id: string; name: string; engine: string }>,
  tabs: Array<{ id: string; projectId: string; name: string; sql: string; position: number }>
): SnapshotV1 {
  const activeProject = activeProjectId
    ? projects.find((p) => p.id === activeProjectId)
    : projects[0];

  const projectTabs = activeProject
    ? tabs.filter((t) => t.projectId === activeProject.id).sort((a, b) => a.position - b.position)
    : tabs;

  const currentTabs = projectTabs.length > 0
    ? projectTabs
    : [{ name: "Query 1.sql", sql: "" }];

  return {
    v: 1,
    project: {
      name: activeProject?.name?.trim() || "sqllens",
      engine: (activeProject?.engine as "postgres" | "mysql" | "sqlite") ?? "postgres",
    },
    tabs: currentTabs.map((t) => ({
      name: t.name,
      sql: t.sql,
    })),
  };
}

export function ShareDialog({
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  disabled = false,
  className,
  trigger,
}: ShareDialogProps) {
  const t = useTranslations("share");
  const locale = useLocale();

  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled && nextOpen) return;
    if (nextOpen) {
      setStatus("loading");
    } else {
      setCopied(false);
    }
    if (!isControlled) {
      setUncontrolledOpen(nextOpen);
    }
    setControlledOpen?.(nextOpen);
  };

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const projects = useWorkspaceStore((s) => s.projects);
  const tabs = useWorkspaceStore((s) => s.tabs);

  const [status, setStatus] = useState<ShareStatus>("idle");
  const [shareUrl, setShareUrl] = useState<string>("");
  const [payloadSize, setPayloadSize] = useState<number>(0);
  const [currentSnapshot, setCurrentSnapshot] = useState<SnapshotV1 | null>(null);
  const [copied, setCopied] = useState(false);

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    const runEncode = async () => {
      setStatus("loading");
      try {
        const snapshot = buildSnapshotFromStore(activeProjectId, projects, tabs);
        if (cancelled) return;
        setCurrentSnapshot(snapshot);

        const payload = await encodeSnapshot(snapshot);
        if (cancelled) return;

        const size = payload.length;
        setPayloadSize(size);

        const origin =
          typeof window !== "undefined" && window.location?.origin
            ? window.location.origin
            : "https://sqllens.com";
        const url = `${origin}/${locale}/share#d=${payload}`;
        setShareUrl(url);

        if (isSnapshotWarnSize(payload)) {
          setStatus("warn");
        } else {
          setStatus("ok");
        }
      } catch (err) {
        if (cancelled) return;
        const snapshot = buildSnapshotFromStore(activeProjectId, projects, tabs);
        setCurrentSnapshot(snapshot);
        // Ba nguyên nhân khác nhau phải ra ba lời báo khác nhau: gộp hết vào "quá 32 KB" là
        // nói sai lý do với người dùng (dự án 101 tab vẫn có thể rất nhỏ) và còn mời họ tải
        // một file `.sqllens` mà `decodeSnapshot` sẽ từ chối đúng vì lý do đó.
        setStatus(statusForEncodeError(err));
      }
    };

    runEncode();

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeProjectId, projects, tabs, locale]);

  const handleCopy = async () => {
    let success = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        success = true;
      }
    } catch {
      success = false;
    }

    // Fallback an toàn khi clipboard bị trình duyệt chặn: select input để copy thủ công
    if (!success && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }

    setCopied(true);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const handleDownload = () => {
    if (!currentSnapshot) return;
    const json = JSON.stringify(currentSnapshot, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const fileName = getSnapshotFileName(currentSnapshot.project.name, new Date());
    saveBlob(blob, fileName);
  };

  return (
    <>
      {trigger ? (
        <span onClick={() => handleOpenChange(true)}>{trigger}</span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => handleOpenChange(true)}
          className={cn("h-7 gap-1.5 px-2.5 text-xs font-medium", className)}
          data-testid="share-button-trigger"
          aria-label={t("buttonLabel")}
        >
          <Share2 className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("buttonLabel")}</span>
        </Button>
      )}

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          className="w-full max-w-[calc(100%-2rem)] sm:max-w-md p-5 gap-4"
          showCloseButton={true}
          data-testid="share-dialog-content"
        >
          <DialogHeader className="gap-1 text-left">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold" data-testid="share-dialog-title">
              <Share2 className="size-4 text-primary" aria-hidden="true" />
              <span>{t("title")}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("warningPrivacy")}
            </DialogDescription>
          </DialogHeader>

          {/* Cảnh báo quyền riêng tư: LUÔN HIỆN Ở MỌI TRẠNG THÁI (AC2) */}
          <div
            className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200"
            data-testid="share-privacy-warning"
          >
            <ShieldAlert className="size-4 shrink-0 text-amber-500 mt-0.5" aria-hidden="true" />
            <span className="leading-relaxed">{t("warningPrivacy")}</span>
          </div>

          {/* Trạng thái Loading */}
          {status === "loading" && (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-muted-foreground" data-testid="share-loading">
              <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
              <span className="text-xs">...</span>
            </div>
          )}

          {/* Trạng thái Blocked (> 32KB hoặc SNAPSHOT_TOO_LARGE) */}
          {status === "blocked" && (
            <div className="flex flex-col gap-3" data-testid="share-blocked-section">
              <Alert variant="destructive" data-testid="share-blocked-warning">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <AlertDescription className="text-xs leading-relaxed">
                  {t("blocked")}
                </AlertDescription>
              </Alert>

              <div className="flex flex-col gap-1.5 pt-1">
                <Button
                  type="button"
                  variant="default"
                  onClick={handleDownload}
                  className="w-full gap-2"
                  data-testid="share-download-btn"
                >
                  <Download className="size-4" aria-hidden="true" />
                  <span>{t("download")}</span>
                </Button>
                <p className="text-[11px] text-muted-foreground text-center" data-testid="share-download-hint">
                  {t("downloadHint")}
                </p>
              </div>
            </div>
          )}

          {/* Trạng thái Blocked vì quá số tab: KHÔNG mời tải file, vì file cũng bị từ chối */}
          {status === "blocked-tabs" && (
            <div className="flex flex-col gap-3" data-testid="share-too-many-tabs-section">
              <Alert variant="destructive" data-testid="share-too-many-tabs-warning">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <AlertDescription className="text-xs leading-relaxed">
                  {t("blockedTabs", { limit: MAX_SNAPSHOT_TABS })}
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Trạng thái lỗi khác: nói đúng là không mã hoá được, không quy cho kích thước */}
          {status === "failed" && (
            <div className="flex flex-col gap-3" data-testid="share-failed-section">
              <Alert variant="destructive" data-testid="share-failed-warning">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <AlertDescription className="text-xs leading-relaxed">
                  {t("failed")}
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Trạng thái Warn (8KB - 32KB) */}
          {status === "warn" && (
            <div className="flex flex-col gap-3" data-testid="share-warn-section">
              <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200" data-testid="share-length-warning">
                <AlertTriangle className="size-4 shrink-0 text-amber-500" aria-hidden="true" />
                <AlertDescription className="text-xs leading-relaxed">
                  {t("warningLength", { size: (payloadSize / 1024).toFixed(1) })}
                </AlertDescription>
              </Alert>

              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  readOnly
                  value={shareUrl}
                  className="font-mono text-xs select-all h-8 flex-1 truncate"
                  data-testid="share-url-input"
                  aria-label={t("copy")}
                />
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleCopy}
                  className="h-8 shrink-0 gap-1.5 text-xs"
                  data-testid="share-copy-btn"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  <span>{copied ? t("copied") : t("copy")}</span>
                </Button>
              </div>

              <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  className="w-full gap-2 text-xs"
                  data-testid="share-download-btn"
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  <span>{t("download")}</span>
                </Button>
                <p className="text-[11px] text-muted-foreground text-center" data-testid="share-download-hint">
                  {t("downloadHint")}
                </p>
              </div>
            </div>
          )}

          {/* Trạng thái OK (< 8KB) */}
          {status === "ok" && (
            <div className="flex flex-col gap-3" data-testid="share-ok-section">
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  readOnly
                  value={shareUrl}
                  className="font-mono text-xs select-all h-8 flex-1 truncate"
                  data-testid="share-url-input"
                  aria-label={t("copy")}
                />
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleCopy}
                  className="h-8 shrink-0 gap-1.5 text-xs"
                  data-testid="share-copy-btn"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  <span>{copied ? t("copied") : t("copy")}</span>
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="sm:justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              data-testid="share-close-btn"
            >
              {t("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { ShareDialog as ShareButton };
