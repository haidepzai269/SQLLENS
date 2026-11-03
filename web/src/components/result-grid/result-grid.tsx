"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { QueryResult } from "@/contracts/engine";
import { formatCell } from "./format-cell";

export const MAX_ROWS = 500;

function One({ result, index, open, onToggle }: { result: QueryResult; index: number; open: boolean; onToggle: () => void }) {
  const t = useTranslations("result");
  const { columns, rows, affectedRows } = result;
  const shown = rows.slice(0, MAX_ROWS);
  const id = `result-${index}`;
  return (
    <section className="border-b border-border last:border-b-0">
      <h3 className="m-0">
        <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={id} onClick={onToggle} className="w-full justify-start">
          {t("statement", { n: index + 1 })}
        </Button>
      </h3>
      <div id={id} hidden={!open} className="max-w-full px-2 pb-2">
        {columns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {affectedRows === undefined ? t("noRows") : t("affected", { count: affectedRows })}
          </p>
        ) : (
          <>
            {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c, i) => (
                    <TableHead key={i} className="font-mono">{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r, i) => (
                  <TableRow key={i}>
                    {columns.map((_, j) => {
                      const { text, kind } = formatCell(r[j]);
                      return (
                        <TableCell key={j} data-kind={kind} className={kind === "null" ? "italic text-muted-foreground" : kind === "number" ? "text-right font-mono" : "font-mono"}>
                          {text}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {rows.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("total", { count: rows.length })}
                {affectedRows !== undefined && ` ${t("affected", { count: affectedRows })}.`}
                {rows.length > MAX_ROWS && ` ${t("truncated", { max: MAX_ROWS })}`}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const collapsedBefore = (results: QueryResult[]) => new Set(results.slice(0, -1).keys());

export function ResultGrid({ results }: { results: QueryResult[] }) {
  const [closed, setClosed] = useState<Set<number>>(() => collapsedBefore(results));
  const [prev, setPrev] = useState(results);
  if (prev !== results) { // kết quả mới: câu cuối mở, các câu trước thu gọn
    setPrev(results);
    setClosed(collapsedBefore(results));
  }
  return (
    <div className="max-w-full">
      {results.map((r, i) => (
        <One
          key={i}
          result={r}
          index={i}
          open={!closed.has(i)}
          onToggle={() => setClosed((s) => { const n = new Set(s); if (!n.delete(i)) n.add(i); return n; })}
        />
      ))}
    </div>
  );
}
