"use client";

import { useTranslations } from "next-intl";
import type { ParsedStatement } from "@/modules/sql-intake/parser";

const MAX_ROWS = 200; // dump lớn có hàng chục nghìn câu: chỉ vẽ đầu danh sách, phần còn lại gom thành một dòng

type Props = { sql: string; statements: ParsedStatement[]; selected: number; onSelect: (i: number) => void };

export function StatementList({ sql, statements, selected, onSelect }: Props) {
  const t = useTranslations("lab");
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{t("statements.title", { n: statements.length })}</p>
      <ol aria-label={t("statements.title", { n: statements.length })} className="m-0 flex list-none flex-col p-0">
        {statements.slice(0, MAX_ROWS).map((s) => (
          <li key={s.index}>
            <button
              type="button"
              aria-current={s.index === selected ? "true" : undefined}
              onClick={() => onSelect(s.index)}
              className="flex w-full min-w-0 items-baseline gap-2 border-l-2 border-transparent px-2 py-1 text-left text-sm hover:bg-raised aria-[current=true]:border-lamp aria-[current=true]:bg-raised"
            >
              <span className="flex-none text-dim">{t("statements.item", { n: s.index + 1 })}</span>
              <span className="flex-none font-medium">{t(`kind.${s.kind}`)}</span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {sql.slice(s.start, s.end).replace(/\s+/g, " ")}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {statements.length > MAX_ROWS && (
        <p className="text-xs text-muted-foreground">{t("statements.more", { n: statements.length - MAX_ROWS })}</p>
      )}
    </div>
  );
}
