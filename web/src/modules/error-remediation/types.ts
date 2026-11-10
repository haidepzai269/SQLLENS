export type QuickFixAction =
  | {
      type: "replace_stmt";
      targetSql: string;
      replacementSql: string;
      labelKey: string;
    }
  | {
      type: "prepend_stmt";
      sqlToPrepend: string;
      labelKey: string;
    }
  | {
      type: "rebuild_sandbox";
      labelKey: string;
    };

export type ErrorCategory =
  | "schema"
  | "integrity"
  | "datatype"
  | "syntax"
  | "transaction"
  | "other";

export interface ErrorRemediation {
  engine: "postgres" | "mysql";
  code: string;
  category: ErrorCategory;
  rawMessage: string;
  titleKey: string;
  explanationKey: string;
  explanationParams?: Record<string, string | number>;
  highlightToken?: string;
  actions: QuickFixAction[];
  rootCauseHintKey?: string;
}
