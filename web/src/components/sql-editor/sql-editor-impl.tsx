"use client";

import { sql } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import CodeMirror, {
  Decoration,
  EditorView,
  GutterMarker,
  StateEffect,
  StateField,
  gutter,
  type DecorationSet,
  type Extension,
} from "@uiw/react-codemirror";
import { useEffect, useId, useMemo, useState } from "react";
import { DIALECT } from "./dialect";
import type { SqlEditorProps } from "./sql-editor";

const setError = StateEffect.define<number | null>();
// Giữ vị trí lỗi qua map để gõ tiếp không làm lệch dấu; parent nên xóa `error` khi sửa.
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setError)) continue;
      const len = tr.state.doc.length;
      if (e.value === null || len === 0) deco = Decoration.none;
      else {
        const from = Math.min(e.value, len - 1);
        deco = Decoration.set([Decoration.mark({ class: "cm-sql-error" }).range(from, from + 1)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

class ErrorMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("span");
    el.textContent = "!";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}
const marker = new ErrorMarker();
const errorGutter = gutter({
  class: "cm-sql-error-gutter",
  lineMarker(view, line) {
    let hit = false;
    view.state.field(errorField).between(line.from, line.to, () => void (hit = true));
    return hit ? marker : null;
  },
  lineMarkerChange: (u) => u.startState.field(errorField) !== u.state.field(errorField),
});

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "var(--surface)", color: "var(--text)", height: "100%", fontFamily: "var(--mono)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "20px", overflow: "auto" },
    ".cm-content": { caretColor: "var(--lamp)", padding: "8px 0" },
    ".cm-cursor": { borderLeftColor: "var(--lamp)" },
    ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--dim)", border: "none" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--raised)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--control)" },
    ".cm-sql-error": {
      textDecoration: "underline wavy var(--negative)",
      backgroundColor: "color-mix(in srgb, var(--negative) 25%, transparent)",
    },
    ".cm-sql-error-gutter": { width: "16px" },
    ".cm-sql-error-gutter .cm-gutterElement": { color: "var(--negative)", fontWeight: "700", textAlign: "center" },
  },
  { dark: true },
);
const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.standard(t.name)], color: "var(--lamp)" },
    { tag: [t.string, t.special(t.string)], color: "var(--severity-passed)" },
    { tag: [t.number, t.bool, t.null], color: "var(--severity-uncertain)" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--dim)", fontStyle: "italic" },
    { tag: [t.operator, t.punctuation], color: "var(--ink2)" },
    { tag: [t.typeName, t.special(t.name)], color: "var(--ink2)", fontWeight: "700" },
  ]),
);

// `position` đếm trên chuỗi gốc; CodeMirror gộp CRLF thành một ký tự nên phải đổi sang vị trí trong tài liệu.
const normalize = (s: string) => s.replace(/\r\n?/g, "\n");
// Vị trí trỏ vào ký tự LF của một cặp CRLF thì lùi về CR, vì cặp đó chỉ là một ký tự trong tài liệu.
const toDocOffset = (value: string, position: number) => {
  if (value[position] === "\n" && value[position - 1] === "\r") position--;
  return normalize(value.slice(0, position)).length;
};

export default function SqlEditorImpl({ value, onChange, engine, error, ariaLabel }: SqlEditorProps) {
  const errId = useId();
  const [view, setView] = useState<EditorView | null>(null);
  const doc = useMemo(() => normalize(value), [value]);
  const offset = error && Number.isFinite(error.position) && error.position >= 0 ? toDocOffset(value, error.position) : null;

  useEffect(() => {
    view?.dispatch({ effects: setError.of(offset) });
  }, [view, offset]);

  const invalid = Boolean(error);
  const extensions = useMemo<Extension[]>(
    () => [
      sql({ dialect: DIALECT[engine] }),
      EditorView.lineWrapping, // số dòng ở lề là dòng logic nên không cần cấu hình thêm
      theme,
      highlight,
      errorField,
      errorGutter,
      EditorView.contentAttributes.of({
        "aria-label": ariaLabel,
        "aria-invalid": invalid ? "true" : "false",
        ...(invalid ? { "aria-describedby": errId } : {}),
      }),
    ],
    [engine, ariaLabel, invalid, errId],
  );

  // Viền focus kiểu ring của shadcn/ui vẽ bằng lớp phủ trong khung, nên đủ bốn cạnh, không bị gutter che và không bị khung cha cắt.
  return (
    <div className="relative flex h-full min-h-40 flex-col after:pointer-events-none after:absolute after:inset-0 after:z-10 after:border after:border-ring after:opacity-0 after:ring-3 after:ring-ring/50 after:transition-opacity after:duration-150 after:ring-inset focus-within:after:opacity-100">
      <div className="relative min-h-0 flex-1 [&_.cm-content]:!text-[16px] [&_.cm-gutters]:!text-[16px] min-[901px]:[&_.cm-content]:!text-[13px] min-[901px]:[&_.cm-gutters]:!text-[13px] [&_.cm-editor]:h-full">
        <CodeMirror
          value={doc}
          onChange={onChange}
          extensions={extensions}
          theme="none"
          height="100%"
          className="absolute inset-0"
          onCreateEditor={setView}
          basicSetup={{ foldGutter: false, highlightActiveLine: true, autocompletion: false }}
        />
      </div>
      {error && (
        <p id={errId} role="alert" className="border-t border-line px-[var(--edge)] py-2 text-sm text-negative break-words">
          {error.message}
        </p>
      )}
    </div>
  );
}
