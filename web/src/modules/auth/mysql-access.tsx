"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Failure } from "./api";
import { useAuth } from "./auth-provider";

// Cổng của /mysql: chưa đăng nhập thì chỉ nói cần đăng nhập. Phiên thật tạo ở lần Chạy đầu (engines/mysql/adapter.ts).
export function MysqlGate({ on, children }: { on: boolean; children: ReactNode }) {
  const t = useTranslations("auth.mysql");
  const { status } = useAuth();
  return !on || status === "user" ? <>{children}</> : <p role="status">{t("needsLogin")}</p>;
}

// Mã lỗi của Gin và agent (Task074) gom theo màn hình; lạ thì "generic". Khóa dịch: mysql.err.<kind>.
const KIND: Record<string, string> = {
  sandbox_full: "full",
  user_session_limit: "userLimit",
  quota_exceeded: "quota",
  mysql_time_exhausted: "timeBudget",
  rate_limited: "rate",
  session_expired: "expired",
  session_not_found: "expired",
  sandbox_unreachable: "unreachable",
  sandbox_bad_response: "unreachable",
  connection_lost: "unreachable",
  locks_failed: "unreachable",
  network: "unreachable",
  sandbox_timeout: "timeout",
  result_too_large: "tooLarge",
  not_configured: "notConfigured",
  quota_unavailable: "unavailable",
  disk_low: "unavailable",
  connection_busy: "busy",
  query_timeout: "queryTimeout",
  session_disk_quota: "diskQuota",
};
export const failureKind = (code: string) => KIND[code] ?? "generic";

type Props = {
  failure: Failure;
  /** Số câu đã chạy thành công trong phiên đã mất; chỉ dùng ở màn hình hết hạn. */
  historyCount: number;
  onRetry: () => void;
  onFresh: () => void;
  onReplay: () => void;
  onUsePostgres: () => void;
};

export function SandboxFailureView({ failure: f, historyCount, onRetry, onFresh, onReplay, onUsePostgres }: Props) {
  const t = useTranslations("mysql");
  const locale = useLocale();
  const kind = failureKind(f.code);
  const when = f.resetAt && new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(f.resetAt);
  const tr = useTranslations() as unknown as (key: string, values?: Record<string, string | number>) => string;
  // Hết chỗ, hết hạn mức, chưa cấu hình: chờ không giúp ngay, nên chỉ mời dùng PostgreSQL; còn lại cho thử lại.
  const retry = !["quota", "timeBudget", "notConfigured", "expired"].includes(kind);
  return (
    <Alert variant="destructive" data-testid="mysql-failure" data-kind={kind} role="alert">
      <AlertTitle>{tr(`mysql.err.${kind}.title`)}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <p>{tr(`mysql.err.${kind}.body`, { code: f.code })}</p>
        {when && ["quota", "timeBudget", "rate"].includes(kind) && <p>{t("err.resetAt", { when })}</p>}
        <div className="flex flex-wrap gap-2">
          {kind === "expired" && (
            <>
              <Button size="sm" onClick={onFresh}>{t("err.newEmpty")}</Button>
              {historyCount > 0 && <Button size="sm" variant="outline" onClick={onReplay}>{t("err.replay", { count: historyCount })}</Button>}
            </>
          )}
          {retry && <Button size="sm" variant="outline" onClick={onRetry}>{t("retry")}</Button>}
          <Button size="sm" variant="outline" onClick={onUsePostgres}>{t("usePostgres")}</Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
