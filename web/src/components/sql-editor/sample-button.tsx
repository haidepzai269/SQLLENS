"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { EngineId } from "@/contracts/engine";
import { SAMPLE_SQL } from "./samples";

export function SampleButton({ engine, onLoad }: { engine: EngineId; onLoad: (sql: string) => void }) {
  const t = useTranslations("sql-editor");
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => onLoad(SAMPLE_SQL[engine])}>
      {t("loadSample")}
    </Button>
  );
}
