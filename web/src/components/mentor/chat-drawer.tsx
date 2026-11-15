"use client";

import React, { useCallback, useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export interface ChatDrawerProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ChatDrawer({
  open,
  onOpenChange,
  onClose,
  title,
  children,
  className,
}: ChatDrawerProps) {
  const t = useTranslations("mentor");

  const handleClose = useCallback(() => {
    onClose?.();
    onOpenChange?.(false);
  }, [onClose, onOpenChange]);

  // Hỗ trợ phím Escape đóng drawer
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : t("chatDrawer.title")}
      data-testid="chat-drawer"
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className={cn(
          "relative flex h-full w-full max-w-lg flex-col border-l border-line bg-surface shadow-2xl transition-transform duration-300 ease-in-out sm:w-[480px]",
          className
        )}
      >
        {/* Header Drawer */}
        <div className="flex h-12 flex-none items-center justify-between border-b border-line px-4">
          <div className="text-sm font-semibold text-ink">
            {title ?? t("chatDrawer.title")}
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleClose}
            aria-label={t("chatDrawer.close")}
            data-testid="chat-drawer-close"
            className="h-8 w-8 text-dim hover:text-ink"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Thân Drawer cuộn mượt mà không tràn viền */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export { PlanEvidencePill } from "./plan-evidence-pill";
export { QuickActionChips } from "./quick-action-chips";
