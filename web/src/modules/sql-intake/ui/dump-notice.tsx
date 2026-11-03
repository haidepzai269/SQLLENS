"use client";

import { useTranslations } from "next-intl";
import type { PrepareResult } from "../classify";

export function DumpNotice({ removed }: { removed: PrepareResult["removed"] }) {
  const t = useTranslations("sql-intake");
  if (!removed.copyBlocks && !removed.lockStatements) return null;
  return (
    <p role="status" className="text-xs text-muted-foreground" data-testid="dump-notice">
      {[removed.copyBlocks > 0 && t("dumpCopy", removed), removed.lockStatements > 0 && t("dumpLock", removed)].filter(Boolean).join(" ")}
    </p>
  );
}
