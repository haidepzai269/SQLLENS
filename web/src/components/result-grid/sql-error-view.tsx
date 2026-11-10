"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FileCode,
  Lightbulb,
  RotateCcw,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  matchPostgresError,
  matchMysqlError,
  type ErrorRemediation,
  type QuickFixAction,
} from "@/modules/error-remediation";

/** position là vị trí 1-based theo ký tự, như PostgreSQL báo. Trả null nếu nằm ngoài sql. */
export function locateError(sql: string, position: number) {
  const chars = Array.from(sql);
  if (!Number.isInteger(position) || position < 1 || position > chars.length) return null;
  const before = chars.slice(0, position - 1);
  const lineStart = before.lastIndexOf("\n") + 1;
  let lineEnd = chars.indexOf("\n", position - 1);
  if (lineEnd < 0) lineEnd = chars.length;
  let tokenEnd = position - 1;
  while (tokenEnd < lineEnd && !/\s/.test(chars[tokenEnd])) tokenEnd++;
  if (tokenEnd === position - 1 && tokenEnd < lineEnd) tokenEnd++; // rơi vào khoảng trắng: chỉ một ký tự
  return {
    lineNo: before.filter((c) => c === "\n").length + 1,
    col: position - lineStart,
    pre: chars.slice(lineStart, position - 1).join(""),
    token: chars.slice(position - 1, tokenEnd).join(""),
    post: chars.slice(tokenEnd, lineEnd).join(""),
  };
}

export interface SqlErrorViewProps {
  message: string;
  position?: number;
  sql: string;
  title?: string;
  engine?: "postgres" | "mysql";
  onApplyFix?: (newSql: string) => void;
  onRebuild?: () => void;
  onAskAi?: (remediation: ErrorRemediation) => void;
}

export function SqlErrorView({
  message,
  position,
  sql,
  title,
  engine = "postgres",
  onApplyFix,
  onRebuild,
  onAskAi,
}: SqlErrorViewProps) {
  const tResult = useTranslations("result");
  const tRemediation = useTranslations("error-remediation");
  type RemediationKey = Parameters<typeof tRemediation>[0];

  const [viewMode, setViewMode] = useState<"raw" | "explanation">("raw");

  const loc = position === undefined ? null : locateError(sql, position);

  const remediation = useMemo<ErrorRemediation>(() => {
    return engine === "mysql"
      ? matchMysqlError(message, sql, position)
      : matchPostgresError(message, sql, position);
  }, [engine, message, sql, position]);

  const handleAction = (action: QuickFixAction) => {
    if (action.type === "replace_stmt") {
      onApplyFix?.(sql.replace(action.targetSql, action.replacementSql));
    } else if (action.type === "prepend_stmt") {
      onApplyFix?.(action.sqlToPrepend + sql);
    } else if (action.type === "rebuild_sandbox") {
      onRebuild?.();
    }
  };

  const defaultTitle = title ?? tResult("error.title");

  return (
    <Alert variant="destructive" role="alert" className="border-destructive/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/20 pb-2">
        <AlertTitle className="text-base font-semibold leading-none text-destructive">
          {defaultTitle}
        </AlertTitle>
        <div
          role="tablist"
          aria-label="Error View Mode"
          className="flex items-center gap-1 rounded-md bg-muted/60 p-0.5 text-xs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "raw"}
            onClick={() => setViewMode("raw")}
            className={cn(
              "px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer",
              viewMode === "raw"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tRemediation("ui.tab_raw")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "explanation"}
            onClick={() => setViewMode("explanation")}
            className={cn(
              "px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer",
              viewMode === "explanation"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tRemediation("ui.tab_explanation")}
          </button>
        </div>
      </div>

      <AlertDescription className="mt-3">
        {viewMode === "raw" ? (
          <div
            data-testid="raw-error-console"
            className="rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 dark:bg-black"
          >
            <div className="flex items-center gap-1.5 text-zinc-400 mb-2 border-b border-zinc-800/80 pb-1.5 text-[11px]">
              <Terminal className="h-3.5 w-3.5" />
              <span>{tRemediation("ui.console_title")}</span>
            </div>
            <p className="whitespace-pre-wrap break-words leading-relaxed">{message}</p>
            {loc && (
              <div className="mt-3 border-t border-zinc-800 pt-2.5">
                <p className="text-red-400 font-semibold mb-1">
                  {tResult("error.at", { line: loc.lineNo, column: loc.col })}
                </p>
                <pre className="overflow-x-auto text-zinc-300">
                  {loc.pre}
                  <mark className="bg-red-500/30 text-red-200 underline decoration-wavy decoration-red-500 font-semibold px-0.5 rounded-xs">
                    {loc.token}
                  </mark>
                  {loc.post}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div
            data-testid="error-explanation"
            className="space-y-3 rounded-md border border-border/60 bg-background/50 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              {remediation.code !== "UNKNOWN" && (
                <Badge variant="outline" className="font-mono text-xs font-semibold">
                  {engine === "mysql" ? `MySQL ${remediation.code}` : `PG ${remediation.code}`}
                </Badge>
              )}
              <Badge variant="secondary" className="text-xs">
                {tRemediation(`ui.category.${remediation.category}` as RemediationKey)}
              </Badge>
              <h4 className="font-semibold text-sm text-foreground">
                {tRemediation(remediation.titleKey.replace(/^error-remediation\./, "") as RemediationKey)}
              </h4>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {tRemediation(
                remediation.explanationKey.replace(/^error-remediation\./, "") as RemediationKey,
                remediation.explanationParams,
              )}
            </p>
            {remediation.rootCauseHintKey && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200">
                <Lightbulb className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                <div>
                  <span className="font-semibold">{tRemediation("ui.root_cause_label")} </span>
                  <span>
                    {tRemediation(
                      remediation.rootCauseHintKey.replace(/^error-remediation\./, "") as RemediationKey,
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Khối Quick-Fix 1-Click & AI Mentor */}
        <div data-testid="quick-fix-panel" className="mt-3 border-t border-border/40 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Wrench className="h-3.5 w-3.5 text-primary" />
              <span>{tRemediation("ui.quick_fix_title")}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="ask-ai-button"
              className="h-7 gap-1 text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300"
              onClick={() => onAskAi?.(remediation)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {tRemediation("ui.ask_ai")}
            </Button>
          </div>
          {remediation.actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {remediation.actions.map((act, idx) => (
                <Button
                  key={idx}
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-testid={`quick-fix-action-${act.type}`}
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => handleAction(act)}
                >
                  {act.type === "replace_stmt" && <Wrench className="h-3 w-3 text-muted-foreground" />}
                  {act.type === "prepend_stmt" && <FileCode className="h-3 w-3 text-muted-foreground" />}
                  {act.type === "rebuild_sandbox" && <RotateCcw className="h-3 w-3 text-muted-foreground" />}
                  <span>{tRemediation(act.labelKey.replace(/^error-remediation\./, "") as RemediationKey)}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

export const SmartErrorCard = SqlErrorView;
