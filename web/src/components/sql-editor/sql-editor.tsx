"use client";

import dynamic from "next/dynamic";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Skeleton } from "@/components/ui/skeleton";
import type { EngineId } from "@/contracts/engine";
import type { ForeignKeyRelation } from "@/modules/editor/heuristics/types";

export type RunScopeOptions = {
  targetSql?: string;
  isSelection?: boolean;
};

export type SqlEditorProps = {
  value: string;
  onChange: (v: string) => void;
  engine: EngineId;
  /** position đếm từ 0 trên `value`; lớn hơn độ dài thì tô ký tự cuối. */
  error?: { position: number; message: string };
  /** Tô khoảng [from, to) đếm từ 0 trên `value` và cuộn tới đó; `nonce` đổi thì cuộn lại. */
  highlight?: { from: number; to: number; nonce: number };
  ariaLabel: string;
  /**
   * Chế độ chỉ đọc: không gõ/sửa được, tắt autocomplete + ghost text + AI, luôn hiện số dòng.
   * Trang /share dùng chế độ này để người nhận xem snapshot mà không sửa vào bản gốc.
   */
  readOnly?: boolean;
  /** Kích hoạt khi người dùng nhấn Ctrl+Enter hoặc Cmd+Enter. */
  onRun?: (options?: RunScopeOptions) => void;
  /** Kích hoạt khi vùng bôi đen (selection) thay đổi. */
  onSelectionChange?: (hasSelection: boolean, selectedText: string) => void;
  /** Schema CSDL hiện tại dạng { [tableName]: string[] } dùng cho gợi ý dropdown autocomplete. */
  schema?: Record<string, string[]>;
  /** Bật/tắt gợi ý dropdown autocomplete. Nếu không truyền, đọc fallback từ useSettings(). */
  dropdownAutocomplete?: boolean;
  /** Danh sách quan hệ khóa ngoại CSDL dùng cho gợi ý FK JOIN inline ghost text. */
  foreignKeys?: ForeignKeyRelation[];
  /** Bật/tắt gợi ý viết tiếp mờ xám (inline ghost text). Nếu không truyền, đọc fallback từ useSettings(). */
  ghostTextEnabled?: boolean;
  /** Tài khoản có đặc quyền VIP hay không. */
  isVip?: boolean;
  /** Bật/tắt tính năng AI Copilot. Nếu không truyền, đọc fallback từ useSettings(). */
  aiCopilotEnabled?: boolean;
  /** Callback khi người dùng chưa nâng cấp VIP kích hoạt AI Copilot. */
  onRequireUpgrade?: () => void;
  /**
   * View CodeMirror vừa dựng xong, kèm hàm trả về danh sách extension hiện tại.
   * Runtime tab dùng để dựng state riêng cho từng tab trên cùng một view.
   */
  onEditorReady?: (view: EditorView, getExtensions: () => Extension[]) => void;
  /** Extension đồng bộ Yjs theo từng tab (tùy chọn); gắn/gỡ động qua Compartment không dựng lại EditorView. */
  collabExtension?: Extension | null;
};

// Skeleton cùng chiều cao tối thiểu với ô thật để trang không nhảy khi tải xong.
export const SqlEditor = dynamic<SqlEditorProps>(() => import("./sql-editor-impl"), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-40 w-full rounded-none" aria-hidden />,
});
