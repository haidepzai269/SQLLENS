import type { ErrorRemediation, QuickFixAction } from "./types";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchMysqlError(
  rawMessage: string,
  sql: string,
  position?: number,
): ErrorRemediation {
  // 1. 1050: ER_TABLE_EXISTS_ERROR
  const mTableExists = rawMessage.match(/Table '(?:[^'.]+\.)?([^']+)' already exists/i);
  if (mTableExists) {
    const table = mTableExists[1];
    const actions: QuickFixAction[] = [];

    const createRegex = new RegExp(
      `\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(\`${escapeRegex(table)}\`|"${escapeRegex(table)}"|${escapeRegex(table)}\\b)`,
      "i",
    );
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
      sqlToPrepend: `DROP TABLE IF EXISTS ${table};\n`,
      labelKey: "error-remediation.actions.drop_table_first",
    });

    actions.push({
      type: "rebuild_sandbox",
      labelKey: "error-remediation.actions.rebuild_sandbox",
    });

    return {
      engine: "mysql",
      code: "1050",
      category: "schema",
      rawMessage,
      titleKey: "error-remediation.titles.duplicate_table",
      explanationKey: "error-remediation.explanations.duplicate_table",
      explanationParams: { table },
      highlightToken: table,
      actions,
    };
  }

  // 2. 1146: ER_NO_SUCH_TABLE
  const mNoSuchTable = rawMessage.match(/Table '(?:[^'.]+\.)?([^']+)' doesn't exist/i);
  if (mNoSuchTable) {
    const table = mNoSuchTable[1];
    return {
      engine: "mysql",
      code: "1146",
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

  // 3. 1054: ER_BAD_FIELD_ERROR
  const mUnknownColumn = rawMessage.match(/Unknown column '([^']+)'/i);
  if (mUnknownColumn) {
    const column = mUnknownColumn[1];
    return {
      engine: "mysql",
      code: "1054",
      category: "schema",
      rawMessage,
      titleKey: "error-remediation.titles.undefined_column",
      explanationKey: "error-remediation.explanations.undefined_column",
      explanationParams: { column },
      highlightToken: column,
      actions: [],
    };
  }

  // 4. 1062: ER_DUP_ENTRY
  const mDupEntry = rawMessage.match(/Duplicate entry '([^']*)' for key '([^']+)'/i);
  if (mDupEntry) {
    const key = mDupEntry[2];
    return {
      engine: "mysql",
      code: "1062",
      category: "integrity",
      rawMessage,
      titleKey: "error-remediation.titles.unique_violation",
      explanationKey: "error-remediation.explanations.unique_violation",
      explanationParams: { constraint: key },
      highlightToken: key,
      actions: [
        {
          type: "rebuild_sandbox",
          labelKey: "error-remediation.actions.rebuild_sandbox",
        },
      ],
    };
  }

  // 5. 1452: ER_NO_REFERENCED_ROW_2 (Foreign key constraint fails)
  const mFkFails = rawMessage.match(
    /Cannot add or update a child row: a foreign key constraint fails(?:.*?CONSTRAINT [`'"]?([^`'"\s,)]+)[`'"]?)?/i,
  );
  if (mFkFails) {
    const constraint = mFkFails[1] || "foreign_key";
    return {
      engine: "mysql",
      code: "1452",
      category: "integrity",
      rawMessage,
      titleKey: "error-remediation.titles.foreign_key_violation",
      explanationKey: "error-remediation.explanations.foreign_key_violation",
      explanationParams: { constraint },
      highlightToken: mFkFails[1] || undefined,
      actions: [
        {
          type: "rebuild_sandbox",
          labelKey: "error-remediation.actions.rebuild_sandbox",
        },
      ],
    };
  }

  // 6. 1064: ER_PARSE_ERROR (Syntax error)
  const mSyntaxError = rawMessage.match(
    /You have an error in your SQL syntax(?:.*?near '([^']*)')?/i,
  );
  if (mSyntaxError) {
    const token = mSyntaxError[1] || "";
    return {
      engine: "mysql",
      code: "1064",
      category: "syntax",
      rawMessage,
      titleKey: "error-remediation.titles.syntax_error",
      explanationKey: "error-remediation.explanations.syntax_error",
      explanationParams: { token },
      highlightToken: token || undefined,
      actions: [],
    };
  }

  // 7. 1048: ER_BAD_NULL_ERROR
  const mBadNull = rawMessage.match(/Column '([^']+)' cannot be null/i);
  if (mBadNull) {
    const column = mBadNull[1];
    return {
      engine: "mysql",
      code: "1048",
      category: "integrity",
      rawMessage,
      titleKey: "error-remediation.titles.not_null_violation",
      explanationKey: "error-remediation.explanations.not_null_violation",
      explanationParams: { column },
      highlightToken: column,
      actions: [],
    };
  }

  // 8. 1406: ER_DATA_TOO_LONG
  const mDataTooLong = rawMessage.match(/Data too long for column '([^']+)'/i);
  if (mDataTooLong) {
    const column = mDataTooLong[1];
    return {
      engine: "mysql",
      code: "1406",
      category: "datatype",
      rawMessage,
      titleKey: "error-remediation.titles.data_too_long",
      explanationKey: "error-remediation.explanations.data_too_long",
      explanationParams: { column },
      highlightToken: column,
      actions: [],
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
    engine: "mysql",
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
