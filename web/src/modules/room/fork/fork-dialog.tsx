"use client";

import { useEffect, useState } from "react";
import { GitFork, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ForkError } from "@/modules/share/fork";
import type { WorkspaceScope } from "@/modules/workspace/types";
import {
  ROOM_FORK_MAX_ACTIVE,
  checkForkSize,
  countActiveForks,
  forkRoomToWorkspace,
  type RoomForkInput,
  type RoomForkLimitCause,
  type RoomForkOptions,
  type RoomForkResult,
  type RoomForkTooLargeCause,
} from "./room-fork";

export interface ForkDialogProps {
  room: RoomForkInput;
  /** Scope đã biết trước để đếm khi mở dialog mà không phát sinh thêm request `/api/me`. */
  scope?: WorkspaceScope;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  forkOptions?: RoomForkOptions;
  onForked?: (result: RoomForkResult) => void;
  disabled?: boolean;
  className?: string;
  hideTrigger?: boolean;
}

/**
 * Hộp thoại Fork phòng cộng tác sang Local Sandbox (Task167).
 *
 * Hiển thị số phòng fork hiện tại (`N/5`), khóa nút Fork khi đã đạt 5 phòng,
 * và báo đúng số byte UTF-8 thật + tên tab vi phạm khi vượt ngưỡng 512 KB.
 */
export function ForkDialog({
  room,
  scope,
  open: controlledOpen,
  onOpenChange,
  forkOptions,
  onForked,
  disabled = false,
  className,
  hideTrigger = false,
}: ForkDialogProps) {
  const t = useTranslations("share.roomFork");

  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    setErrorMessage(null);
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [forking, setForking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const targetScope: WorkspaceScope = scope ?? { kind: "guest" };
    countActiveForks(targetScope, { factory: forkOptions?.factory })
      .then((count) => {
        if (!cancelled) {
          setErrorMessage(null);
          setActiveCount(count);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setActiveCount(0);
        if (err instanceof ForkError && err.code === "FORK_STORAGE_UNAVAILABLE") {
          setErrorMessage(t("storageUnavailable"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, scope, forkOptions?.factory, t]);

  const isLimitReached = activeCount !== null && activeCount >= ROOM_FORK_MAX_ACTIVE;

  const mapForkError = (err: unknown): string => {
    if (!(err instanceof ForkError)) return t("failed");
    switch (err.code) {
      case "FORK_TOO_LARGE": {
        const cause = err.cause as Partial<RoomForkTooLargeCause> | undefined;
        if (typeof cause?.bytes === "number" && typeof cause?.tabName === "string") {
          return t("tooLarge", { bytes: cause.bytes, tabName: cause.tabName });
        }
        const fallback = checkForkSize(room.tabs);
        return t("tooLarge", {
          bytes: fallback.bytes,
          tabName: fallback.ok ? (room.tabs[0]?.name ?? "") : fallback.tabName,
        });
      }
      case "FORK_LIMIT_REACHED": {
        const cause = err.cause as Partial<RoomForkLimitCause> | undefined;
        const count = typeof cause?.active === "number" ? cause.active : (activeCount ?? ROOM_FORK_MAX_ACTIVE);
        const max = typeof cause?.max === "number" ? cause.max : ROOM_FORK_MAX_ACTIVE;
        setActiveCount(count);
        return t("limitReached", { count, max });
      }
      case "FORK_STORAGE_UNAVAILABLE":
        return t("storageUnavailable");
      case "FORK_QUOTA_EXCEEDED":
        return t("quotaExceeded");
      case "FORK_FAILED":
        return t("failed");
    }
  };

  const handleConfirm = async () => {
    setForking(true);
    setErrorMessage(null);
    try {
      const result = await forkRoomToWorkspace(room, forkOptions);
      setActiveCount(result.activeForks);
      toast.success(t("success", { count: result.tabs }));
      onForked?.(result);
      setOpen(false);
    } catch (err) {
      setErrorMessage(mapForkError(err));
    } finally {
      setForking(false);
    }
  };

  return (
    <>
      {!hideTrigger && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={className}
          data-testid="fork-open-button"
        >
          <GitFork className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t("button")}
        </Button>
      )}

      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-[calc(100vw-2rem)] sm:max-w-md"
          data-testid="fork-dialog"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitFork className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{t("title")}</span>
            </DialogTitle>
            <DialogDescription className="min-w-0 break-words">
              {t("description")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {t("tabsCount", { count: room.tabs.length })}
              </span>
              <Badge
                variant={isLimitReached ? "destructive" : "secondary"}
                data-testid="fork-active-count"
              >
                {t("activeCount", {
                  count: activeCount ?? 0,
                  max: ROOM_FORK_MAX_ACTIVE,
                })}
              </Badge>
            </div>

            {isLimitReached && (
              <Alert variant="destructive" data-testid="fork-limit-alert">
                <AlertDescription className="min-w-0 break-words">
                  {t("limitReached", {
                    count: activeCount,
                    max: ROOM_FORK_MAX_ACTIVE,
                  })}
                </AlertDescription>
              </Alert>
            )}

            {errorMessage && !isLimitReached && (
              <Alert variant="destructive" data-testid="fork-error-alert">
                <AlertDescription className="min-w-0 break-words">
                  {errorMessage}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={forking}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={forking || isLimitReached}
              data-testid="fork-confirm-button"
            >
              {forking ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {t("forking")}
                </>
              ) : (
                t("confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
