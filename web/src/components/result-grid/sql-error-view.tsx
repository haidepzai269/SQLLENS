"use client";

import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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

export function SqlErrorView({ message, position, sql, title }: { message: string; position?: number; sql: string; title?: string }) {
  const t = useTranslations("result");
  const loc = position === undefined ? null : locateError(sql, position);
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>{title ?? t("error.title")}</AlertTitle>
      <AlertDescription>
        <p className="whitespace-pre-wrap break-words">{message}</p>
        {loc && (
          <div className="mt-2 max-w-full overflow-x-auto">
            <p className="text-xs">{t("error.at", { line: loc.lineNo, column: loc.col })}</p>
            <pre className="font-mono text-xs">
              {loc.pre}
              <mark className="bg-destructive/20 text-inherit underline decoration-wavy">{loc.token}</mark>
              {loc.post}
            </pre>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
