"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { readFailure, type Failure } from "./api";
import { useAuth } from "./auth-provider";

// Khớp quota.MySQLSession ở api/internal/quota/quota.go; Gin chưa trả hạn mức trong phản hồi.
const MYSQL_DAILY_LIMIT = 20;

type R = { kind: "idle" | "busy" | "ok" } | { kind: "fail"; f: Failure };

// Cổng thật của /mysql: gọi POST /api/mysql/ping (Gin kiểm đăng nhập, tần suất, quota). Phiên MySQL thật làm ở SP004.
export function MysqlAccess() {
  const t = useTranslations("auth.mysql");
  const te = useTranslations("error");
  const locale = useLocale();
  const { status, markAnon } = useAuth();
  const [r, setR] = useState<R>({ kind: "idle" });

  async function check() {
    setR({ kind: "busy" });
    try {
      const res = await fetch("/api/mysql/ping", { method: "POST", credentials: "same-origin" });
      if (res.status === 204) return setR({ kind: "ok" });
      const f = await readFailure(res);
      if (res.status === 401) markAnon(); // cookie hết hạn: cổng đăng nhập tự mở
      setR({ kind: "fail", f });
    } catch {
      setR({ kind: "fail", f: { status: 0, code: "network", key: "internal" } });
    }
  }

  if (status !== "user") return <p role="status">{t("needsLogin")}</p>;
  const f = r.kind === "fail" ? r.f : null;
  const when = f?.resetAt && new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(f.resetAt);
  return (
    <div className="flex flex-col items-start gap-2">
      <p>{t("ready")}</p>
      <Button variant="outline" onClick={check} disabled={r.kind === "busy"}>
        {r.kind === "busy" ? t("checking") : t("check")}
      </Button>
      <div role="status" className="w-full">
        {r.kind === "ok" && <p>{t("ok")}</p>}
        {f?.code === "quota_exceeded" && (
          <Alert variant="destructive" data-testid="quota-exceeded">
            <AlertTitle>{t("exceededTitle", { limit: MYSQL_DAILY_LIMIT })}</AlertTitle>
            <AlertDescription>
              {when ? t("resetAt", { when }) : t("resetUnknown")} {t("postgresStillWorks")}
            </AlertDescription>
          </Alert>
        )}
        {f?.code === "quota_unavailable" && (
          <Alert data-testid="quota-unavailable">
            <AlertTitle>{t("unavailableTitle")}</AlertTitle>
            <AlertDescription>
              {t("unavailableBody")} {t("postgresStillWorks")}
            </AlertDescription>
          </Alert>
        )}
        {f && f.code !== "quota_exceeded" && f.code !== "quota_unavailable" && f.status !== 401 && (
          <Alert variant="destructive">
            <AlertDescription>{te(f.key)}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
