"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { TableInfo } from "@/modules/data-lab/generate/plan-data";
import { SchemaDiagram } from "@/modules/plan-runner/schema-diagram/schema-diagram";

const col = (name: string, type = "integer", o: Partial<TableInfo["columns"][number]> = {}) => ({
  name, type, nullable: false, isPrimaryKey: false, isUnique: false, ...o,
});
const T = (name: string, columns: TableInfo["columns"]): TableInfo => ({ schema: "public", name, columns });
const ref = (table: string, column = "id") => ({ references: { table, column } });

const basic = (): TableInfo[] => [
  T("users", [col("id", "integer", { isPrimaryKey: true }), col("email", "text", { isUnique: true }), col("name", "character varying(80)", { nullable: true })]),
  T("orders", [col("id", "integer", { isPrimaryKey: true }), col("user_id", "integer", ref("users")), col("total", "numeric(10,2)")]),
  T("order_items", [col("id", "integer", { isPrimaryKey: true }), col("order_id", "integer", ref("orders")), col("sku", "text"), col("qty", "integer")]),
];
const many = (n: number): TableInfo[] =>
  Array.from({ length: n }, (_, i) => T(`t${i}`, [col("id", "integer", { isPrimaryKey: true }), col("v", "text"), ...(i > 0 ? [col("p", "integer", ref(`t${Math.floor((i - 1) / 2)}`))] : [])]));

const SCENARIOS: Record<string, () => TableInfo[]> = {
  basic,
  empty: () => [],
  edge: () => [
    T("nocols", []),
    T("tree", [col("id", "integer", { isPrimaryKey: true }), col("parent_id", "integer", ref("tree"))]),
    T("lonely", [col("ghost_id", "integer", ref("nope"))]),
  ],
  xss: () => [T("<img src=x onerror=alert(1)>", [col("<b>id</b>", "integer", { isPrimaryKey: true })]), ...basic().slice(0, 1)],
  many31: () => many(31),
  many120: () => many(120),
  long: () => [
    T("a_really_long_table_name_that_does_not_fit_in_a_card_at_all", [col("an_extremely_long_column_name_for_testing_truncation", "character varying(255)", { isPrimaryKey: true })]),
    T("b", [col("id")]),
  ],
};

// Kịch bản chọn bằng ?s=, đọc sau khi mount để trang vẫn prerender được.
export function Harness() {
  const scenario = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(location.search).get("s") ?? "basic",
    () => null,
  );
  const tables = useMemo(() => (SCENARIOS[scenario ?? ""] ?? basic)(), [scenario]);
  if (scenario === null) return null;
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-2 p-4">
      <SchemaDiagram tables={tables} />
    </main>
  );
}
