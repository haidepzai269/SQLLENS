import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { createTabCollabExtension, getTabYText } from "./collab-binding";

function bridgeDocs(docA: Y.Doc, docB: Y.Doc): () => void {
  const onA = (update: Uint8Array, origin: unknown) => {
    if (origin !== "bridge-b") {
      Y.applyUpdate(docB, update, "bridge-a");
    }
  };
  const onB = (update: Uint8Array, origin: unknown) => {
    if (origin !== "bridge-a") {
      Y.applyUpdate(docA, update, "bridge-b");
    }
  };
  docA.on("update", onA);
  docB.on("update", onB);
  return () => {
    docA.off("update", onA);
    docB.off("update", onB);
  };
}

describe("collab-binding (CodeMirror 6 + Yjs)", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    while (views.length > 0) {
      views.pop()?.destroy();
    }
  });

  it("AC4.1: getTabYText đặt đúng prefix tab:<id> và đồng bộ thay đổi giữa 2 EditorState/EditorView", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const awarenessA = new Awareness(docA);
    const awarenessB = new Awareness(docB);
    const unbridge = bridgeDocs(docA, docB);

    const textA = getTabYText(docA, "tab-1");
    const textB = getTabYText(docB, "tab-1");
    expect(textA).toBe(docA.getText("tab:tab-1"));

    const stateA = EditorState.create({
      doc: textA.toString(),
      extensions: [createTabCollabExtension(docA, "tab-1", awarenessA)],
    });
    const stateB = EditorState.create({
      doc: textB.toString(),
      extensions: [createTabCollabExtension(docB, "tab-1", awarenessB)],
    });

    const viewA = new EditorView({ state: stateA, parent: document.body });
    const viewB = new EditorView({ state: stateB, parent: document.body });
    views.push(viewA, viewB);

    viewA.dispatch({ changes: { from: 0, insert: "SELECT * FROM orders;" } });

    expect(viewA.state.doc.toString()).toBe("SELECT * FROM orders;");
    expect(textA.toString()).toBe("SELECT * FROM orders;");
    expect(textB.toString()).toBe("SELECT * FROM orders;");
    expect(viewB.state.doc.toString()).toBe("SELECT * FROM orders;");

    unbridge();
    (awarenessA as Awareness & { destroy?: () => void }).destroy?.();
    (awarenessB as Awareness & { destroy?: () => void }).destroy?.();
  });

  it("AC4.2: UndoManager của tab 1 không hoàn tác thay đổi của tab 2", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const text1 = getTabYText(doc, "tab-1");
    const text2 = getTabYText(doc, "tab-2");
    const undo1 = new Y.UndoManager(text1);
    const undo2 = new Y.UndoManager(text2);

    const view1 = new EditorView({
      state: EditorState.create({
        doc: text1.toString(),
        extensions: [createTabCollabExtension(doc, "tab-1", awareness, { undoManager: undo1 })],
      }),
      parent: document.body,
    });
    const view2 = new EditorView({
      state: EditorState.create({
        doc: text2.toString(),
        extensions: [createTabCollabExtension(doc, "tab-2", awareness, { undoManager: undo2 })],
      }),
      parent: document.body,
    });
    views.push(view1, view2);

    view1.dispatch({ changes: { from: 0, insert: "SELECT 1;" } });
    view2.dispatch({ changes: { from: 0, insert: "SELECT 2;" } });

    expect(text1.toString()).toBe("SELECT 1;");
    expect(text2.toString()).toBe("SELECT 2;");

    undo1.undo();

    expect(text1.toString()).toBe("");
    expect(view1.state.doc.toString()).toBe("");
    expect(text2.toString()).toBe("SELECT 2;");
    expect(view2.state.doc.toString()).toBe("SELECT 2;");

    (awareness as Awareness & { destroy?: () => void }).destroy?.();
  });

  it("AC4.3: chế độ readOnly: true (viewer) chặn sửa cục bộ nhưng vẫn nhận cập nhật từ xa", () => {
    const docEditor = new Y.Doc();
    const docViewer = new Y.Doc();
    const awarenessEditor = new Awareness(docEditor);
    const awarenessViewer = new Awareness(docViewer);
    const unbridge = bridgeDocs(docEditor, docViewer);

    const editorView = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [createTabCollabExtension(docEditor, "tab-ro", awarenessEditor)],
      }),
      parent: document.body,
    });

    const viewerState = EditorState.create({
      doc: "",
      extensions: [
        createTabCollabExtension(docViewer, "tab-ro", awarenessViewer, { readOnly: true }),
      ],
    });
    expect(viewerState.readOnly).toBe(true);

    const viewerView = new EditorView({
      state: viewerState,
      parent: document.body,
    });
    views.push(editorView, viewerView);

    // Chỉnh sửa trực tiếp trên EditorState và EditorView của viewer đều phải bị chặn
    const blockedStateTr = viewerState.update({
      changes: { from: 0, insert: "DROP TABLE users;" },
    });
    expect(blockedStateTr.state.doc.toString()).toBe("");

    viewerView.dispatch({ changes: { from: 0, insert: "DELETE FROM users;" } });
    expect(viewerView.state.doc.toString()).toBe("");
    expect(getTabYText(docEditor, "tab-ro").toString()).toBe("");

    // Nhưng cập nhật từ xa của editor vẫn đồng bộ sang viewer
    editorView.dispatch({ changes: { from: 0, insert: "SELECT id FROM users;" } });
    expect(viewerView.state.doc.toString()).toBe("SELECT id FROM users;");

    unbridge();
    (awarenessEditor as Awareness & { destroy?: () => void }).destroy?.();
    (awarenessViewer as Awareness & { destroy?: () => void }).destroy?.();
  });

  it("Ca biên: getTabYText từ chối tabId rỗng", () => {
    const doc = new Y.Doc();
    expect(() => getTabYText(doc, "")).toThrow("tabId is required");
  });
});
