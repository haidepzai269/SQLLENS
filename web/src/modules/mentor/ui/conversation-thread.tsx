"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConclusionBadge } from "@/components/ui/conclusion-badge";
import type { TryChangeResult } from "@/contracts/engine";
import type { Plan, PlanNode } from "@/contracts/plan";
import type { VerifiedAnswer } from "../verify";
import { splitAnswer } from "../verify/split";

export type Kind = "auth" | "limit" | "unavailable" | "badRequest" | "network" | "interrupted" | "stream" | "tooLong";
export type Fail = { kind: Kind; key?: string; waitSeconds?: number };
export type Phase = "sending" | "streaming" | "verifying" | "done" | "stopped" | "failed";
export type Check = { unknownNumbers: string[]; bannedClaims: string[] };

export type Turn = {
  id: number;
  question: string;
  text: string;
  phase: Phase;
  fail?: Fail;
  verified?: VerifiedAnswer;
  verifyFailed?: boolean;
  check?: Check;
  rebuildFailed?: boolean;
  timestamp?: number;
};

export type Applied = { n: number; change?: string; probe: string };
export type Tr = (key: string, values?: Record<string, string | number>) => string;

export const BUSY = new Set<Phase>(["sending", "streaming", "verifying"]);
const sumPages = (n: PlanNode): number => (n.pagesRead ?? 0) + n.children.reduce((a, c) => a + sumPages(c), 0);
const blocks = (s: { sharedHitBlocks: number; sharedReadBlocks: number }) => s.sharedHitBlocks + s.sharedReadBlocks;

/**
 * Tóm tắt ngắn gọn (1-2 câu, < 300 ký tự) từ các lượt trước
 * để AI Mentor hiểu các đại từ thay thế ("nó", "bảng này", "cột đó").
 */
export function buildContextSummary(turns: Turn[]): string | undefined {
  if (turns.length === 0) return undefined;
  const validTurns = turns.filter((t) => t.text && t.text.trim() !== "");
  if (validTurns.length === 0) return undefined;

  // Lấy turn hợp lệ gần nhất
  const last = validTurns[validTurns.length - 1];
  const qClean = last.question.replace(/\s+/g, " ").trim();
  const qSummary = qClean.length > 120 ? qClean.slice(0, 117) + "..." : qClean;

  const aClean = last.text
    .replace(/```[\s\S]*?```/g, "[SQL proposal]")
    .replace(/\s+/g, " ")
    .trim();
  const aSummary = aClean.length > 150 ? aClean.slice(0, 147) + "..." : aClean;

  return `User asked: "${qSummary}". AI answered: "${aSummary}".`;
}

export function FailView({ fail, onLogin }: { fail: Fail; onLogin: () => void }) {
  const t = useTranslations("mentor");
  const te = useTranslations("error");
  return (
    <Alert variant="destructive" data-testid="mentor-error" data-kind={fail.kind}>
      <AlertTitle>{t(`err.${fail.kind}`)}</AlertTitle>
      <AlertDescription>
        {fail.key && fail.kind !== "interrupted" && <span>{te(fail.key)} </span>}
        {fail.waitSeconds !== undefined && <span data-testid="mentor-retry">{t("retryAfter", { seconds: fail.waitSeconds })} </span>}
        {fail.kind === "auth" && (
          <Button size="sm" variant="outline" onClick={onLogin} data-testid="mentor-login">{t("signIn")}</Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

// Nội dung AI luôn là text node: không dangerouslySetInnerHTML, không Markdown, không thẻ a.
export function Parts({ turn, tr, probe, onApply }: { turn: Turn; tr: Tr; probe?: string; onApply: (a: Applied) => void }) {
  const t = useTranslations("mentor");
  const counter = useRef(0);
  const waiting = BUSY.has(turn.phase);
  const parts = turn.verified?.parts ?? splitAnswer(turn.text).map((p) => (p.kind === "text" ? p : ({ kind: "pending" } as const)));
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "text") {
          return p.text.trim() ? (
            <p key={i} className="m-0 min-w-0 whitespace-pre-wrap break-words text-sm" data-testid="mentor-text">{p.text}</p>
          ) : null;
        }
        if (p.kind === "hidden") {
          return <p key={i} className="m-0 text-xs text-ink2" data-testid="mentor-sql-hidden">{tr(p.reasonKey)}</p>;
        }
        if (p.kind === "pending") {
          return (
            <p key={i} className="m-0 text-xs text-dim" data-testid="mentor-sql-pending">
              {waiting ? t("sqlPending") : turn.verifyFailed ? t("verifyFailed") : t("sqlUnchecked")}
            </p>
          );
        }
        const { outcome } = p;
        const isPlan = "root" in outcome.data;
        let pages: string | null = null;
        if (isPlan) {
          const plan = outcome.data as Plan;
          if (plan.analyzed) pages = t("pages", { pages: sumPages(plan.root) });
        } else {
          const r = outcome.data as TryChangeResult;
          pages = t("pagesChange", { before: blocks(r.before), after: blocks(r.after) });
        }
        const applyProbe = isPlan ? p.sql : probe;
        return (
          <div key={i} className="flex min-w-0 flex-col gap-1 border border-line p-2" data-testid="mentor-sql-ok">
            <div className="flex flex-wrap items-center gap-2">
              <ConclusionBadge label={outcome.label} testId="mentor-label" />
              <span className="text-xs text-ink2">{t("ranHere")}</span>
            </div>
            <pre className="m-0 max-w-full overflow-x-auto text-sm"><code className="font-mono">{p.sql}</code></pre>
            {pages && <p className="m-0 text-xs text-ink2" data-testid="mentor-pages">{pages}</p>}
            {applyProbe && (
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                data-testid="mentor-apply"
                onClick={() => onApply({ n: ++counter.current, probe: applyProbe, change: isPlan ? undefined : p.sql })}
              >
                {t("apply")}
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
}

export function ConversationTurnItem({
  turn,
  index,
  total,
  tr,
  probe,
  onApply,
  onLogin,
}: {
  turn: Turn;
  index: number;
  total: number;
  tr: Tr;
  probe?: string;
  onApply: (a: Applied) => void;
  onLogin: () => void;
}) {
  const t = useTranslations("mentor");
  const busy = BUSY.has(turn.phase);
  const incomplete = turn.phase === "stopped" || turn.phase === "failed";

  return (
    <article
      className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3 transition-colors"
      data-testid="mentor-turn"
      data-turn-id={turn.id}
      data-phase={turn.phase}
      aria-label={t("turnHeader", { index: index + 1 })}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
        <span className="text-xs font-semibold text-ink2" data-testid="mentor-turn-header">
          {t("turnHeader", { index: index + 1 })}
        </span>
        <span className="text-xs text-dim">
          {t("turnCount", { current: index + 1, max: total })}
        </span>
      </div>

      <div className="min-w-0">
        <p className="m-0 text-xs text-dim">{t("asked")}</p>
        <p className="m-0 min-w-0 whitespace-pre-wrap break-words text-sm font-medium" data-testid="mentor-asked">
          {turn.question}
        </p>
      </div>

      <p role="status" className="m-0 text-xs text-dim" data-testid="mentor-status">
        {busy ? t(`phase.${turn.phase}`) : ""}
      </p>

      {turn.fail && <FailView fail={turn.fail} onLogin={onLogin} />}

      {turn.phase === "stopped" && (
        <Alert data-testid="mentor-stopped">
          <AlertDescription>{t("stopped")}</AlertDescription>
        </Alert>
      )}

      {turn.rebuildFailed && (
        <Alert variant="destructive" data-testid="mentor-rebuild-failed">
          <AlertDescription>{t("rebuildFailed")}</AlertDescription>
        </Alert>
      )}

      {incomplete && turn.text && (
        <Alert data-testid="mentor-incomplete">
          <AlertDescription>{t("incomplete")}</AlertDescription>
        </Alert>
      )}

      {turn.check && turn.check.unknownNumbers.length > 0 && (
        <Alert variant="destructive" data-testid="mentor-unknown-numbers">
          <AlertTitle>{t("warn.unknownTitle")}</AlertTitle>
          <AlertDescription>{t("warn.unknownBody", { numbers: turn.check.unknownNumbers.join(", ") })}</AlertDescription>
        </Alert>
      )}

      {turn.check && turn.check.bannedClaims.length > 0 && (
        <Alert variant="destructive" data-testid="mentor-banned">
          <AlertTitle>{t("warn.bannedTitle")}</AlertTitle>
          <AlertDescription>
            {t("warn.bannedBody")}{" "}
            {turn.check.bannedClaims.map((c, i) => (
              <q key={i} className="mr-1">{c}</q>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {(turn.text || turn.phase === "done") && (
        <div
          className="flex min-w-0 flex-col gap-2"
          data-testid="mentor-answer"
          role="region"
          aria-live="polite"
          aria-busy={busy}
          aria-label={t("answerLabel")}
        >
          <span className="w-fit rounded-[2px] border border-line px-[7px] text-xs text-ink2" data-testid="mentor-ai-tag">
            {t("aiTag")}
          </span>
          {turn.phase === "done" && !turn.text.trim() && (
            <p className="m-0 text-sm text-dim" data-testid="mentor-empty-answer">
              {t("emptyAnswer")}
            </p>
          )}
          <Parts turn={turn} tr={tr} probe={probe} onApply={onApply} />
          {turn.verified && turn.verified.hiddenCount > 0 && (
            <p className="m-0 text-xs text-dim" data-testid="mentor-hidden-count">
              {t("hiddenCount", { count: turn.verified.hiddenCount })}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

export function ConversationThread({
  turns,
  maxTurns,
  tr,
  probe,
  onApply,
  onLogin,
}: {
  turns: Turn[];
  maxTurns: number;
  tr: Tr;
  probe?: string;
  onApply: (a: Applied) => void;
  onLogin: () => void;
}) {
  const t = useTranslations("mentor");

  if (turns.length === 0) {
    return <p className="m-0 text-sm text-dim" data-testid="mentor-empty">{t("empty")}</p>;
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      role="feed"
      aria-label={t("region")}
      data-testid="mentor-thread"
    >
      {turns.map((turn, index) => (
        <ConversationTurnItem
          key={turn.id}
          turn={turn}
          index={index}
          total={maxTurns}
          tr={tr}
          probe={probe}
          onApply={onApply}
          onLogin={onLogin}
        />
      ))}
    </div>
  );
}
