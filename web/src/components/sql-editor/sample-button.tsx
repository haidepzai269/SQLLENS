"use client";

import { useTranslations } from "next-intl";
import { Tip } from "@/components/shell/tip";
import { Button } from "@/components/ui/button";
import type { EngineId } from "@/contracts/engine";
import { SAMPLE_SQL } from "./samples";

export function SampleButton({ engine, onLoad }: { engine: EngineId; onLoad: (sql: string) => void }) {
  const t = useTranslations("sql-editor");
  const ts = useTranslations("shell");
  return (
    <Tip label={ts("tip.sample")} side="right">
      <Button type="button" variant="outline" size="sm" onClick={() => onLoad(SAMPLE_SQL[engine])}>
        {t("loadSample")}
      </Button>
    </Tip>
  );
}
