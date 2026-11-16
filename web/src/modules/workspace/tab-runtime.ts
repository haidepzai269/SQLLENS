"use client";

// Runtime của thanh tab: giữ ĐÚNG MỘT CodeMirror view cho cả workspace.
// Chuyển tab chỉ đổi EditorState (tài liệu + lịch sử undo + vị trí con trỏ của riêng tab đó),
// không dựng lại view, không đụng tới worker PGlite/MySQL đang chạy.
// Không gửi gì lên server (Core Rule 7).

import { EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { StatementKind } from "@/modules/sql-intake/parser/types";
import { useWorkspaceStore } from "./store";

export interface TabRuntimeOptions {
  view: EditorView;
  /** Toàn bộ extension của editor, dùng để tạo state mới giống hệt state đầu tiên. */
  getExtensions: () => Extension[];
}

export interface TabRuntime {
  /** Đổi tài liệu của view sang tab khác, giữ nguyên view và sandbox. */
  switchTab: (tabId: string) => void;
  /** Tab đang giữ state trong view (null khi chưa có tab nào). */
  activeTabId: () => string | null;
  /** Số state đang được giữ, chỉ dùng cho test. */
  cachedTabCount: () => number;
  dispose: () => void;
}

/**
 * Một view, nhiều state. Mỗi tab có EditorState riêng nên `Ctrl+Z` chỉ lùi được
 * thao tác của chính tab đó — dùng chung một state thì undo sẽ kéo nội dung tab khác sang.
 */
export function createTabRuntime({ view, getExtensions }: TabRuntimeOptions): TabRuntime {
  const states = new Map<string, EditorState>();
  let activeId = useWorkspaceStore.getState().activeTabId;

  const syncDoc = (sql: string) => {
    if (view.state.doc.toString() === sql) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: sql },
      // Nội dung đến từ store, không phải người dùng gõ: không đưa vào lịch sử undo.
      annotations: Transaction.addToHistory.of(false),
    });
  };

  if (activeId) {
    states.set(activeId, view.state);
    // View vừa dựng có thể mang tài liệu khác tab đang mở: đưa về đúng nội dung của tab đó.
    const initial = useWorkspaceStore.getState().tabs.find((t) => t.id === activeId);
    if (initial) syncDoc(initial.sql);
  }

  const switchTab = (tabId: string) => {
    if (!view.dom.isConnected) return;
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
    if (!tab || tabId === activeId) {
      // Tab đang mở vẫn có thể bị ghi đè từ ngoài (nạp mẫu, 1-Click Fix).
      if (tab) syncDoc(tab.sql);
      return;
    }

    // Chỉ lưu lại state của tab còn tồn tại: tab vừa bị đóng thì bỏ hẳn.
    if (activeId && states.has(activeId)) states.set(activeId, view.state);

    const next = states.get(tabId) ?? EditorState.create({ doc: tab.sql, extensions: getExtensions() });
    view.setState(next);
    syncDoc(tab.sql);

    activeId = tabId;
    states.set(tabId, view.state);
  };

  const unsubscribe = useWorkspaceStore.subscribe((state, prev) => {
    // View đã bị uiw destroy (rời trang): tự gỡ, không giữ state của tab đã đóng.
    if (!view.dom.isConnected) {
      unsubscribe();
      return;
    }
    for (const id of states.keys()) {
      if (!state.tabs.some((t) => t.id === id)) states.delete(id);
    }
    if (state.activeTabId !== prev.activeTabId) {
      if (state.activeTabId) switchTab(state.activeTabId);
      else activeId = null;
    }
  });

  return {
    switchTab,
    activeTabId: () => activeId,
    cachedTabCount: () => states.size,
    dispose: () => {
      unsubscribe();
      states.clear();
      activeId = null;
    },
  };
}

/** Các loại câu lệnh làm đổi schema của sandbox. */
const SCHEMA_CHANGING_KINDS: ReadonlySet<StatementKind> = new Set<StatementKind>([
  "create_table",
  "alter_table",
  "create_index",
  "drop",
]);

/** Chỉ dựa trên câu lệnh parser nhận ra là DDL, không đoán theo chuỗi. */
export function changesSchema(statements: ReadonlyArray<{ kind: StatementKind }>): boolean {
  return statements.some((s) => SCHEMA_CHANGING_KINDS.has(s.kind));
}

/** Đăng ký view đã sẵn sàng, trả cho lab-workspace một prop duy nhất. */
export function useTabRuntime(): {
  onEditorReady: (view: EditorView, getExtensions: () => Extension[]) => void;
} {
  const runtime = useRef<TabRuntime | null>(null);

  const onEditorReady = useCallback((view: EditorView, getExtensions: () => Extension[]) => {
    runtime.current?.dispose();
    runtime.current = createTabRuntime({ view, getExtensions });
  }, []);

  return { onEditorReady };
}

// ---------------------------------------------------------------------------
// Thông báo schema vừa đổi: chỉ phát khi có câu lệnh DDL/reset thật vừa chạy xong,
// nên đây là sự kiện "Thật", không phải suy đoán.
// ---------------------------------------------------------------------------

export type SchemaChangeKind = "ddl" | "reset";

export interface SchemaChangedEvent {
  sourceTabId: string;
  kind: SchemaChangeKind;
  seq: number;
}

export const SCHEMA_NOTICE_MS = 5000;

let schemaEvent: SchemaChangedEvent | null = null;
let schemaSeq = 0;
const schemaListeners = new Set<() => void>();

const emitSchema = () => {
  for (const listener of schemaListeners) listener();
};

/** Tab nguồn không nhận thông báo của chính nó; các tab còn lại sẽ thấy. */
export function notifySchemaChanged(sourceTabId: string, kind: SchemaChangeKind): void {
  schemaEvent = { sourceTabId, kind, seq: ++schemaSeq };
  emitSchema();
}

export function dismissSchemaChangedNotice(): void {
  if (!schemaEvent) return;
  schemaEvent = null;
  emitSchema();
}

/** Chỉ dùng cho test. */
export function currentSchemaChangedEvent(): SchemaChangedEvent | null {
  return schemaEvent;
}

const subscribeSchema = (listener: () => void) => {
  schemaListeners.add(listener);
  return () => {
    schemaListeners.delete(listener);
  };
};

const noEvent = () => null;

export interface SchemaChangedNotice {
  message: string | null;
  sourceTabId: string | null;
  dismiss: () => void;
  showSource: () => void;
}

export function useSchemaChangedNotice(): SchemaChangedNotice {
  const t = useTranslations("workspace");
  const event = useSyncExternalStore(subscribeSchema, currentSchemaChangedEvent, noEvent);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);

  const source = event ? tabs.find((tab) => tab.id === event.sourceTabId) : undefined;
  // Tab nguồn (hoặc tab đã bị đóng) thì không hiện: thông báo chỉ có nghĩa với tab khác.
  const visible = Boolean(event && source && activeTabId !== event.sourceTabId);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(dismissSchemaChangedNotice, SCHEMA_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [visible, event?.seq]);

  const showSource = useCallback(() => {
    if (!event) return;
    const state = useWorkspaceStore.getState();
    const tab = state.tabs.find((item) => item.id === event.sourceTabId);
    if (!tab) return;
    state.setActiveProject(tab.projectId);
    useWorkspaceStore.setState({ activeTabId: tab.id });
  }, [event]);

  if (!event || !source || !visible) {
    return { message: null, sourceTabId: null, dismiss: dismissSchemaChangedNotice, showSource };
  }

  return {
    message: t(event.kind === "ddl" ? "schemaNotice.ddl" : "schemaNotice.reset", { tab: source.name }),
    sourceTabId: source.id,
    dismiss: dismissSchemaChangedNotice,
    showSource,
  };
}
