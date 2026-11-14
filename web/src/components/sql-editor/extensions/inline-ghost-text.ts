/**
 * Copyright (c) 2026 SQLLens
 * CodeMirror 6 Inline Ghost Text Extension.
 * Renders client-side heuristic SQL completion inline as grayed-out ghost text after cursor.
 * Handles Tab to accept, Escape to dismiss, and type-ahead slicing.
 */

import {
  Facet,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  type DecorationSet,
  type KeyBinding,
} from "@codemirror/view";
import { predictNextSqlSnippet } from "@/modules/editor/heuristics/sql-heuristics";
import type { ForeignKeyRelation, TableSchema } from "@/modules/editor/heuristics/types";

export interface InlineGhostTextOptions {
  enabled?: boolean;
  getTables?: () => TableSchema | undefined;
  getForeignKeys?: () => ForeignKeyRelation[] | undefined;
  tables?: TableSchema;
  foreignKeys?: ForeignKeyRelation[];
}

export interface GhostText {
  text: string;
  from: number;
}

export const clearGhostTextEffect = StateEffect.define<void>();
export const setGhostTextEffect = StateEffect.define<GhostText | null>();

/**
 * Class widget render đoạn chữ mờ xám (ghost text) nối tiếp ngay sau con trỏ soạn thảo.
 * Mang class CSS thẩm mỹ: opacity-40 select-none pointer-events-none text-muted-foreground font-mono inline-block.
 */
export class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "opacity-40 select-none pointer-events-none text-muted-foreground font-mono inline-block";
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  eq(other: GhostTextWidget): boolean {
    return this.text === other.text;
  }
}

/**
 * Facet lưu trữ cấu hình Inline Ghost Text để StateField có thể truy cập động.
 */
export const ghostTextConfigFacet = Facet.define<InlineGhostTextOptions, InlineGhostTextOptions>({
  combine(values) {
    return values[values.length - 1] ?? {};
  },
});

function calculatePrediction(state: EditorView["state"]): GhostText | null {
  try {
    const sel = state.selection.main;
    // Khi có vùng bôi đen (không rỗng), không hiển thị ghost text
    if (!sel.empty) {
      return null;
    }

    const config = state.facet(ghostTextConfigFacet);
    const tables = config.getTables?.() ?? config.tables;
    const foreignKeys = config.getForeignKeys?.() ?? config.foreignKeys;
    const docText = state.doc.toString();
    const cursorOffset = sel.head;

    const result = predictNextSqlSnippet({
      docText,
      cursorOffset,
      tables,
      foreignKeys,
    });

    if (typeof result === "string" && result.length > 0) {
      return {
        text: result,
        from: cursorOffset,
      };
    }
  } catch {
    // An toàn tuyệt đối, không crash editor
  }
  return null;
}

/**
 * StateField quản lý trạng thái GhostText hiện tại.
 */
export const ghostTextField = StateField.define<GhostText | null>({
  create(state) {
    return calculatePrediction(state);
  },
  update(value, tr) {
    try {
      // 1. Explicit effects (clear hoặc set)
      for (const e of tr.effects) {
        if (e.is(clearGhostTextEffect)) {
          return null;
        }
        if (e.is(setGhostTextEffect)) {
          return e.value;
        }
      }

      const sel = tr.state.selection.main;
      // 2. Con trỏ có vùng bôi đen -> hủy bỏ ngay lập tức
      if (!sel.empty) {
        return null;
      }

      // 3. Nếu tài liệu không thay đổi nội dung
      if (!tr.docChanged) {
        if (!tr.newSelection.eq(tr.startState.selection)) {
          // Con trỏ di chuyển bằng chuột hoặc phím mũi tên -> hủy ghost text cũ
          return null;
        }
        return value;
      }

      // 4. Nếu tài liệu thay đổi: Kiểm tra Type-ahead
      if (value && value.text.length > 0) {
        let isSingleCharInsert = false;
        let insertedChar = "";
        let changeCount = 0;

        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          changeCount++;
          if (changeCount === 1 && fromA === value.from && toA === value.from) {
            const str = inserted.sliceString(0);
            if (str.length === 1) {
              isSingleCharInsert = true;
              insertedChar = str;
            }
          }
        });

        if (isSingleCharInsert && changeCount === 1) {
          const firstChar = value.text[0];
          const isMatch =
            insertedChar === firstChar ||
            (firstChar.toLowerCase() === insertedChar.toLowerCase() && /[a-zA-Z]/.test(firstChar));

          if (isMatch) {
            const nextText = value.text.slice(1);
            if (nextText.length > 0) {
              return {
                text: nextText,
                from: sel.head,
              };
            }
            return null;
          }
        }
      }

      // 5. Nếu không khớp Type-ahead, hoặc xóa lùi / paste / gõ ký tự khác: tính toán lại gợi ý mới qua Heuristics
      return calculatePrediction(tr.state);
    } catch {
      return null;
    }
  },
});

/**
 * StateField cung cấp decorations hiển thị GhostTextWidget sau con trỏ.
 */
export const ghostTextDecorations = StateField.define<DecorationSet>({
  create(state) {
    const ghost = state.field(ghostTextField, false);
    if (!ghost || !ghost.text) return Decoration.none;
    return Decoration.set([
      Decoration.widget({
        widget: new GhostTextWidget(ghost.text),
        side: 1,
      }).range(ghost.from),
    ]);
  },
  update(_deco, tr) {
    const ghost = tr.state.field(ghostTextField, false);
    if (!ghost || !ghost.text) {
      return Decoration.none;
    }
    return Decoration.set([
      Decoration.widget({
        widget: new GhostTextWidget(ghost.text),
        side: 1,
      }).range(ghost.from),
    ]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Chấp nhận (Accept) gợi ý Ghost Text khi người dùng nhấn phím Tab.
 * Chèn trọn vẹn đoạn text vào tài liệu và dời con trỏ đến cuối đoạn vừa chèn.
 * Trả về true nếu đã xử lý, false nếu không có ghost text (để fallback thụt lề 2 spaces bình thường).
 */
export function acceptGhostText(view: EditorView): boolean {
  try {
    const ghost = view.state.field(ghostTextField, false);
    if (!ghost || !ghost.text) {
      return false;
    }
    view.dispatch({
      changes: { from: ghost.from, insert: ghost.text },
      selection: { anchor: ghost.from + ghost.text.length },
      effects: clearGhostTextEffect.of(),
      userEvent: "input.complete",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Hủy bỏ (Dismiss) gợi ý Ghost Text khi người dùng nhấn phím Escape.
 * Trả về true nếu đã hủy ghost text, false nếu không có ghost text.
 */
export function dismissGhostText(view: EditorView): boolean {
  try {
    const ghost = view.state.field(ghostTextField, false);
    if (!ghost || !ghost.text) {
      return false;
    }
    view.dispatch({
      effects: clearGhostTextEffect.of(),
    });
    return true;
  } catch {
    return false;
  }
}

export const ghostTextKeymap: KeyBinding[] = [
  {
    key: "Tab",
    run: acceptGhostText,
  },
  {
    key: "Escape",
    run: dismissGhostText,
  },
];

/**
 * Tạo Extension CodeMirror 6 cho Inline Ghost Text.
 * - Khi `enabled === false`: trả về `[]` (zero overhead).
 * - Khi `enabled !== false`: nạp cấu hình, StateField, Decorations và Keymap ưu tiên cao.
 */
export function createInlineGhostTextExtension(options: InlineGhostTextOptions = {}): Extension {
  if (options.enabled === false) {
    return [];
  }

  return [
    ghostTextConfigFacet.of(options),
    ghostTextField,
    ghostTextDecorations,
    Prec.highest(keymap.of(ghostTextKeymap)),
  ];
}
