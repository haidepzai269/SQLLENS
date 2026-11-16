"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/modules/auth/auth-provider";
import { cn } from "@/lib/utils";
import { bootWorkspace } from "../hydrate";
import {
  dismissGuestImport,
  hasGuestDrafts,
  importGuestDrafts,
  isGuestImportDismissed,
  isGuestImportedForUser,
  type ImportGuestOptions,
} from "../import-guest";
import type { WorkspaceScope } from "../types";

export interface ImportGuestBannerProps {
  className?: string;
  options?: ImportGuestOptions;
  bootFn?: (scope: WorkspaceScope) => Promise<unknown>;
  onImportSuccess?: (result: { projects: number; tabs: number }) => void;
}

export function ImportGuestBanner({
  className,
  options,
  bootFn = bootWorkspace,
  onImportSuccess,
}: ImportGuestBannerProps) {
  const t = useTranslations("workspace");
  const { status, user } = useAuth();

  const [hasDrafts, setHasDrafts] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [isImported, setIsImported] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [toast, setToast] = useState<{ projects: number; tabs: number } | null>(null);

  const userId = user?.id;

  // Điều kiện để xem xét hiển thị banner:
  // - Người dùng đã đăng nhập (status === "user" && userId)
  // - Chưa từng dismiss trong phiên hiện tại (sessionStorage)
  // - Chưa từng import vào tài khoản này trước đây (localStorage)
  const isEligible =
    status === "user" &&
    Boolean(userId) &&
    !isGuestImportDismissed(userId!, options) &&
    !isGuestImportedForUser(userId!, options);

  useEffect(() => {
    if (!isEligible) return;

    let active = true;
    void hasGuestDrafts(options)
      .then((has) => {
        if (active) {
          setHasDrafts(has);
        }
      })
      .catch(() => {
        if (active) {
          setHasDrafts(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isEligible, options]);

  // Tự động ẩn toast sau 5 giây
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleDismiss = useCallback(() => {
    if (!userId) return;
    dismissGuestImport(userId, options);
    setIsDismissed(true);
  }, [userId, options]);

  const handleImport = useCallback(async () => {
    if (!userId || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await importGuestDrafts(userId, options);
      // Nạp lại workspace của user để giao diện thấy ngay projects và tabs mới
      if (result.projects > 0 || result.tabs > 0) {
        await bootFn({ kind: "user", userId });
      }

      setIsImported(true);
      setHasDrafts(false);
      setToast(result);
      onImportSuccess?.(result);
    } catch {
      // Giữ nguyên trạng thái để người dùng có thể thử lại
    } finally {
      setIsSubmitting(false);
    }
  }, [userId, isSubmitting, options, bootFn, onImportSuccess]);

  const showBanner = isEligible && hasDrafts && !isDismissed && !isImported;

  return (
    <>
      {showBanner && (
        <aside
          role="region"
          aria-label={t("guestImport.title")}
          data-testid="import-guest-banner"
          className={cn(
            "flex flex-col gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-text sm:flex-row sm:items-center sm:justify-between",
            className,
          )}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="font-medium text-text leading-tight" data-testid="import-guest-banner-title">
              {t("guestImport.title")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={handleImport}
              disabled={isSubmitting}
              data-testid="import-guest-action-btn"
              className="h-7 px-2.5 text-xs font-medium"
            >
              {isSubmitting ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="mr-1.5 size-3.5" aria-hidden="true" />
              )}
              {t("guestImport.action")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              disabled={isSubmitting}
              data-testid="import-guest-dismiss-btn"
              className="h-7 px-2 text-xs text-dim hover:text-text"
            >
              {t("guestImport.dismiss")}
            </Button>
          </div>
        </aside>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          data-testid="guest-import-toast"
          className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-md animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <div className="pointer-events-auto flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-surface p-3.5 shadow-lg">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" aria-hidden="true" />
            <div className="flex flex-col gap-1 pr-2">
              <p className="text-xs font-semibold text-text" data-testid="guest-import-toast-text">
                {t("guestImport.done", { projects: toast.projects, tabs: toast.tabs })}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setToast(null)}
              aria-label={t("dismiss")}
              data-testid="guest-import-toast-dismiss"
              className="size-6 shrink-0 text-dim hover:text-text"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
