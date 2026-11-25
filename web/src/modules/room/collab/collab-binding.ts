import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { yCollab, ySyncAnnotation } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

export interface TabCollabExtensionOptions {
  /** Viewer chỉ xem: khóa sửa cục bộ nhưng vẫn nhận cập nhật từ xa qua Yjs. */
  readOnly?: boolean;
  /** Cho phép truyền UndoManager riêng; mặc định tạo mới theo từng tab để tách lịch sử Ctrl+Z. */
  undoManager?: Y.UndoManager;
}

const readOnlyCollabFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  // Chỉ cho phép thay đổi đến từ Yjs remote observer (mang ySyncAnnotation).
  if (tr.annotation(ySyncAnnotation) !== undefined) return tr;
  return [];
});

/** Trả về Y.Text gắn với đúng tab trong Y.Doc dùng chung của phòng. */
export function getTabYText(doc: Y.Doc, tabId: string): Y.Text {
  if (!tabId) {
    throw new Error("tabId is required");
  }
  return doc.getText(`tab:${tabId}`);
}

/**
 * Tạo extension CodeMirror 6 đồng bộ Yjs cho một tab cụ thể.
 * Mỗi tab giữ một Y.UndoManager riêng trên `tab:<tabId>` để Undo không ảnh hưởng tab khác.
 */
export function createTabCollabExtension(
  doc: Y.Doc,
  tabId: string,
  awareness: Awareness,
  options: TabCollabExtensionOptions = {},
): Extension {
  const yText = getTabYText(doc, tabId);
  const undoManager = options.readOnly
    ? false
    : (options.undoManager ?? new Y.UndoManager(yText));

  const extensions: Extension[] = [
    yCollab(yText, awareness, { undoManager }),
  ];

  if (options.readOnly) {
    extensions.push(
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      readOnlyCollabFilter,
    );
  }

  return extensions;
}
