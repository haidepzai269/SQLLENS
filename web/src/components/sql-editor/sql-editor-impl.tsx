"use client";

import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import CodeMirror, {
  Decoration,
  EditorView,
  ExternalChange,
  GutterMarker,
  StateEffect,
  StateField,
  basicSetup,
  gutter,
  type DecorationSet,
  type Extension,
} from "@uiw/react-codemirror";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DEFAULT_SETTINGS, useSettings } from "@/contexts/settings-context";
import { DIALECT } from "./dialect";
import { createSqlAutocompleteExtension } from "./extensions/dropdown-autocomplete";
import { createInlineGhostTextExtension } from "./extensions/inline-ghost-text";
import { createAiCopilotExtension } from "./extensions/ai-copilot";
import type { SqlEditorProps } from "./sql-editor";
import { getStatementAtOffset } from "./statement-at-cursor";

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

const setHit = StateEffect.define<{ from: number; to: number } | null>();
const hitField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setHit)) continue;
      const len = tr.state.doc.length;
      const h = e.value;
      deco = h && h.to > h.from && h.from < len ? Decoration.set([Decoration.mark({ class: "cm-sql-hit" }).range(h.from, Math.min(h.to, len))]) : Decoration.none;
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
    ".cm-sql-hit": { backgroundColor: "color-mix(in srgb, var(--lamp) 28%, transparent)", outline: "1px solid var(--lamp)" },
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

function useSafeSettings() {
  try {
    return useSettings().settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function SqlEditorImpl({
  value,
  onChange,
  engine,
  error,
  highlight: hl,
  ariaLabel,
  readOnly = false,
  onRun,
  onSelectionChange,
  schema,
  dropdownAutocomplete,
  foreignKeys,
  ghostTextEnabled,
  isVip,
  aiCopilotEnabled,
  onRequireUpgrade,
  onEditorReady,
}: SqlEditorProps) {
  const settings = useSafeSettings();
  // Trang chỉ đọc không gợi ý gì: ghost text AI có thể gọi mạng, mà snapshot không được rời máy.
  const isAutocompleteEnabled = !readOnly && (dropdownAutocomplete ?? settings.dropdownAutocomplete);
  const isGhostTextEnabled = !readOnly && (ghostTextEnabled ?? settings.ghostTextEnabled);
  const isAiCopilotEnabled = !readOnly && (aiCopilotEnabled ?? settings.aiCopilotEnabled);
  const errId = useId();
  const [view, setView] = useState<EditorView | null>(null);
  const doc = useMemo(() => normalize(value), [value]);
  const offset = error && Number.isFinite(error.position) && error.position >= 0 ? toDocOffset(value, error.position) : null;
  const onRunRef = useRef(onRun);
  useEffect(() => {
    onRunRef.current = onRun;
  });

  // Một đường duy nhất đưa nội dung ra ngoài: gõ, dán, undo đều đi qua listener này.
  // Giá trị do React đẩy vào (nạp mẫu, 1-Click Fix) mang nhãn ExternalChange nên không báo ngược ra ngoài.
  const docBridge = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        if (update.transactions.some((tr) => tr.annotation(ExternalChange))) return;
        onChange(update.state.doc.toString());
      }),
    [onChange],
  );

  useEffect(() => {
    view?.dispatch({ effects: setError.of(offset) });
  }, [view, offset]);

  const hFrom = hl ? toDocOffset(value, hl.from) : null;
  const hTo = hl ? toDocOffset(value, hl.to) : null;
  const hNonce = hl?.nonce;
  useEffect(() => {
    if (!view) return;
    const hit = hFrom !== null && hTo !== null ? { from: hFrom, to: hTo } : null;
    view.dispatch({ effects: [setHit.of(hit), ...(hit && hit.from < view.state.doc.length ? [EditorView.scrollIntoView(hit.from, { y: "center" })] : [])] });
  }, [view, hFrom, hTo, hNonce]);

  useEffect(() => {
    if (!view) return;
    const dom = view.dom;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (e.isComposing) return;
        if (onRunRef.current) {
          e.preventDefault();
          e.stopPropagation();
          const sel = view.state.selection.main;
          if (!sel.empty) {
            const selectedText = view.state.sliceDoc(sel.from, sel.to);
            if (selectedText.trim()) {
              onRunRef.current({ targetSql: selectedText, isSelection: true });
              return;
            }
          }
          const docText = view.state.doc.toString();
          const stmt = getStatementAtOffset(docText, sel.head);
          if (stmt && stmt.trim()) {
            onRunRef.current({ targetSql: stmt, isSelection: false });
          } else if (docText.trim()) {
            onRunRef.current({ targetSql: docText, isSelection: false });
          }
        }
      }
    };
    dom.addEventListener("keydown", handleKeyDown, true);
    return () => {
      dom.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [view]);

  const invalid = Boolean(error);
  const autocompleteExt = useMemo(
    () =>
      createSqlAutocompleteExtension({
        schema,
        dialect: DIALECT[engine],
        enabled: isAutocompleteEnabled,
      }),
    [schema, engine, isAutocompleteEnabled]
  );

  const ghostTextExt = useMemo(
    () =>
      createInlineGhostTextExtension({
        tables: schema,
        foreignKeys,
        enabled: isGhostTextEnabled,
      }),
    [schema, foreignKeys, isGhostTextEnabled]
  );

  const aiCopilotExt = useMemo(
    () =>
      createAiCopilotExtension({
        enabled: isAiCopilotEnabled,
        isVip,
        engine,
        schema,
        onRequireUpgrade,
      }),
    [isAiCopilotEnabled, isVip, engine, schema, onRequireUpgrade]
  );

  // Cỡ chữ người dùng chọn, nhưng điện thoại luôn 16px: dưới 16px iOS tự phóng to trang khi
  // focus ô soạn, làm lệch cả bố cục. Ngưỡng 639.98px khớp breakpoint `sm` của Tailwind
  // (640px) nên không có khe hở giữa hai media query.
  const fontSizeTheme = useMemo(
    () =>
      EditorView.theme({
        ".cm-content, .cm-gutters": {
          fontSize: `${settings.fontSize}px !important`,
        },
        "@media (max-width: 639.98px)": {
          ".cm-content, .cm-gutters": {
            fontSize: "16px !important",
          },
        },
      }),
    [settings.fontSize]
  );

  // basicSetup nằm trong danh sách extension (không truyền qua prop riêng) để runtime tab
  // dựng state cho tab mới bằng đúng bộ extension này: vẫn có history, keymap, số dòng.
  const editorSetup = useMemo(
    () =>
      basicSetup({
        foldGutter: false,
        // Snapshot phải đọc được như bản trên màn hình: luôn có số dòng khi chỉ đọc.
        lineNumbers: readOnly ? true : settings.lineNumbers,
        highlightActiveLine: readOnly ? false : settings.highlightActiveLine,
        autocompletion: false,
      }),
    [readOnly, settings.lineNumbers, settings.highlightActiveLine]
  );

  const extensions = useMemo<Extension[]>(
    () => [
      editorSetup,
      // `editable(false)` làm contentDOM mất tabindex, click không focus được nên Ctrl+F và
      // bôi đen bằng bàn phím chết. Giữ tabindex để người nhận vẫn tìm/copy được trong khi không sửa được.
      ...(readOnly
        ? [
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            EditorView.contentAttributes.of({ tabindex: "0" }),
          ]
        : []),
      sql({ dialect: DIALECT[engine], upperCaseKeywords: true }),
      autocompleteExt,
      ghostTextExt,
      aiCopilotExt,
      ...(settings.lineWrapping ? [EditorView.lineWrapping] : []),
      theme,
      fontSizeTheme,
      highlight,
      errorField,
      hitField,
      errorGutter,
      docBridge,
      EditorView.contentAttributes.of({
        "aria-label": ariaLabel,
        "aria-invalid": invalid ? "true" : "false",
        ...(invalid ? { "aria-describedby": errId } : {}),
      }),
    ],
    [
      engine,
      ariaLabel,
      invalid,
      errId,
      autocompleteExt,
      ghostTextExt,
      aiCopilotExt,
      settings.lineWrapping,
      fontSizeTheme,
      editorSetup,
      docBridge,
      readOnly,
    ],
  );

  // Runtime tab đọc danh sách mới nhất khi tạo state cho tab chưa từng mở.
  const extensionsRef = useRef(extensions);
  useEffect(() => {
    extensionsRef.current = extensions;
  }, [extensions]);

  // Viền focus kiểu ring của shadcn/ui vẽ bằng lớp phủ trong khung, nên đủ bốn cạnh, không bị gutter che và không bị khung cha cắt.
  return (
    <div className="relative flex h-full min-h-40 flex-col after:pointer-events-none after:absolute after:inset-0 after:z-10 after:border after:border-ring after:opacity-0 after:ring-3 after:ring-ring/50 after:transition-opacity after:duration-150 after:ring-inset focus-within:after:opacity-100">
      <div className="relative min-h-0 flex-1 [&_.cm-editor]:h-full">
        {/* Bộ mặc định của uiw tắt hẳn: cấu hình nằm ở `editorSetup` trong danh sách extension. */}
        <CodeMirror
          value={doc}
          extensions={extensions}
          theme="none"
          height="100%"
          className="absolute inset-0"
          basicSetup={false}
          onCreateEditor={(nextView) => {
            setView(nextView);
            onEditorReady?.(nextView, () => extensionsRef.current);
          }}
          onUpdate={(update) => {
            if (update.selectionSet || update.docChanged) {
              const sel = update.state.selection.main;
              const has = !sel.empty;
              const txt = has ? update.state.sliceDoc(sel.from, sel.to) : "";
              onSelectionChange?.(has, txt);
            }
          }}
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
