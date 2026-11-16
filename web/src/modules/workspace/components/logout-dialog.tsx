"use client";

import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LogoutChoice } from "../logout-flow";

export interface LogoutDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onConfirm?: (choice: "delete" | "keep") => void;
  onCancel?: () => void;
  onChoice?: (choice: LogoutChoice) => void;
  loading?: boolean;
}

export function LogoutDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  onChoice,
  loading = false,
}: LogoutDialogProps) {
  const t = useTranslations("workspace");

  const handleSelect = (choice: LogoutChoice) => {
    onChoice?.(choice);
    if (choice === "cancel") {
      onCancel?.();
    } else {
      onConfirm?.(choice);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange?.(nextOpen);
    if (!nextOpen) {
      handleSelect("cancel");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-full max-w-[calc(100%-2rem)] sm:max-w-md p-5 gap-4"
        showCloseButton={!loading}
      >
        <DialogHeader className="gap-2 text-left">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="size-4" aria-hidden="true" />
            </span>
            <DialogTitle className="text-base font-semibold">
              {t("logout.title")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            {t("logout.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs text-muted-foreground leading-normal">
          <p>{t("logout.deleteHint")}</p>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => handleSelect("cancel")}
            data-testid="logout-cancel-button"
            className="w-full sm:w-auto h-8 text-xs order-3 sm:order-1"
          >
            {t("logout.cancel")}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => handleSelect("keep")}
            data-testid="logout-keep-button"
            className="w-full sm:w-auto h-8 text-xs order-2 sm:order-2"
          >
            {t("logout.keep")}
          </Button>

          <Button
            type="button"
            variant="default"
            size="sm"
            autoFocus
            disabled={loading}
            onClick={() => handleSelect("delete")}
            data-testid="logout-delete-button"
            className="w-full sm:w-auto h-8 text-xs font-medium order-1 sm:order-3"
          >
            {t("logout.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
