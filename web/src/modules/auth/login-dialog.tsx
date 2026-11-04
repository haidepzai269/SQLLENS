"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { currentNext } from "./api";
import { useAuth } from "./auth-provider";
import { stashSql, storageWorks } from "./sql-stash";

const PROVIDERS = ["google", "github"] as const;

export function LoginDialog({ open, reason, onClose }: { open: boolean; reason: "mysql" | "manual"; onClose: () => void }) {
  const t = useTranslations("auth");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <Body t={t} reason={reason} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

// Chỉ mount khi hộp thoại mở, nên được đọc window và sessionStorage ở đây.
function Body({ t, reason, onClose }: { t: ReturnType<typeof useTranslations>; reason: "mysql" | "manual"; onClose: () => void }) {
  const { sqlRef } = useAuth();
  const [blocked, setBlocked] = useState(false); // sessionStorage chặn hoặc SQL quá lớn để lưu
  useEffect(() => {
    if (sqlRef.current.trim() !== "" && !storageWorks()) setBlocked(true);
  }, [sqlRef]);
  const next = encodeURIComponent(currentNext());
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{reason === "mysql" ? t("reasonMysql") : t("reasonManual")}</DialogDescription>
      </DialogHeader>
      <p className="text-muted-foreground">{t("postgresFree")}</p>
      {blocked && (
        <Alert>
          <AlertDescription>{t("storageBlocked")}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        {PROVIDERS.map((p) => (
          <a
            key={p}
            href={`/api/auth/${p}/start?next=${next}`}
            onClick={(e) => {
              // Lưu lỗi (đầy, bị chặn): báo trước, bấm lần nữa mới đi để người dùng kịp sao chép SQL.
              if (!stashSql(sqlRef.current) && !blocked) {
                e.preventDefault();
                setBlocked(true);
              }
            }}
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            {t("continueWith", { provider: t(`providers.${p}`) })}
          </a>
        ))}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {reason === "mysql" ? t("cancelMysql") : t("cancel")}
        </Button>
      </DialogFooter>
    </>
  );
}
