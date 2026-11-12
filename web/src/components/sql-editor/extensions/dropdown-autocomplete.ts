import { autocompletion, type Completion, type CompletionSource } from "@codemirror/autocomplete";
import { schemaCompletionSource, type SQLConfig, type SQLDialect, type SQLNamespace } from "@codemirror/lang-sql";
import { EditorView, type Extension } from "@uiw/react-codemirror";

export interface SqlAutocompleteOptions {
  schema?: Record<string, string[]>;
  dialect: SQLDialect;
  enabled: boolean;
}

export interface FormattedSchemaResult {
  namespace: SQLNamespace;
  topColumns: Completion[];
}

/**
 * Ánh xạ dictionary { tableName: [col1, col2, ...] } sang cấu trúc SQLNamespace của CodeMirror 6.
 * Bảng: type "class", detail "table"
 * Cột: type "property", detail "column"
 */
export function formatSchemaForCompletion(schema: Record<string, string[]> = {}): FormattedSchemaResult {
  const namespace: Record<string, { self: Completion; children: Completion[] }> = {};
  const seenCols = new Set<string>();
  const topColumns: Completion[] = [];

  for (const [tableName, columns] of Object.entries(schema)) {
    if (!tableName) continue;
    const cols = Array.isArray(columns) ? columns : [];

    namespace[tableName] = {
      self: {
        label: tableName,
        type: "class",
        detail: "table",
        boost: 2,
      },
      children: cols.map((col) => ({
        label: col,
        type: "property",
        detail: "column",
        boost: 1,
      })),
    };

    for (const col of cols) {
      if (!seenCols.has(col)) {
        seenCols.add(col);
        topColumns.push({
          label: col,
          type: "property",
          detail: "column",
          boost: 0,
        });
      }
    }
  }

  return { namespace, topColumns };
}

/**
 * Styling hiện đại cho Popup Dropdown Autocomplete theo theme SQLLens:
 * Hỗ trợ phân loại icon: Bảng (⊞), Cột (◈), Từ khóa SQL (⚡).
 */
export const autocompleteTheme = EditorView.theme(
  {
    ".cm-tooltip.cm-tooltip-autocomplete": {
      backgroundColor: "var(--surface)",
      border: "1px solid var(--line)",
      borderRadius: "6px",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
      fontFamily: "var(--mono)",
      fontSize: "13px",
      maxHeight: "260px",
      overflow: "hidden",
      zIndex: "50",
    },
    ".cm-tooltip-autocomplete > ul": {
      maxHeight: "260px",
      padding: "4px",
      listStyle: "none",
      margin: 0,
    },
    ".cm-tooltip-autocomplete > ul > li": {
      padding: "3px 8px",
      borderRadius: "4px",
      color: "var(--text)",
      lineHeight: "1.5",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      cursor: "pointer",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected=\"true\"]": {
      backgroundColor: "var(--raised)",
      color: "var(--lamp)",
    },
    ".cm-completionIcon": {
      width: "16px",
      textAlign: "center",
      fontSize: "11px",
      opacity: "0.85",
      fontWeight: "700",
      flexShrink: 0,
      display: "inline-block",
    },
    ".cm-completionIcon-class:after": {
      content: "'⊞'",
      color: "#38bdf8", // Sky blue cho Bảng (Table)
    },
    ".cm-completionIcon-property:after": {
      content: "'◈'",
      color: "#a78bfa", // Purple cho Cột (Column)
    },
    ".cm-completionIcon-keyword:after": {
      content: "'⚡'",
      color: "#f59e0b", // Amber cho Từ khóa SQL (Keyword)
    },
    ".cm-completionIcon-type:after": {
      content: "'𝑡'",
      color: "#34d399", // Emerald cho Type
    },
    ".cm-completionIcon-variable:after": {
      content: "'𝑥'",
      color: "#94a3b8", // Muted cho Variable
    },
    ".cm-completionDetail": {
      marginLeft: "auto",
      fontSize: "11px",
      opacity: "0.55",
      fontStyle: "italic",
      fontFamily: "var(--font-sans, sans-serif)",
    },
    ".cm-completionMatchedText": {
      textDecoration: "none",
      fontWeight: "700",
      color: "var(--lamp)",
    },
  },
  { dark: true }
);

/**
 * Tạo Extension gợi ý mã Dropdown Popup cho CodeMirror 6.
 * - Khi `enabled === false`: trả về `[]` (rỗng), zero CPU overhead, không mở bất kỳ popup nào.
 * - Khi `enabled === true`: nạp schema vào dialect language data, kích hoạt autocompletion với fuzzy match và phím Tab/Enter/Esc.
 */
export function createSqlAutocompleteExtension({
  schema = {},
  dialect,
  enabled,
}: SqlAutocompleteOptions): Extension {
  if (!enabled) {
    return [];
  }

  const { namespace, topColumns } = formatSchemaForCompletion(schema);

  const config: SQLConfig = {
    dialect,
    schema: namespace,
    tables: topColumns,
  };

  const schemaSource: CompletionSource = schemaCompletionSource(config);

  return [
    dialect.language.data.of({
      autocomplete: schemaSource,
    }),
    autocompletion({
      activateOnTyping: true,
      maxRenderedOptions: 50,
      defaultKeymap: true,
    }),
    autocompleteTheme,
  ];
}
