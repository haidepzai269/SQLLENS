"use client";

import { useTranslations } from "next-intl";
import type { EvidenceLabel } from "@/contracts/conclusion";

export interface BTreeRaceProps {
  idxPages?: number;
  seqPages?: number;
  idxRows?: number;
  seqRows?: number;
  noIndex?: boolean;
  label: EvidenceLabel | "sim" | "est";
  className?: string;
}

function normalizeLabel(l: EvidenceLabel | "sim" | "est"): EvidenceLabel {
  if (l === "sim") return "simulated";
  if (l === "est") return "estimated";
  return l;
}

function Badge({ label }: { label: EvidenceLabel }) {
  const t = useTranslations("btree");
  const cls =
    label === "real"
      ? "bg-label-real text-label-real-foreground"
      : label === "simulated"
        ? "border border-label-simulated text-white"
        : "border border-dashed border-label-estimated italic text-white";
  return (
    <span
      data-testid="race-label"
      data-label={label}
      className={`inline-flex h-5 items-center gap-1 rounded-[2px] px-[7px] text-xs font-medium ${cls}`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="currentColor" stroke="currentColor">
        {label === "real" && <circle cx="5" cy="5" r="4" />}
        {label === "simulated" && (
          <>
            <circle cx="5" cy="5" r="3.5" fill="none" />
            <path d="M5 1.5a3.5 3.5 0 0 1 0 7z" stroke="none" />
          </>
        )}
        {label === "estimated" && <path d="M0 3.5q1.25-2 2.5 0t2.5 0 2.5 0 2.5 0M0 7q1.25-2 2.5 0t2.5 0 2.5 0 2.5 0" fill="none" />}
      </svg>
      {t(`label.${label}`)}
    </span>
  );
}

export function BTreeRace({
  idxPages,
  seqPages,
  idxRows,
  seqRows,
  noIndex = false,
  label,
  className = "",
}: BTreeRaceProps) {
  const t = useTranslations("btree-anim");
  const normLabel = normalizeLabel(label);

  const safeIdx = noIndex ? 0 : Math.max(0, idxPages ?? 0);
  const safeSeq = Math.max(0, seqPages ?? 0);
  const maxPages = Math.max(safeIdx, safeSeq, 1);

  const idxPct = noIndex ? 0 : (safeIdx / maxPages) * 100;
  const seqPct = (safeSeq / maxPages) * 100;

  const displayIdxRows = noIndex ? 0 : (idxRows ?? 0);
  const displaySeqRows = seqRows ?? 0;

  return (
    <section
      role="region"
      aria-label={t("raceHead")}
      data-testid="btree-race"
      data-no-index={noIndex ? "true" : undefined}
      className={`flex min-w-0 flex-col gap-2 rounded-md border border-line bg-card/60 p-3 text-sm text-ink2 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white tracking-wide">{t("raceHead")}</span>
          {noIndex && (
            <span
              data-testid="race-no-index"
              className="rounded bg-destructive/20 px-1.5 py-0.5 text-xs font-medium text-destructive-foreground border border-destructive/40"
            >
              {t("rNone")}
            </span>
          )}
        </div>
        <Badge label={normLabel} />
      </div>

      <div className="flex flex-col gap-3 py-1">
        {/* Hàng 1: Index Scan */}
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs">
            <span className="font-medium text-white flex items-center gap-1.5">
              <span>{t("rIdx")}</span>
              {noIndex && (
                <span className="text-dim text-[11px] italic">({t("rNone")})</span>
              )}
            </span>
            <div className="flex items-center gap-2 font-mono text-[11.5px] text-dim">
              <span data-testid="race-idx-pages" className="text-white">
                {t("pagesV", { count: safeIdx })}
              </span>
              {idxRows !== undefined && (
                <>
                  <span aria-hidden="true" className="text-line">·</span>
                  <span data-testid="race-idx-rows">
                    {t("rowsV", { count: displayIdxRows })}
                  </span>
                </>
              )}
            </div>
          </div>

          <div
            className="relative h-2.5 w-full overflow-hidden rounded bg-muted/30"
            role="progressbar"
            aria-valuenow={safeIdx}
            aria-valuemin={0}
            aria-valuemax={maxPages}
            aria-label={t("raceIdxAria", { pages: safeIdx, rows: displayIdxRows })}
          >
            <div
              data-testid="race-bar-idx"
              className={`h-full transition-all duration-300 motion-reduce:transition-none ${
                noIndex
                  ? "w-0"
                  : "bg-lamp"
              }`}
              style={{
                width: `${idxPct}%`,
                minWidth: !noIndex && safeIdx > 0 ? "4px" : "0px",
              }}
            />
          </div>
        </div>

        {/* Hàng 2: Seq Scan */}
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs">
            <span className="font-medium text-white">
              {t("rSeq")}
            </span>
            <div className="flex items-center gap-2 font-mono text-[11.5px] text-dim">
              <span data-testid="race-seq-pages" className="text-white">
                {t("pagesV", { count: safeSeq })}
              </span>
              {seqRows !== undefined && (
                <>
                  <span aria-hidden="true" className="text-line">·</span>
                  <span data-testid="race-seq-rows">
                    {t("rowsV", { count: displaySeqRows })}
                  </span>
                </>
              )}
            </div>
          </div>

          <div
            className="relative h-2.5 w-full overflow-hidden rounded bg-muted/30"
            role="progressbar"
            aria-valuenow={safeSeq}
            aria-valuemin={0}
            aria-valuemax={maxPages}
            aria-label={t("raceSeqAria", { pages: safeSeq, rows: displaySeqRows })}
          >
            <div
              data-testid="race-bar-seq"
              className="h-full bg-zinc-400 transition-all duration-300 motion-reduce:transition-none"
              style={{
                width: `${seqPct}%`,
                minWidth: safeSeq > 0 ? "4px" : "0px",
              }}
            />
          </div>
        </div>
      </div>

      <p data-testid="race-note" className="m-0 pt-0.5 text-xs text-dim italic">
        {t("raceNote")}
      </p>
    </section>
  );
}
