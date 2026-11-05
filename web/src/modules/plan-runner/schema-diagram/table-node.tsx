"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TableInfo } from "@/modules/data-lab/generate/plan-data";
import { CARD_W, HEAD_H, ROW_H } from "./layout";

export type TableData = { table: TableInfo; collapsed: boolean; narrow: boolean; missing: string[] } & Record<string, unknown>;
export type TableNode = Node<TableData, "table">;

const handle = "!size-2 !border-0 !bg-dim";

// Mọi chữ dùng text node của React nên tên bảng chứa HTML hiện thành chữ. Chữ không co, cắt bằng dấu ba chấm kèm title (Y1).
export function TableCard({ data, selected }: NodeProps<TableNode>) {
  const t = useTranslations("schema-diagram");
  const { table, collapsed, narrow, missing } = data;
  // Một cột: cả hai đầu nối ở mép trái, đường nối đi vòng ngoài mép thẻ thay vì cắt qua chữ của thẻ khác.
  const out = narrow ? Position.Left : Position.Right;
  return (
    <Card size="sm" className={`gap-0 overflow-visible py-0 ${selected ? "ring-2 ring-lamp" : ""}`} style={{ width: CARD_W }}>
      <div className="relative flex items-center gap-2 border-b border-rule px-3" style={{ height: HEAD_H }}>
        {collapsed && (
          <>
            <Handle id="t" type="target" position={Position.Left} className={handle} />
            <Handle id="t" type="source" position={out} className={handle} />
          </>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium" title={table.name}>{table.name}</span>
        <span className="shrink-0 text-xs text-dim">{t("columnCount", { count: table.columns.length })}</span>
      </div>
      {!collapsed && (
        <ul className="py-1">
          {table.columns.map((c) => (
            <li key={c.name} className="relative flex items-center gap-2 px-3 text-xs" style={{ height: ROW_H }}>
              <Handle id={c.name} type="target" position={Position.Left} className={handle} />
              <Handle id={c.name} type="source" position={out} className={handle} />
              <span className="min-w-0 flex-1 truncate font-mono" title={c.name}>{c.name}</span>
              <span className="max-w-[88px] shrink-0 truncate text-dim" title={c.type}>{c.type}</span>
              {c.isPrimaryKey && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]" title={t("pk")}>PK</Badge>}
              {c.references && (
                <Badge
                  variant="outline"
                  className="h-4 shrink-0 px-1 text-[10px]"
                  title={t(missing.includes(c.name) ? "fkMissing" : "fkTo", { table: c.references.table, column: c.references.column })}
                >
                  FK
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
