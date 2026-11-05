"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { TableInfo } from "@/modules/data-lab/generate/plan-data";

// React Flow và dagre chỉ tải khi màn hình có sơ đồ.
export const SchemaDiagram = dynamic<{ tables: TableInfo[]; focus?: { table: string; nonce: number } }>(() => import("./schema-diagram-impl"), {
  ssr: false,
  loading: () => <Skeleton className="h-[60vh] min-h-72 w-full" aria-hidden />,
});
