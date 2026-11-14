/**
 * Copyright (c) 2026 SQLLens
 * CodeMirror 6 AI Copilot Multi-line Ghost Text Extension.
 * Provides deep completion for VIP users with smart triggers (Comment, Debounce 600ms, Ctrl+Space).
 * Renders multi-line ghost text after cursor.
 * Handles Tab to accept, Escape to dismiss, and aborts in-flight requests on typing.
 */

import {
  Facet,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type Text,
} from "@codemirror/state";
import { completionStatus } from "@codemirror/autocomplete";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
  type DecorationSet,
  type KeyBinding,
} from "@codemirror/view";
import type { EngineId } from "@/contracts/engine";
import {
  fetchAiInlineCompletion,
  type FetchAiInlineCompletionParams,
  type InlineCompletionResult,
} from "@/modules/vip/api/copilot-client";
import { clearGhostTextEffect, ghostTextField } from "./inline-ghost-text";

export interface AiCopilotOptions {
  enabled?: boolean; // Mặc định false (đọc từ Settings)
  isVip?: boolean; // Mặc định false
  engine?: EngineId;
  schema?: Record<string, string[]>;
  onRequireUpgrade?: () => void;
  debounceMs?: number; // Mặc định 600ms
  fetchCompletion?: (params: FetchAiInlineCompletionParams) => Promise<InlineCompletionResult | null>;
}

export interface AiGhostText {
  text: string;
  from: number;
}

export const clearAiGhostTextEffect = StateEffect.define<void>();
export const setAiGhostTextEffect = StateEffect.define<AiGhostText | null>();

/**
 * Class widget render đoạn mã AI gợi ý nhiều dòng (Multi-line Ghost Text) màu xám mờ nối tiếp con trỏ.
 * Mang class CSS thẩm mỹ: opacity-40 select-none pointer-events-none text-muted-foreground font-mono whitespace-pre inline.
 */
export class AiGhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className =
      "opacity-40 select-none pointer-events-none text-muted-foreground font-mono whitespace-pre inline";
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  eq(other: AiGhostTextWidget): boolean {
    return this.text === other.text;
  }
}

/**
 * Facet lưu trữ cấu hình AI Copilot để StateField và ViewPlugin truy cập động.
 */
export const aiCopilotConfigFacet = Facet.define<AiCopilotOptions, AiCopilotOptions>({
  combine(values) {
    return values[values.length - 1] ?? {};
  },
});

/**
 * StateField quản lý trạng thái AI Ghost Text hiện tại.
 */
export const aiGhostTextField = StateField.define<AiGhostText | null>({
  create() {
    return null;
  },
  update(value, tr) {
    // 1. Explicit effects (clear hoặc set)
    for (const e of tr.effects) {
      if (e.is(clearAiGhostTextEffect)) {
        return null;
      }
      if (e.is(setAiGhostTextEffect)) {
        return e.value;
      }
    }

    const sel = tr.state.selection.main;
    // 2. Con trỏ có vùng bôi đen (không rỗng) -> hủy bỏ ngay lập tức
    if (!sel.empty) {
      return null;
    }

    // 3. Nếu tài liệu thay đổi nội dung -> tự động hủy bỏ gợi ý AI cũ
    if (tr.docChanged) {
      return null;
    }

    // 4. Nếu con trỏ di chuyển sang vị trí khác (bằng phím mũi tên hoặc chuột) -> hủy bỏ
    if (!tr.newSelection.eq(tr.startState.selection)) {
      return null;
    }

    return value;
  },
});

/**
 * StateField cung cấp decorations hiển thị AiGhostTextWidget sau con trỏ.
 */
export const aiGhostTextDecorations = StateField.define<DecorationSet>({
  create(state) {
    // Triệt tiêu xung đột: nếu Local Ghost Text đang hiển thị, không render AI Ghost Text (chống đè widget)
    const localGhost = state.field(ghostTextField, false);
    if (localGhost && localGhost.text) return Decoration.none;

    const ghost = state.field(aiGhostTextField, false);
    if (!ghost || !ghost.text) return Decoration.none;
    return Decoration.set([
      Decoration.widget({
        widget: new AiGhostTextWidget(ghost.text),
        side: 1,
      }).range(ghost.from),
    ]);
  },
  update(_deco, tr) {
    // Triệt tiêu xung đột: nếu Local Ghost Text đang hiển thị, không render AI Ghost Text (chống đè widget)
    const localGhost = tr.state.field(ghostTextField, false);
    if (localGhost && localGhost.text) return Decoration.none;

    const ghost = tr.state.field(aiGhostTextField, false);
    if (!ghost || !ghost.text) return Decoration.none;
    return Decoration.set([
      Decoration.widget({
        widget: new AiGhostTextWidget(ghost.text),
        side: 1,
      }).range(ghost.from),
    ]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Trích xuất lát cắt tối đa 20 dòng trước con trỏ (prefix) và tối đa 5 dòng sau con trỏ (suffix).
 */
export function extractContext(doc: Text, pos: number): { prefix: string; suffix: string } {
  const line = doc.lineAt(pos);
  const startLineNum = Math.max(1, line.number - 20);
  const startLine = doc.line(startLineNum);
  const prefix = doc.sliceString(startLine.from, pos);

  const endLineNum = Math.min(doc.lines, line.number + 5);
  const endLine = doc.line(endLineNum);
  const suffix = doc.sliceString(pos, endLine.to);

  return { prefix, suffix };
}

/**
 * Kiểm tra Smart Trigger 1 (Comment Trigger):
 * Dòng vừa gõ bắt đầu bằng `-- ` và người dùng vừa nhấn Enter xuống dòng (con trỏ ở đầu dòng mới,
 * dòng ngay trước bắt đầu bằng `-- ` và có text ý đồ).
 */
export function isCommentTrigger(doc: Text, pos: number): boolean {
  const line = doc.lineAt(pos);
  // Cần ít nhất dòng thứ 2 trở đi
  if (line.number <= 1) return false;

  // Dòng hiện tại phải rỗng hoặc chỉ chứa khoảng trắng thụt lề
  if (line.text.trim().length > 0) return false;

  // Dòng ngay trước đó bắt đầu bằng comment SQL (`-- `)
  const prevLine = doc.line(line.number - 1);
  const prevTrim = prevLine.text.trim();
  if (prevTrim.startsWith("--")) {
    const commentBody = prevTrim.replace(/^--\s*/, "").trim();
    return commentBody.length > 0;
  }
  return false;
}

/**
 * Kiểm tra Smart Trigger 2 (Debounce Trigger):
 * Prefix không rỗng và chưa kết thúc bằng dấu chấm phẩy `;`.
 */
export function isDebounceTrigger(prefix: string): boolean {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.endsWith(";")) return false;
  return true;
}

/**
 * Chuyển đổi schema object sang định dạng chuỗi rút gọn gửi kèm cho LLM.
 */
export function formatSchemaSnippet(schema?: Record<string, string[]>): string {
  if (!schema) return "";
  const parts: string[] = [];
  for (const [table, cols] of Object.entries(schema)) {
    if (Array.isArray(cols)) {
      parts.push(`${table}(${cols.join(", ")})`);
    }
  }
  const result = parts.join("; ");
  return result.length > 2000 ? result.slice(0, 2000) : result;
}

/**
 * ViewPlugin quản lý lifecycle của debounce timer và abort controller gọi API bất đồng bộ.
 */
export class AiCopilotPluginValue {
  private abortController: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly view: EditorView) {}

  abortInFlight(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  clearTimer(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  triggerFetch(immediate = false): void {
    this.clearTimer();
    this.abortInFlight();

    // Nếu Local Ghost Text đang có gợi ý (0ms Heuristics), không gọi AI Copilot
    const localGhost = this.view.state.field(ghostTextField, false);
    if (localGhost && localGhost.text) {
      return;
    }

    const config = this.view.state.facet(aiCopilotConfigFacet);
    if (config.enabled === false || !config.isVip) {
      return;
    }

    const sel = this.view.state.selection.main;
    if (!sel.empty) return;

    const pos = sel.head;
    const doc = this.view.state.doc;
    const { prefix, suffix } = extractContext(doc, pos);

    // Nếu không có nội dung prefix gì, không cần fetch
    if (prefix.trim().length === 0) {
      return;
    }

    const runFetch = async () => {
      const controller = new AbortController();
      this.abortController = controller;

      const fetchFn = config.fetchCompletion ?? fetchAiInlineCompletion;
      const schemaSnippet = formatSchemaSnippet(config.schema);

      try {
        const res = await fetchFn({
          prefix,
          suffix,
          engine: config.engine,
          schemaSnippet,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        // Nếu tại thời điểm API trả về mà Local Ghost Text đã xuất hiện, hủy bỏ không set AI
        const currentLocal = this.view.state.field(ghostTextField, false);
        if (currentLocal && currentLocal.text) {
          return;
        }

        // Đảm bảo con trỏ của view vẫn ở đúng vị trí `pos` và không có vùng bôi đen
        if (
          res?.completion &&
          res.completion.trim().length > 0 &&
          this.view.state.selection.main.head === pos &&
          this.view.state.selection.main.empty
        ) {
          this.view.dispatch({
            effects: setAiGhostTextEffect.of({
              text: res.completion,
              from: pos,
            }),
          });
        }
      } catch {
        // Safe fallback - không làm đơ hay crash editor
      } finally {
        if (this.abortController === controller) {
          this.abortController = null;
        }
      }
    };

    if (immediate) {
      void runFetch();
    } else {
      const delay = config.debounceMs ?? 600;
      this.debounceTimer = setTimeout(() => {
        void runFetch();
      }, delay);
    }
  }

  update(update: ViewUpdate): void {
    // 1. Khi có thao tác gõ hoặc đổi selection: Hủy request đang bay và timer
    if (update.docChanged || update.selectionSet) {
      this.abortInFlight();
      this.clearTimer();
    }

    // 2. Cơ chế triệt tiêu: Nếu Local Ghost Text đang có gợi ý (0ms Heuristics)
    // Hủy bỏ debounce timer và abort request in-flight ngay lập tức, không gửi API vô ích
    const localGhost = update.state.field(ghostTextField, false);
    if (localGhost && localGhost.text) {
      this.abortInFlight();
      this.clearTimer();
      return;
    }

    // Không làm gì nếu tài liệu không thay đổi
    if (!update.docChanged) {
      return;
    }

    const config = update.state.facet(aiCopilotConfigFacet);
    if (config.enabled === false || !config.isVip) {
      return;
    }

    const sel = update.state.selection.main;
    if (!sel.empty) return;

    const pos = sel.head;
    const doc = update.state.doc;

    // 2. Smart Trigger 1: Comment Trigger (vừa nhấn Enter xuống dòng sau comment)
    if (isCommentTrigger(doc, pos)) {
      this.triggerFetch(true);
      return;
    }

    // 3. Smart Trigger 2: Debounce Trigger 600ms
    const { prefix } = extractContext(doc, pos);
    if (isDebounceTrigger(prefix)) {
      this.triggerFetch(false);
    }
  }

  destroy(): void {
    this.clearTimer();
    this.abortInFlight();
  }
}

export const aiCopilotPlugin = ViewPlugin.fromClass(AiCopilotPluginValue);

/**
 * Chấp nhận (Accept) gợi ý AI Ghost Text khi người dùng nhấn phím Tab.
 * Chèn trọn vẹn khối mã vào tài liệu tại `from` và đưa con trỏ đến cuối khối vừa chèn.
 */
export function acceptAiGhostText(view: EditorView): boolean {
  try {
    // 1. Nhường quyền cho Dropdown Popup khi popup autocomplete đang active
    if (completionStatus(view.state) === "active") {
      return false;
    }

    // 2. Thứ tự ưu tiên: Nhường quyền cho Local Ghost Text nếu Local đang có gợi ý
    const localGhost = view.state.field(ghostTextField, false);
    if (localGhost && localGhost.text) {
      return false;
    }

    // 3. Xử lý AI Ghost Text
    const ghost = view.state.field(aiGhostTextField, false);
    if (!ghost || !ghost.text) {
      return false;
    }
    view.dispatch({
      changes: { from: ghost.from, insert: ghost.text },
      selection: { anchor: ghost.from + ghost.text.length },
      effects: clearAiGhostTextEffect.of(),
      userEvent: "input.complete",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Hủy bỏ (Dismiss) gợi ý AI Ghost Text khi người dùng nhấn phím Escape.
 * Đồng thời dọn dẹp sạch sẽ cả Local Ghost Text nếu có.
 */
export function dismissAiGhostText(view: EditorView): boolean {
  try {
    const aiGhost = view.state.field(aiGhostTextField, false);
    const localGhost = view.state.field(ghostTextField, false);

    const hasAi = Boolean(aiGhost && aiGhost.text);
    const hasLocal = Boolean(localGhost && localGhost.text);

    if (!hasAi && !hasLocal) {
      return false;
    }

    const effects = [];
    if (hasAi) {
      effects.push(clearAiGhostTextEffect.of());
    }
    if (hasLocal) {
      effects.push(clearGhostTextEffect.of());
    }

    view.dispatch({ effects });
    return true;
  } catch {
    return false;
  }
}

/**
 * Kích hoạt thủ công (Manual Trigger) khi người dùng nhấn Ctrl+Space hoặc Cmd+I.
 * - Nếu không phải VIP: Kích hoạt onRequireUpgrade() để hiển thị modal nâng cấp.
 * - Nếu là VIP: Kích hoạt gọi AI Copilot ngay lập tức.
 */
export function triggerManualAiCopilot(view: EditorView): boolean {
  const config = view.state.facet(aiCopilotConfigFacet);

  if (!config.isVip) {
    config.onRequireUpgrade?.();
    return true;
  }

  const plugin = view.plugin(aiCopilotPlugin);
  if (plugin) {
    plugin.triggerFetch(true);
  }
  return true;
}

export const aiCopilotKeymap: KeyBinding[] = [
  {
    key: "Tab",
    run: acceptAiGhostText,
  },
  {
    key: "Escape",
    run: dismissAiGhostText,
  },
  {
    key: "Mod-Space",
    run: triggerManualAiCopilot,
  },
  {
    key: "Ctrl-Space",
    run: triggerManualAiCopilot,
  },
  {
    key: "Mod-i",
    run: triggerManualAiCopilot,
  },
];

/**
 * Khởi tạo Extension CodeMirror 6 cho AI Copilot.
 * - Khi `enabled === false`: trả về `[]` (zero overhead).
 * - Khi `enabled !== false`: nạp config facet, state field, decorations, view plugin và keymap ưu tiên cao.
 */
export function createAiCopilotExtension(options: AiCopilotOptions = {}): Extension {
  if (options.enabled === false) {
    return [];
  }

  return [
    aiCopilotConfigFacet.of(options),
    aiGhostTextField,
    aiGhostTextDecorations,
    aiCopilotPlugin,
    Prec.highest(keymap.of(aiCopilotKeymap)),
  ];
}
