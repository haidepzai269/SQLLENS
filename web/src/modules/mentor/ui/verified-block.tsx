"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConclusionBadge } from "@/components/ui/conclusion-badge";
import type { TryChangeResult } from "@/contracts/engine";
import type { Plan, PlanNode } from "@/contracts/plan";
import type { VerifiedPart } from "../verify";
import type { Tr } from "./conversation-thread";

export interface VerifiedBlockProps {
  part: VerifiedPart | { kind: "pending" };
  probe?: string;
  onApply?: (applied: { probe: string; change?: string }) => void;
  tr: Tr;
  pendingText?: string;
}

const sumPages = (n: PlanNode): number => (n.pagesRead ?? 0) + n.children.reduce((a, c) => a + sumPages(c), 0);
const blocks = (s: { sharedHitBlocks: number; sharedReadBlocks: number }) => s.sharedHitBlocks + s.sharedReadBlocks;

export function VerifiedBlock({ part, probe, onApply, tr, pendingText }: VerifiedBlockProps) {
  const t = useTranslations("mentor");

  if (part.kind === "text") {
    if (!part.text.trim()) return null;
    return (
      <p className="m-0 min-w-0 whitespace-pre-wrap break-words text-sm" data-testid="mentor-text">
        {part.text}
      </p>
    );
  }

  if (part.kind === "hidden") {
    return (
      <p className="m-0 text-xs text-ink2" data-testid="mentor-sql-hidden">
        {tr(part.reasonKey)}
      </p>
    );
  }

  if (part.kind === "pending") {
    return (
      <p className="m-0 text-xs text-dim" data-testid="mentor-sql-pending">
        {pendingText || t("sqlPending")}
      </p>
    );
  }

  if (part.kind === "unverified") {
    const reasonKey = part.reasonKey.startsWith("mentorVerify.") ? part.reasonKey : `mentorVerify.${part.reasonKey}`;
    const reasonText = tr(reasonKey);
    const badgeText = tr("mentorVerify.unverifiedBadge", { reason: reasonText });

    return (
      <div
        className="flex min-w-0 flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3"
        data-testid="mentor-sql-unverified"
      >
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span
            className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200"
            data-testid="mentor-unverified-badge"
          >
            {badgeText}
          </span>
        </div>
        <pre className="m-0 max-w-full overflow-x-auto rounded bg-surface/60 p-2 text-sm">
          <code className="font-mono text-ink2">{part.sql}</code>
        </pre>
      </div>
    );
  }

  // part.kind === "sql"
  const { outcome } = part;
  const isPlan = "root" in outcome.data;
  let pages: string | null = null;
  if (isPlan) {
    const plan = outcome.data as Plan;
    if (plan.analyzed) pages = t("pages", { pages: sumPages(plan.root) });
  } else {
    const r = outcome.data as TryChangeResult;
    pages = t("pagesChange", { before: blocks(r.before), after: blocks(r.after) });
  }
  const applyProbe = isPlan ? part.sql : probe;

  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3"
      data-testid="mentor-sql-ok"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ConclusionBadge label={outcome.label} testId="mentor-label" />
        <span className="text-xs text-ink2">{t("ranHere")}</span>
      </div>
      <pre className="m-0 max-w-full overflow-x-auto rounded bg-surface/60 p-2 text-sm">
        <code className="font-mono">{part.sql}</code>
      </pre>
      {pages && (
        <p className="m-0 text-xs text-ink2" data-testid="mentor-pages">
          {pages}
        </p>
      )}
      {applyProbe && onApply && (
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          data-testid="mentor-apply"
          onClick={() => {
            onApply({ probe: applyProbe, change: isPlan ? undefined : part.sql });
          }}
        >
          {t("apply")}
        </Button>
      )}
    </div>
  );
}
