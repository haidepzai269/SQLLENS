"use client";

import { useId, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EngineId } from "@/contracts/engine";
import { toCreateSql, type InferredTable, type InferWarning } from "../infer";
import { MAX_NAME, TYPES, validate, type Draft, type DraftColumn, type DraftTable } from "./schema-draft";

const selectCls =
  "h-8 min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engine: EngineId;
  draft: Draft;
  onDraft: (d: Draft) => void;
  warnings: InferWarning[];
  /** Lỗi của bước tạo bảng lần trước, để người dùng sửa tiếp. */
  error?: string;
  /** Nút Chạy: focus quay về đây khi đóng. */
  returnFocus: RefObject<HTMLElement | null>;
  onConfirm: (createSql: string) => void;
  /** Bảng đã có sẵn trong phiên: chạy query mà không tạo gì. */
  onSkip: () => void;
};

const createSql = (d: Draft, engine: EngineId) => toCreateSql(d.tables as unknown as InferredTable[], engine);

export function ConfirmSchemaDialog({ open, onOpenChange, engine, draft, onDraft, warnings, error, returnFocus, onConfirm, onSkip }: Props) {
  const t = useTranslations("sql-intake");
  const hintId = useId();
  const issues = validate(draft, engine);
  const sqlMode = draft.mode === "sql";
  const manualEmpty = sqlMode && draft.manualSql.trim() === "";
  const blocked = issues.length > 0 || manualEmpty || draft.tables.length === 0;
  const label = (i: number) => draft.tables[i].name.trim() || t("unnamedTable", { n: i + 1 });

  const setTable = (ti: number, f: (x: DraftTable) => DraftTable) => onDraft({ ...draft, tables: draft.tables.map((x, i) => (i === ti ? f(x) : x)) });
  const setCol = (ti: number, ci: number, patch: Partial<DraftColumn>) =>
    setTable(ti, (x) => ({ ...x, columns: x.columns.map((c, i) => (i === ci ? { ...c, ...patch, reason: "user" } : c)) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent finalFocus={returnFocus} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-testid="confirm-schema">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("draftNote")}</DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" role="alert" data-testid="schema-error">
            <AlertDescription>{t("schemaError", { message: error })}</AlertDescription>
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert data-testid="warnings">
            <AlertDescription>
              <ul className="m-0 list-disc pl-4">
                {warnings.map((w) => (
                  <li key={`${w.key}|${w.table}`}>{t(`warn.${w.key}`, { table: w.table ?? "" })}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {sqlMode ? (
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="manual-sql" className="text-sm font-medium">
              {t("manualLabel")}
            </label>
            <Textarea id="manual-sql" className="min-h-40 font-mono" value={draft.manualSql} onChange={(e) => onDraft({ ...draft, manualSql: e.target.value })} spellCheck={false} />
            <Button variant="outline" size="sm" className="self-start" onClick={() => onDraft({ ...draft, mode: "form" })}>
              {t("backToForm")}
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {draft.tables.map((tb, ti) => (
              <fieldset key={ti} className="m-0 flex min-w-0 flex-col gap-2 border border-line p-2" data-testid="draft-table">
                <legend className="px-1 text-sm font-medium">{t("tableN", { n: ti + 1 })}</legend>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={t("tableName", { n: ti + 1 })}
                    className="min-w-0 flex-1 basis-40"
                    maxLength={MAX_NAME}
                    value={tb.name}
                    onChange={(e) => setTable(ti, (x) => ({ ...x, name: e.target.value }))}
                  />
                  {tb.incomplete && <Badge variant="outline">{t("incomplete")}</Badge>}
                  <Button variant="outline" size="sm" aria-label={t("removeTable", { n: ti + 1 })} onClick={() => onDraft({ ...draft, tables: draft.tables.filter((_, i) => i !== ti) })}>
                    {t("removeTableBtn")}
                  </Button>
                </div>
                {tb.incomplete && <p className="m-0 text-xs text-muted-foreground">{t("incompleteHint")}</p>}
                {tb.columns.length === 0 && <p className="m-0 text-xs text-muted-foreground">{t("noColumnsHint")}</p>}
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {tb.columns.map((c, ci) => (
                    <li key={ci} className="flex flex-wrap items-center gap-2" data-testid="draft-column">
                      <Input
                        aria-label={t("columnName", { c: ci + 1, table: label(ti) })}
                        className="min-w-0 flex-1 basis-32"
                        maxLength={MAX_NAME}
                        value={c.name}
                        onChange={(e) => setCol(ti, ci, { name: e.target.value })}
                      />
                      <select
                        aria-label={t("columnType", { c: ci + 1, table: label(ti) })}
                        className={selectCls}
                        value={c.type}
                        onChange={(e) => setCol(ti, ci, { type: e.target.value })}
                      >
                        {(TYPES.includes(c.type) ? TYPES : [c.type, ...TYPES]).map((ty) => (
                          <option key={ty} value={ty}>
                            {ty}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={c.primaryKeyGuess}
                          onChange={(e) => setCol(ti, ci, { primaryKeyGuess: e.target.checked })}
                          aria-label={t("columnPk", { c: ci + 1, table: label(ti) })}
                        />
                        {t("pk")}
                      </label>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={t("removeColumn", { c: ci + 1, table: label(ti) })}
                        onClick={() => setTable(ti, (x) => ({ ...x, columns: x.columns.filter((_, i) => i !== ci) }))}
                      >
                        {t("remove")}
                      </Button>
                      <span className="basis-full text-xs text-muted-foreground" data-testid="reason">
                        {t(`reason.${c.reason}`)}
                        {c.primaryKeyGuess && c.reason !== "user" && ` · ${t("reason.pk")}`}
                      </span>
                    </li>
                  ))}
                </ul>
                {tb.foreignKeyGuesses.length > 0 && (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
                    {tb.foreignKeyGuesses.map((fk, fi) => (
                      <li key={fi} className="flex flex-wrap items-center gap-2" data-testid="draft-fk">
                        <span>{t("fkGuess", { column: fk.column, table: fk.table, ref: fk.refColumn })}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t("removeFk", { column: fk.column, table: label(ti) })}
                          onClick={() => setTable(ti, (x) => ({ ...x, foreignKeyGuesses: x.foreignKeyGuesses.filter((_, i) => i !== fi) }))}
                        >
                          {t("remove")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => setTable(ti, (x) => ({ ...x, columns: [...x.columns, { name: "", type: "text", reason: "user", primaryKeyGuess: false }] }))}
                >
                  {t("addColumn")}
                </Button>
              </fieldset>
            ))}
            <Button variant="outline" size="sm" className="self-start" onClick={() => onDraft({ ...draft, mode: "sql", manualSql: draft.manualSql || createSql(draft, engine) })}>
              {t("writeSql")}
            </Button>
          </div>
        )}

        {blocked && (
          <ul id={hintId} role="status" data-testid="issues" className="m-0 list-disc pl-4 text-sm text-destructive">
            {issues.map((i, k) => (
              <li key={k}>{t(`issue.${i.key}`, { table: label(i.table), c: (i.column ?? 0) + 1 })}</li>
            ))}
            {manualEmpty && <li>{t("issue.manual-empty")}</li>}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button variant="outline" onClick={onSkip}>
            {t("skip")}
          </Button>
          <Button disabled={blocked} aria-describedby={blocked ? hintId : undefined} onClick={() => onConfirm(sqlMode ? draft.manualSql.trim() : createSql(draft, engine))}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
