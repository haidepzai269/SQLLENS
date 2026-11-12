"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { splitSqlStatements } from "@/components/sql-editor/statement-at-cursor";
import type { QueryResult } from "@/contracts/engine";
import { cn } from "@/lib/utils";
import { formatCell } from "./format-cell";

export const MAX_ROWS = 500;

export type StatementKind = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "INDEX" | "DDL";

export function classifyStatement(sql: string, result?: QueryResult): StatementKind {
  let clean = sql.trim();
  while (clean.startsWith("--") || clean.startsWith("/*") || clean.startsWith("#")) {
    if (clean.startsWith("--") || clean.startsWith("#")) {
      const nl = clean.indexOf("\n");
      clean = nl >= 0 ? clean.slice(nl + 1).trim() : "";
    } else if (clean.startsWith("/*")) {
      const end = clean.indexOf("*/");
      clean = end >= 0 ? clean.slice(end + 2).trim() : "";
    }
  }

  const upper = clean.toUpperCase();
  if (/^(CREATE\s+(UNIQUE\s+)?INDEX|DROP\s+INDEX|REINDEX)\b/.test(upper)) return "INDEX";
  if (/^(CREATE|ALTER|DROP|TRUNCATE)\b/.test(upper)) return "DDL";
  if (/^INSERT\b/.test(upper)) return "INSERT";
  if (/^UPDATE\b/.test(upper)) return "UPDATE";
  if (/^DELETE\b/.test(upper)) return "DELETE";
  if (/^(SELECT|WITH|TABLE|VALUES|EXPLAIN)\b/.test(upper)) return "SELECT";

  if (result) {
    if (result.columns.length > 0) return "SELECT";
    if (result.affectedRows !== undefined && result.affectedRows > 0) return "INSERT";
    return "DDL";
  }
  return "SELECT";
}

function badgeStyle(kind: StatementKind): string {
  switch (kind) {
    case "SELECT":
      return "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400";
    case "INSERT":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "UPDATE":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "DELETE":
      return "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400";
    case "INDEX":
      return "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400";
    case "DDL":
      return "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function One({
  result,
  index,
  open,
  onToggle,
  rawStatement,
}: {
  result: QueryResult;
  index: number;
  open: boolean;
  onToggle: () => void;
  rawStatement?: string;
}) {
  const t = useTranslations("result");
  const { columns, rows, affectedRows } = result;
  const shown = rows.slice(0, MAX_ROWS);
  const id = `result-${index}`;

  const kind = classifyStatement(rawStatement ?? "", result);
  const snippet = rawStatement ? rawStatement.replace(/\s+/g, " ").trim() : "";

  const statusText =
    columns.length > 0
      ? rows.length === 0
        ? t("zeroRows")
        : t("headerReturned", { count: rows.length })
      : affectedRows !== undefined
        ? t("headerAffected", { count: affectedRows })
        : t("headerSuccess");

  const affectedNote = affectedRows !== undefined ? `${t("affected", { count: affectedRows })}.` : undefined;

  return (
    <section className="border-b border-border/80 last:border-b-0">
      <h3 className="m-0">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={id}
          aria-label={t("statement", { n: index + 1 })}
          onClick={onToggle}
          className="group h-auto w-full justify-between gap-2 rounded-none px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
            )}
            <span className="font-semibold text-xs text-foreground tracking-tight whitespace-nowrap">
              {t("statement", { n: index + 1 })}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-mono font-medium border uppercase tracking-wider",
                badgeStyle(kind),
              )}
            >
              {kind}
            </span>
            {snippet && (
              <span
                className="hidden truncate font-mono text-xs text-muted-foreground/80 sm:inline-block max-w-[200px] md:max-w-md lg:max-w-lg"
                title={snippet}
              >
                {snippet}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-xs">
            <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">{statusText}</span>
          </div>
        </Button>
      </h3>
      <div id={id} hidden={!open} className="max-w-full px-3 pb-3 pt-1">
        {columns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {affectedRows === undefined ? t("noRows") : t("affected", { count: affectedRows })}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-border bg-background shadow-2xs">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border bg-muted/40 hover:bg-muted/40">
                    <th
                      scope="col"
                      className="h-8 w-12 px-2 text-center align-middle font-mono text-[11px] font-semibold text-muted-foreground select-none border-r border-border/50"
                    >
                      {t("rowNumber")}
                    </th>
                    {columns.map((c, i) => (
                      <TableHead
                        key={i}
                        className="h-8 px-3 font-mono text-xs font-semibold text-foreground border-r border-border/50 last:border-r-0"
                      >
                        {c}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r, i) => (
                    <TableRow key={i} className="border-b border-border/50 last:border-b-0 hover:bg-muted/20">
                      <th
                        scope="row"
                        className="w-12 px-2 py-1.5 text-center font-mono text-xs font-normal text-muted-foreground/70 select-none bg-muted/10 border-r border-border/50"
                      >
                        {i + 1}
                      </th>
                      {columns.map((_, j) => {
                        const { text, kind: cellKind } = formatCell(r[j]);
                        return (
                          <TableCell
                            key={j}
                            data-kind={cellKind}
                            className={cn(
                              "px-3 py-1.5 border-r border-border/50 last:border-r-0 font-mono text-xs",
                              cellKind === "null" && "italic text-muted-foreground/60 text-left",
                              cellKind === "number" && "text-right",
                              cellKind !== "null" && cellKind !== "number" && "text-left",
                            )}
                          >
                            {text}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {rows.length === 0 && <p className="mt-2 text-xs italic text-muted-foreground">{t("empty")}</p>}
            {rows.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t("total", { count: rows.length })}</span>
                {affectedNote && <span>{affectedNote}</span>}
                {rows.length > MAX_ROWS && (
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {t("truncated", { max: MAX_ROWS })}
                  </span>
                )}
                {result.truncated && (
                  <span className="font-medium text-amber-600 dark:text-amber-400">{t("cutByServer")}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const collapsedBefore = (results: QueryResult[]) => new Set(results.slice(0, -1).keys());

export function ResultGrid({
  results,
  rawSql,
  allOpen,
}: {
  results: QueryResult[];
  rawSql?: string;
  allOpen?: boolean | null;
}) {
  const [closed, setClosed] = useState<Set<number>>(() =>
    allOpen === false ? new Set(results.map((_, i) => i)) : allOpen === true ? new Set() : collapsedBefore(results),
  );
  const [prev, setPrev] = useState(results);
  const [prevAllOpen, setPrevAllOpen] = useState(allOpen);

  if (prev !== results) {
    // kết quả mới: câu cuối mở, các câu trước thu gọn
    setPrev(results);
    setClosed(collapsedBefore(results));
  }

  if (prevAllOpen !== allOpen && allOpen !== null && allOpen !== undefined) {
    setPrevAllOpen(allOpen);
    if (allOpen) {
      setClosed(new Set());
    } else {
      setClosed(new Set(results.map((_, i) => i)));
    }
  }

  const spans = useMemo(() => (rawSql ? splitSqlStatements(rawSql) : []), [rawSql]);

  return (
    <div className="max-w-full rounded-md border border-border/80 bg-background overflow-hidden">
      {results.map((r, i) => (
        <One
          key={i}
          result={r}
          index={i}
          open={!closed.has(i)}
          onToggle={() =>
            setClosed((s) => {
              const n = new Set(s);
              if (!n.delete(i)) n.add(i);
              return n;
            })
          }
          rawStatement={spans[i]?.text}
        />
      ))}
    </div>
  );
}
