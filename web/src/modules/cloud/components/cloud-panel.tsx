"use client";

// Panel Cloud của một dự án (SP023 / Task154).
//
// Bốn trạng thái hiển thị cho người dùng: `local` (chỉ trên máy), `synced` (khớp bản cloud),
// `modified` (đã sửa sau lần lưu), `conflict` (máy khác đã sửa trước). Trạng thái suy ra từ dấu
// vân tay nội dung (`status.ts`), không từ đồng hồ.
//
// Không có gì tự chạy: không timer, không tự đẩy khi đóng tab, không gọi mạng lúc mount. Mọi
// yêu cầu mạng đều bắt đầu từ một cú bấm (Core Rule 7 và hợp đồng Task153).

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Download,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/modules/auth/auth-provider";
import { SignInLink } from "@/modules/auth/guest";
import { useWorkspaceStore } from "@/modules/workspace/store";
import { CloudApiError, deleteCloudProject } from "../api";
import { pullIntoProject } from "../apply";
import { projectCloudState, type CloudProjectState } from "../status";
import { CloudSyncError, detachCloudLink, failure, pushProject } from "../sync";

interface CloudPanelProps {
  projectId: string;
  onClose?: () => void;
  className?: string;
}

type Busy = null | "push" | "pull" | "delete";

function asSyncError(err: unknown): CloudSyncError {
  if (err instanceof CloudSyncError) return err;
  return new CloudSyncError("FAILED", err instanceof Error ? err.message : String(err));
}

export function CloudPanel({ projectId, onClose, className }: CloudPanelProps) {
  const t = useTranslations("cloud");
  const locale = useLocale();
  const { status: authStatus } = useAuth();

  const project = useWorkspaceStore((state) => state.projects.find((p) => p.id === projectId));
  const tabs = useWorkspaceStore((state) => state.tabs);
  const setProjectCloud = useWorkspaceStore((state) => state.setProjectCloud);
  const replaceProjectContent = useWorkspaceStore((state) => state.replaceProjectContent);

  const [busy, setBusy] = useState<Busy>(null);
  const [conflict, setConflict] = useState<{ remoteUpdatedAt: string; localUpdatedAt: number } | null>(null);
  // Bản trên cloud đã bị xóa (server trả 404 cho `remoteId` đang lưu). Không tự xóa liên kết: giữ
  // trạng thái này để người dùng chọn lưu thành dự án mới hay gỡ liên kết.
  const [remoteGone, setRemoteGone] = useState(false);
  // Sau khi người dùng chọn "giữ bản máy", bản local đã khác cloud nhưng dấu vân tay vẫn là của
  // bản cũ. Giữ cờ này để trạng thái hiện `modified` thay vì nói dối là `synced`.
  const [diverged, setDiverged] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  const [error, setError] = useState<CloudSyncError | null>(null);
  const [notice, setNotice] = useState<"deleteDone" | "pullDone" | "remoteGoneDetached" | null>(null);

  const anonymous = authStatus === "anon";
  const computed: CloudProjectState = useMemo(
    () => (project ? projectCloudState(project, tabs) : "local"),
    [project, tabs],
  );
  const state: CloudProjectState = conflict ? "conflict" : diverged ? "modified" : computed;

  const formatTime = useCallback(
    (value: string | number) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      try {
        return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(date);
      } catch {
        return date.toLocaleString();
      }
    },
    [locale],
  );

  const errorText = useCallback(
    (err: CloudSyncError) => {
      // Mã cụ thể của server (`too_many_tabs`…) nói rõ hơn mã chung "bị từ chối".
      const serverKey = `rejected.${err.serverCode ?? ""}` as never;
      if (err.serverCode && t.has(serverKey)) return t(serverKey);
      return t(`error.${err.code}`);
    },
    [t],
  );

  const clearFeedback = () => {
    setError(null);
    setNotice(null);
  };

  /**
   * Đẩy dự án lên cloud. `asNew` dùng cho lối thoát sau `remote_gone`: bỏ qua liên kết đã chết và
   * tạo dự án mới thay vì PUT vào id không còn tồn tại (404 mãi mãi).
   */
  const handleSave = async (asNew = false) => {
    if (busy || !project) return;
    clearFeedback();
    setConflict(null);
    setBusy("push");
    try {
      const result = await pushProject(projectId, { asNew });
      if (result.kind === "conflict") {
        setConflict({ remoteUpdatedAt: result.remoteUpdatedAt, localUpdatedAt: result.localUpdatedAt });
        return;
      }
      if (result.kind === "remote_gone") {
        // Không ghi gì cả: bản local nguyên vẹn, liên kết giữ nguyên, người dùng quyết định.
        setRemoteGone(true);
        return;
      }
      setRemoteGone(false);
      setProjectCloud(projectId, {
        remoteId: result.remoteId,
        remoteUpdatedAt: result.updatedAt,
        stamp: result.stamp,
      });
      setDiverged(false);
    } catch (err) {
      setError(asSyncError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDetach = async () => {
    if (busy || !project) return;
    clearFeedback();
    setBusy("delete");
    try {
      await detachCloudLink(projectId);
      setProjectCloud(projectId, undefined);
      setRemoteGone(false);
      setConflict(null);
      setDiverged(false);
      setNotice("remoteGoneDetached");
    } catch (err) {
      setError(asSyncError(err));
    } finally {
      setBusy(null);
    }
  };

  const handlePull = async () => {
    if (busy || !project) return;
    clearFeedback();
    setConfirmPull(false);
    setBusy("pull");
    try {
      const pulled = await pullIntoProject(projectId);
      replaceProjectContent(pulled.project, pulled.tabs);
      setConflict(null);
      setDiverged(false);
      setNotice("pullDone");
    } catch (err) {
      setError(asSyncError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (busy || !project) return;
    clearFeedback();
    setBusy("delete");
    try {
      if (project.cloud) {
        try {
          await deleteCloudProject(project.cloud.remoteId);
        } catch (err) {
          // 404: bản trên cloud đã bị xóa ở nơi khác. Việc cần làm vẫn là dọn liên kết, nếu
          // không dự án kẹt ở `synced` với một cái bóng không còn tồn tại.
          if (!(err instanceof CloudApiError && err.status === 404)) throw err;
        }
      }
      setProjectCloud(projectId, undefined);
      setDiverged(false);
      setConflict(null);
      setConfirmDelete(false);
      setNotice("deleteDone");
    } catch (err) {
      setError(err instanceof CloudApiError ? failure(err) : asSyncError(err));
      setConfirmDelete(false);
    } finally {
      setBusy(null);
    }
  };

  if (!project) return null;

  const disabled = busy !== null;
  const statusLabel = t(`status.${state}`);
  const savedAt = project.cloud?.remoteUpdatedAt;

  return (
    <div
      className={
        "flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2" + (className ? ` ${className}` : "")
      }
      data-testid="cloud-panel"
      data-state={state}
      aria-busy={disabled}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {state === "local" ? (
              <CloudOff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Cloud
                className={
                  "size-3.5 shrink-0 " +
                  (state === "synced" ? "text-primary" : "text-amber-600 dark:text-amber-400")
                }
                aria-hidden="true"
              />
            )}
            <span className="truncate text-xs font-medium" data-testid="cloud-status">
              {statusLabel}
            </span>
          </div>
          {state !== "local" && savedAt && (
            <p className="mt-0.5 text-[10px] text-muted-foreground" data-testid="cloud-saved-at">
              {t("savedAt", { time: formatTime(savedAt) })}
            </p>
          )}
        </div>
        {onClose && (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label={t("close")}
            data-testid="cloud-close"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {anonymous ? (
        <div className="flex flex-col gap-2" data-testid="cloud-need-login">
          <p className="text-xs text-muted-foreground">{t("needLogin")}</p>
          <SignInLink className="text-xs font-medium text-primary underline underline-offset-2">
            {t("needLoginAction")}
          </SignInLink>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-8 w-full justify-start gap-1.5 text-xs"
              onClick={() => void handleSave()}
              disabled={disabled}
              data-testid="cloud-save"
            >
              {busy === "push" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-3.5" aria-hidden="true" />
              )}
              {busy === "push" ? t("saving") : t("save")}
            </Button>

            {state !== "local" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-full justify-start gap-1.5 text-xs"
                onClick={() => {
                  clearFeedback();
                  if (state === "modified") setConfirmPull(true);
                  else void handlePull();
                }}
                disabled={disabled}
                data-testid="cloud-pull"
              >
                {busy === "pull" ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-3.5" aria-hidden="true" />
                )}
                {busy === "pull" ? t("pulling") : t("pull")}
              </Button>
            )}

            {state !== "local" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 w-full justify-start gap-1.5 text-xs text-destructive/90 hover:text-destructive"
                onClick={() => {
                  clearFeedback();
                  setConfirmDelete(true);
                }}
                disabled={disabled}
                data-testid="cloud-delete"
              >
                {busy === "delete" ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-3.5" aria-hidden="true" />
                )}
                {busy === "delete" ? t("deleting") : t("delete")}
              </Button>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground">{t("privacy")}</p>

          {confirmPull && (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2"
              data-testid="cloud-pull-confirm"
            >
              <p className="text-xs leading-tight">{t("pullConfirm")}</p>
              <div className="mt-2 flex justify-end gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => setConfirmPull(false)}
                  data-testid="cloud-pull-cancel"
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="default"
                  onClick={() => void handlePull()}
                  data-testid="cloud-pull-confirm-action"
                >
                  {t("pullConfirmAction")}
                </Button>
              </div>
            </div>
          )}

          {confirmDelete && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 p-2"
              data-testid="cloud-delete-confirm"
            >
              <p className="flex items-start gap-1.5 text-xs leading-tight text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{t("deleteConfirm")}</span>
              </p>
              <div className="mt-2 flex justify-end gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => setConfirmDelete(false)}
                  data-testid="cloud-delete-cancel"
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="destructive"
                  onClick={() => void handleDelete()}
                  data-testid="cloud-delete-confirm-action"
                >
                  {t("deleteConfirmAction")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {conflict && (
        <div
          className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2"
          data-testid="cloud-conflict"
          role="group"
          aria-label={t("conflict")}
        >
          <p className="flex items-start gap-1.5 text-xs font-medium leading-tight">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <span>{t("conflict")}</span>
          </p>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {t("conflictRemote", { time: formatTime(conflict.remoteUpdatedAt) })}
            <br />
            {t("conflictLocal", { time: formatTime(conflict.localUpdatedAt) })}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">{t("conflictHint")}</p>
          <div className="mt-2 flex flex-col gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="w-full justify-start gap-1"
              onClick={() => {
                setConflict(null);
                setDiverged(true);
              }}
              data-testid="cloud-conflict-keep"
            >
              <Check className="size-3" aria-hidden="true" />
              {t("conflictKeepLocal")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="default"
              className="w-full justify-start gap-1"
              onClick={() => void handlePull()}
              disabled={disabled}
              data-testid="cloud-conflict-take"
            >
              {busy === "pull" ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-3" aria-hidden="true" />
              )}
              {t("conflictTakeRemote")}
            </Button>
          </div>
        </div>
      )}

      {remoteGone && (
        <div
          className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2"
          data-testid="cloud-remote-gone"
          role="group"
          aria-label={t("remoteGone")}
        >
          <p className="flex items-start gap-1.5 text-xs font-medium leading-tight">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <span>{t("remoteGone")}</span>
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">{t("remoteGoneHint")}</p>
          <div className="mt-2 flex flex-col gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="default"
              className="w-full justify-start gap-1"
              onClick={() => void handleSave(true)}
              disabled={disabled}
              data-testid="cloud-remote-gone-save-new"
            >
              <Upload className="size-3" aria-hidden="true" />
              {t("remoteGoneSaveNew")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="w-full justify-start gap-1"
              onClick={() => void handleDetach()}
              disabled={disabled}
              data-testid="cloud-remote-gone-detach"
            >
              <CloudOff className="size-3" aria-hidden="true" />
              {t("remoteGoneDetach")}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive" role="alert" data-testid="cloud-error">
          <AlertDescription className="flex items-start justify-between gap-2 text-xs">
            <span>{errorText(error)}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label={t("dismiss")}
              className="shrink-0 opacity-70 hover:opacity-100"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </AlertDescription>
        </Alert>
      )}

      {notice && (
        <p className="flex items-center gap-1 text-[10px] text-primary" role="status" data-testid="cloud-notice">
          <Check className="size-3" aria-hidden="true" />
          {t(notice)}
        </p>
      )}
    </div>
  );
}
