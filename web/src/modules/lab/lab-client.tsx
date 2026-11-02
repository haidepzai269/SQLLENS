"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { Conclusion } from "@/contracts/conclusion";
import type { EngineAdapter, QueryResult } from "@/contracts/engine";
import { createPostgresAdapter } from "@/engines/postgres/adapter";

type RunData = { statements: number; rows: number };
type State =
  | { phase: "idle" | "loading" | "running" }
  | { phase: "load_error" | "sql_error"; message: string }
  | { phase: "done"; last: QueryResult; conclusion: Conclusion<RunData> };

const cell = (v: unknown) =>
  v === null
    ? "NULL"
    : v instanceof Date
      ? v.toISOString()
      : v instanceof Uint8Array
        ? "\\x" + Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("")
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function LabClient() {
  const t = useTranslations("lab");
  const [sql, setSql] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const adapter = useRef<Promise<EngineAdapter> | null>(null);

  // Rời trang thì dispose. Ref được xóa nên strict mode mount lại sẽ tạo instance mới.
  useEffect(
    () => () => {
      adapter.current?.then((a) => a.dispose(), () => {});
      adapter.current = null;
    },
    [],
  );

  async function run() {
    let db: EngineAdapter;
    try {
      if (!adapter.current) {
        setState({ phase: "loading" });
        adapter.current = createPostgresAdapter();
      }
      db = await adapter.current;
    } catch (e) {
      adapter.current = null; // cho phép thử lại
      setState({ phase: "load_error", message: errMsg(e) });
      return;
    }
    setState({ phase: "running" });
    try {
      const results = await db.execute(sql);
      const last = results[results.length - 1] ?? { columns: [], rows: [] };
      const data = { statements: results.length, rows: last.rows.length };
      const conclusion: Conclusion<RunData> = {
        kind: "conclusion",
        label: "real",
        data,
        evidence: [{ kind: "execution", messageKey: "evidence.executed", values: data }],
      };
      setState({ phase: "done", last, conclusion });
    } catch (e) {
      setState({ phase: "sql_error", message: errMsg(e) });
    }
  }

  const busy = state.phase === "loading" || state.phase === "running";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <label htmlFor="sql" className="text-sm font-medium">
        {t("sqlLabel")}
      </label>
      <Textarea
        id="sql"
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        placeholder={t("sqlPlaceholder")}
        className="font-mono"
        spellCheck={false}
      />
      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={sql.trim() === "" || busy}>
          {t("run")}
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {state.phase === "loading" && t("loading")}
          {state.phase === "running" && t("running")}
        </span>
      </div>
      {state.phase === "load_error" && (
        <Alert variant="destructive" data-testid="error">
          <AlertDescription className="flex flex-col items-start gap-2">
            {t("loadError", { message: state.message })}
            <Button variant="outline" onClick={run}>
              {t("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {state.phase === "sql_error" && (
        <Alert variant="destructive" data-testid="error">
          <AlertDescription>{t("sqlError", { message: state.message })}</AlertDescription>
        </Alert>
      )}
      {state.phase === "done" && (
        <>
          {state.last.columns.length === 0 ? null : state.last.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {state.last.columns.map((c, i) => (
                      <TableHead key={i}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.last.rows.map((r, i) => (
                    <TableRow key={i}>
                      {r.map((v, j) => (
                        <TableCell key={j}>{cell(v)}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex flex-col gap-2" data-testid="conclusion">
            <Badge className="self-start">{t(`label.${state.conclusion.label}`)}</Badge>
            {state.conclusion.evidence.map((ev) => (
              <p key={ev.kind} className="text-sm">
                {t(ev.messageKey, ev.values)}
              </p>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
