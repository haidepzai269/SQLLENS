"use client";

import dynamic from "next/dynamic";
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
};

// Skeleton cùng chiều cao tối thiểu với ô thật để trang không nhảy khi tải xong.
export const SqlEditor = dynamic<SqlEditorProps>(() => import("./sql-editor-impl"), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-40 w-full rounded-none" aria-hidden />,
});
