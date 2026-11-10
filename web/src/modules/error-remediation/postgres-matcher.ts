import type { ErrorRemediation, QuickFixAction } from "./types";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchPostgresError(
  rawMessage: string,
  sql: string,
  position?: number,
): ErrorRemediation {
  // 1. 42P07: duplicate_table
  const mDuplicateTable = rawMessage.match(/(?:relation|table) "([^"]+)" already exists/i);
  if (mDuplicateTable) {
    const table = mDuplicateTable[1];
    const actions: QuickFixAction[] = [];

    const createRegex = new RegExp(`\\bCREATE\\s+TABLE\\s+("?${escapeRegex(table)}"?\\b)`, "i");
    const mCreate = sql.match(createRegex);
    if (mCreate) {
      actions.push({
        type: "replace_stmt",
        targetSql: mCreate[0],
        replacementSql: `CREATE TABLE IF NOT EXISTS ${mCreate[1]}`,
        labelKey: "error-remediation.actions.add_if_not_exists",
      });
    } else {
      actions.push({
        type: "replace_stmt",
        targetSql: `CREATE TABLE ${table}`,
        replacementSql: `CREATE TABLE IF NOT EXISTS ${table}`,
        labelKey: "error-remediation.actions.add_if_not_exists",
      });
    }

    actions.push({
      type: "prepend_stmt",
      sqlToPrepend: `DROP TABLE IF EXISTS ${table} CASCADE;\n`,
      labelKey: "error-remediation.actions.drop_table_first",
    });

    actions.push({
      type: "rebuild_sandbox",
      labelKey: "error-remediation.actions.rebuild_sandbox",
    });

    return {
      engine: "postgres",
      code: "42P07",
      category: "schema",
      rawMessage,
      titleKey: "error-remediation.titles.duplicate_table",
      explanationKey: "error-remediation.explanations.duplicate_table",
      explanationParams: { table },
      highlightToken: table,
      actions,
    };
  }

  // 2. 42703: undefined_column (Kiểm tra trước 42P01 vì có thể chứa 'of relation "..." does not exist')
  const mUndefinedColumn = rawMessage.match(
    /column "([^"]+)"(?: of relation "([^"]+)")? does not exist/i,
  );
  if (mUndefinedColumn) {
    const column = mUndefinedColumn[1];
    return {
      engine: "postgres",
      code: "42703",
      category: "schema",
      rawMessage,
      titleKey: "error-remediation.titles.undefined_column",
      explanationKey: "error-remediation.explanations.undefined_column",
      explanationParams: { column },
      highlightToken: column,
      actions: [],
    };
  }

  // 3. 42P01: undefined_table
  const mUndefinedTable = rawMessage.match(/(?:relation|table) "([^"]+)" does not exist/i);
  if (mUndefinedTable && !rawMessage.toLowerCase().includes("column ")) {
    const table = mUndefinedTable[1];
    return {
      engine: "postgres",
      code: "42P01",
      category: "schema",
      rawMessage,
      titleKey: "error-remediation.titles.undefined_table",
      explanationKey: "error-remediation.explanations.undefined_table",
      explanationParams: { table },
      highlightToken: table,
      actions: [
        {
          type: "rebuild_sandbox",
          labelKey: "error-remediation.actions.rebuild_sandbox",
        },
      ],
    };
  }

  // 4. 23505: unique_violation
  const mUniqueViolation = rawMessage.match(
    /duplicate key value violates unique constraint "([^"]+)"/i,
  );
  if (mUniqueViolation) {
    const constraint = mUniqueViolation[1];
    const actions: QuickFixAction[] = [];

    const insertMatch = sql.match(/(INSERT\s+INTO\s+[\s\S]+?)(\s*;\s*|\s*$)/i);
    if (insertMatch && !insertMatch[1].toUpperCase().includes("ON CONFLICT")) {
      actions.push({
        type: "replace_stmt",
        targetSql: insertMatch[0].trim(),
        replacementSql: `${insertMatch[1].trim()} ON CONFLICT DO NOTHING;`,
        labelKey: "error-remediation.actions.add_on_conflict_do_nothing",
      });
    }

    actions.push({
      type: "rebuild_sandbox",
      labelKey: "error-remediation.actions.rebuild_sandbox",
    });

    return {
      engine: "postgres",
      code: "23505",
      category: "integrity",
      rawMessage,
      titleKey: "error-remediation.titles.unique_violation",
      explanationKey: "error-remediation.explanations.unique_violation",
      explanationParams: { constraint },
      highlightToken: constraint,
      actions,
    };
  }

  // 5. 23503: foreign_key_violation
  const mFkViolation = rawMessage.match(/violates foreign key constraint "([^"]+)"/i);
  if (mFkViolation) {
    const constraint = mFkViolation[1];
    return {
      engine: "postgres",
      code: "23503",
      category: "integrity",
      rawMessage,
      titleKey: "error-remediation.titles.foreign_key_violation",
      explanationKey: "error-remediation.explanations.foreign_key_violation",
      explanationParams: { constraint },
      highlightToken: constraint,
      actions: [
        {
          type: "rebuild_sandbox",
          labelKey: "error-remediation.actions.rebuild_sandbox",
        },
      ],
    };
  }

  // 6. 23502: not_null_violation
  const mNotNullViolation = rawMessage.match(
    /null value in column "([^"]+)"(?: of relation "([^"]+)")? violates not-null constraint/i,
  );
  if (mNotNullViolation) {
    const column = mNotNullViolation[1];
    return {
      engine: "postgres",
      code: "23502",
      category: "integrity",
      rawMessage,
      titleKey: "error-remediation.titles.not_null_violation",
      explanationKey: "error-remediation.explanations.not_null_violation",
      explanationParams: { column },
      highlightToken: column,
      actions: [],
    };
  }

  // 7. 42601: syntax_error
  const mSyntaxError = rawMessage.match(/syntax error at or near "([^"]+)"/i);
  if (mSyntaxError) {
    const token = mSyntaxError[1];
    return {
      engine: "postgres",
      code: "42601",
      category: "syntax",
      rawMessage,
      titleKey: "error-remediation.titles.syntax_error",
      explanationKey: "error-remediation.explanations.syntax_error",
      explanationParams: { token },
      highlightToken: token,
      actions: [],
    };
  }

  // 8. 25P02: in_failed_sql_transaction
  const mTxAborted = rawMessage.match(
    /current transaction is aborted, commands ignored until end of transaction block/i,
  );
  if (mTxAborted) {
    return {
      engine: "postgres",
      code: "25P02",
      category: "transaction",
      rawMessage,
      titleKey: "error-remediation.titles.in_failed_sql_transaction",
      explanationKey: "error-remediation.explanations.in_failed_sql_transaction",
      explanationParams: {},
      rootCauseHintKey: "error-remediation.root_cause_hints.transaction_aborted",
      actions: [
        {
          type: "rebuild_sandbox",
          labelKey: "error-remediation.actions.rebuild_sandbox",
        },
      ],
    };
  }

  // 9. 22P02: invalid_text_representation
  const mInvalidText = rawMessage.match(/invalid input syntax for (?:type\s+)?(\w+): "([^"]+)"/i);
  if (mInvalidText) {
    const type = mInvalidText[1];
    const value = mInvalidText[2];
    return {
      engine: "postgres",
      code: "22P02",
      category: "datatype",
      rawMessage,
      titleKey: "error-remediation.titles.invalid_text_representation",
      explanationKey: "error-remediation.explanations.invalid_text_representation",
      explanationParams: { type, value },
      highlightToken: value,
      actions: [],
    };
  }

  // 10. 2BP01: dependent_objects_still_exist
  const mDependentObjects = rawMessage.match(
    /cannot drop table "?([^"\s]+)"? because other objects depend on it/i,
  );
  if (mDependentObjects) {
    const table = mDependentObjects[1];
    const actions: QuickFixAction[] = [];

    const dropRegex = new RegExp(
      `\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?("?${escapeRegex(table)}"?)(?:\\s*;|\\b)`,
      "i",
    );
    const dropMatch = sql.match(dropRegex);
    if (dropMatch) {
      const stmt = dropMatch[0].replace(/;\s*$/, "").trim();
      actions.push({
        type: "replace_stmt",
        targetSql: dropMatch[0].trim(),
        replacementSql: `${stmt} CASCADE;`,
        labelKey: "error-remediation.actions.add_cascade",
      });
    } else {
      actions.push({
        type: "replace_stmt",
        targetSql: `DROP TABLE ${table}`,
        replacementSql: `DROP TABLE ${table} CASCADE;`,
        labelKey: "error-remediation.actions.add_cascade",
      });
    }

    actions.push({
      type: "rebuild_sandbox",
      labelKey: "error-remediation.actions.rebuild_sandbox",
    });

    return {
      engine: "postgres",
      code: "2BP01",
      category: "schema",
      rawMessage,
      titleKey: "error-remediation.titles.dependent_objects_still_exist",
      explanationKey: "error-remediation.explanations.dependent_objects_still_exist",
      explanationParams: { table },
      highlightToken: table,
      actions,
    };
  }

  // Fallback: UNKNOWN
  let highlightToken: string | undefined;
  if (position !== undefined && position > 0 && position <= sql.length) {
    const sub = sql.slice(position - 1);
    const tokenMatch = sub.match(/^\S+/);
    if (tokenMatch) {
      highlightToken = tokenMatch[0];
    }
  }

  return {
    engine: "postgres",
    code: "UNKNOWN",
    category: "other",
    rawMessage,
    titleKey: "error-remediation.titles.unknown_error",
    explanationKey: "error-remediation.explanations.unknown_error",
    explanationParams: {},
    highlightToken,
    actions: [
      {
        type: "rebuild_sandbox",
        labelKey: "error-remediation.actions.rebuild_sandbox",
      },
    ],
  };
}
