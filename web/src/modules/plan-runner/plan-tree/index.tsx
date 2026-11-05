"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { EvidenceLabel } from "@/contracts/conclusion";
import type { Plan } from "@/contracts/plan";

function Loading() {
  return <p className="text-xs text-dim">{useTranslations("plan-tree")("loading")}</p>;
}

// React Flow và dagre chỉ tải khi màn hình có cây plan.
const Flow = dynamic(() => import("./plan-tree-flow"), { ssr: false, loading: Loading });

export function PlanTree({ plan, label, openNode }: { plan: Plan; label: EvidenceLabel; openNode?: { id: string; nonce: number } }) {
  return <Flow plan={plan} label={label} openNode={openNode} />;
}
