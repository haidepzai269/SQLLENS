import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, cleanup, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import viWorkspace from "../../../messages/vi/workspace.json";
import { useWorkspaceStore } from "./store";
import {
  SCHEMA_NOTICE_MS,
  changesSchema,
  createTabRuntime,
  dismissSchemaChangedNotice,
  notifySchemaChanged,
  useSchemaChangedNotice,
  useTabRuntime,
  type TabRuntime,
} from "./tab-runtime";
import type { WorkspaceTab } from "./types";

const view_bridge = (): Extension =>
  EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const state = useWorkspaceStore.getState();
    if (state.activeTabId) state.updateTabSql(state.activeTabId, update.state.doc.toString());
  });

const type = (view: EditorView, text: string) => {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
};

describe("Tab Runtime (Task126)", () => {
  let view: EditorView | null = null;
  let runtime: TabRuntime | null = null;
  let extensions: Extension[] = [];

  const makeProject = () => {
    useWorkspaceStore.getState().reset();
    const project = useWorkspaceStore.getState().createProject({ name: "Dự án", engine: "postgres" });
    return project;
  };

  const setup = (tabs: WorkspaceTab[]) => {
    extensions = [history(), view_bridge()];
    view = new EditorView({
      state: EditorState.create({ doc: tabs[0].sql, extensions }),
      parent: document.body,
    });
    runtime = createTabRuntime({ view, getExtensions: () => extensions });
  };

  beforeEach(() => {
    useWorkspaceStore.getState().reset();
  });

  afterEach(() => {
    runtime?.dispose();
    view?.destroy();
    runtime = null;
    view = null;
    dismissSchemaChangedNotice();
    useWorkspaceStore.getState().reset();
    cleanup();
    vi.useRealTimers();
  });

  it("AC1: giữ đúng một view, chuyển 5 tab không dựng lại gì và dưới 50ms mỗi lần", () => {
    const project = makeProject();
    const tabs = [useWorkspaceStore.getState().createTab(project.id, "Tab 1")];
    for (let i = 2; i <= 5; i++) tabs.push(useWorkspaceStore.getState().createTab(project.id, `Tab ${i}`));
    setup(tabs);

    const original = view!;
    const durations: number[] = [];

    for (const tab of [tabs[1], tabs[2], tabs[3], tabs[4], tabs[0]]) {
      const started = performance.now();
      act(() => {
        runtime!.switchTab(tab.id);
      });
      durations.push(performance.now() - started);
      expect(view).toBe(original);
      expect(runtime!.activeTabId()).toBe(tab.id);
    }

    // Một view duy nhất: không có editor thứ hai nào được dựng.
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(runtime!.cachedTabCount()).toBe(5);
    expect(Math.max(...durations)).toBeLessThan(50);
  });

  it("AC4: Undo ở mỗi tab chỉ lùi nội dung của chính tab đó", () => {
    const project = makeProject();
    const tabA = useWorkspaceStore.getState().createTab(project.id, "Tab A");
    const tabB = useWorkspaceStore.getState().createTab(project.id, "Tab B");
    setup([tabA, tabB]);

    // Đang ở Tab A (tab cuối được tạo là tab active).
    useWorkspaceStore.setState({ activeTabId: tabA.id });
    type(view!, "SELECT 'a';");
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === tabA.id)?.sql).toBe("SELECT 'a';");

    // Sang Tab B, gõ rồi Ctrl+Z: chỉ Tab B lùi.
    act(() => {
      useWorkspaceStore.setState({ activeTabId: tabB.id });
    });
    expect(view!.state.doc.toString()).toBe("");
    type(view!, "SELECT 'b';");
    undo(view!);
    expect(view!.state.doc.toString()).toBe("");
    undo(view!);
    // Không được kéo nội dung của Tab A sang Tab B.
    expect(view!.state.doc.toString()).toBe("");
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === tabB.id)?.sql).toBe("");

    // Quay lại Tab A: nội dung và lịch sử riêng vẫn còn.
    act(() => {
      runtime!.switchTab(tabA.id);
    });
    expect(view!.state.doc.toString()).toBe("SELECT 'a';");
    undo(view!);
    expect(view!.state.doc.toString()).toBe("");
  });

  it("AC2: mỗi tab giữ tài liệu riêng, không cần dựng lại sandbox khi đổi tab", () => {
    const project = makeProject();
    const tabA = useWorkspaceStore.getState().createTab(project.id, "Tab A");
    const tabB = useWorkspaceStore.getState().createTab(project.id, "Tab B");
    setup([tabA, tabB]);

    useWorkspaceStore.setState({ activeTabId: tabA.id });
    type(view!, "CREATE TABLE t (id int);");
    act(() => {
      useWorkspaceStore.setState({ activeTabId: tabB.id });
    });
    type(view!, "SELECT * FROM t;");

    expect(view!.state.doc.toString()).toBe("SELECT * FROM t;");
    act(() => {
      runtime!.switchTab(tabA.id);
    });
    expect(view!.state.doc.toString()).toBe("CREATE TABLE t (id int);");
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(1);
  });

  it("Ca biên: đóng tab đang mở thì state của tab đó bị dọn khỏi bộ nhớ", () => {
    const project = makeProject();
    const tabA = useWorkspaceStore.getState().createTab(project.id, "Tab A");
    const tabB = useWorkspaceStore.getState().createTab(project.id, "Tab B");
    setup([tabA, tabB]);
    expect(runtime!.cachedTabCount()).toBe(1);

    act(() => {
      useWorkspaceStore.getState().closeTab(tabB.id);
    });

    expect(runtime!.activeTabId()).toBe(tabA.id);
    expect(runtime!.cachedTabCount()).toBe(1);
    expect(view!.state.doc.toString()).toBe("");
  });

  it("Settings/engine đổi thì tab đã từng mở được cấu hình lại, không sống dậy với cấu hình cũ", () => {
    const project = makeProject();
    const tabA = useWorkspaceStore.getState().createTab(project.id, "Tab A");
    const tabB = useWorkspaceStore.getState().createTab(project.id, "Tab B");

    extensions = [
      history(),
      view_bridge(),
      EditorView.contentAttributes.of({ "data-editor-config": "old" }),
    ];
    view = new EditorView({ state: EditorState.create({ doc: tabA.sql, extensions }), parent: document.body });
    runtime = createTabRuntime({ view, getExtensions: () => extensions });

    // Tab B mở lần đầu: state của nó được dựng bằng cấu hình cũ, rồi quay về Tab A.
    act(() => runtime!.switchTab(tabB.id));
    act(() => runtime!.switchTab(tabA.id));

    // Người dùng đổi settings (cỡ chữ/số dòng/ngắt dòng) hoặc engine: uiw cấu hình lại
    // view đang mở, nhưng state đã cache của Tab B vẫn mang bộ extension cũ.
    extensions = [
      history(),
      view_bridge(),
      EditorView.contentAttributes.of({ "data-editor-config": "new" }),
    ];

    act(() => runtime!.switchTab(tabB.id));
    expect(view!.contentDOM.getAttribute("data-editor-config")).toBe("new");

    act(() => runtime!.switchTab(tabA.id));
    expect(view!.contentDOM.getAttribute("data-editor-config")).toBe("new");
  });

  it("Rời Lab thì runtime gỡ subscription: không còn chuyển tab ngầm sau unmount", () => {
    const project = makeProject();
    const tabA = useWorkspaceStore.getState().createTab(project.id, "Tab A");
    const tabB = useWorkspaceStore.getState().createTab(project.id, "Tab B");
    extensions = [history(), view_bridge()];
    view = new EditorView({ state: EditorState.create({ doc: tabA.sql, extensions }), parent: document.body });

    const { result, unmount } = renderHook(() => useTabRuntime());
    act(() => result.current.onEditorReady(view!, () => extensions));
    unmount();

    const spy = vi.spyOn(view!, "setState");
    act(() => useWorkspaceStore.setState({ activeTabId: tabB.id }));
    expect(spy).not.toHaveBeenCalled();
  });

  describe("changesSchema", () => {
    it("chỉ coi DDL là đổi schema", () => {
      expect(changesSchema([{ kind: "create_table" }, { kind: "select" }])).toBe(true);
      expect(changesSchema([{ kind: "alter_table" }])).toBe(true);
      expect(changesSchema([{ kind: "drop" }])).toBe(true);
      expect(changesSchema([{ kind: "select" }, { kind: "insert" }])).toBe(false);
      expect(changesSchema([])).toBe(false);
    });
  });

  describe("Thông báo schema đã đổi (AC3)", () => {
    // File này là .ts nên không dùng JSX: dựng provider bằng createElement.
    // Provider khai báo `children` như một prop bắt buộc, còn createElement nhận children ở tham số thứ ba.
    const Provider = NextIntlClientProvider as ComponentType<{ locale: string; messages: Record<string, unknown> }>;
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(Provider, { locale: "vi", messages: { workspace: viWorkspace } }, children);

    const withTabs = () => {
      const project = makeProject();
      const tabA = useWorkspaceStore.getState().createTab(project.id, "Tab A");
      const tabB = useWorkspaceStore.getState().createTab(project.id, "Tab B");
      useWorkspaceStore.setState({ activeTabId: tabB.id });
      return { tabA, tabB };
    };

    it("hiện ở tab khác, có tên tab nguồn, và nút xem tab nguồn chuyển đúng tab", () => {
      const { tabA, tabB } = withTabs();
      const { result } = renderHook(() => useSchemaChangedNotice(), { wrapper });

      expect(result.current.message).toBeNull();

      act(() => {
        notifySchemaChanged(tabA.id, "ddl");
      });

      expect(result.current.message).toBe("Schema đã cập nhật từ Tab A");
      expect(result.current.sourceTabId).toBe(tabA.id);

      act(() => {
        result.current.showSource();
      });

      expect(useWorkspaceStore.getState().activeTabId).toBe(tabA.id);
      // Đứng ngay tab nguồn thì thông báo không còn nghĩa.
      expect(result.current.message).toBeNull();

      useWorkspaceStore.setState({ activeTabId: tabB.id });
      dismissSchemaChangedNotice();
    });

    it("không hiện ở chính tab nguồn", () => {
      const { tabA } = withTabs();
      useWorkspaceStore.setState({ activeTabId: tabA.id });
      const { result } = renderHook(() => useSchemaChangedNotice(), { wrapper });

      act(() => {
        notifySchemaChanged(tabA.id, "reset");
      });

      expect(result.current.message).toBeNull();
    });

    it("tự ẩn sau 5 giây", () => {
      vi.useFakeTimers();
      const { tabA } = withTabs();
      const { result } = renderHook(() => useSchemaChangedNotice(), { wrapper });

      act(() => {
        notifySchemaChanged(tabA.id, "ddl");
      });
      expect(result.current.message).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(SCHEMA_NOTICE_MS + 10);
      });

      expect(result.current.message).toBeNull();
    });

    it("Ca biên: đóng tab nguồn khi đang xem thông báo thì thông báo biến mất", () => {
      const { tabA } = withTabs();
      const { result } = renderHook(() => useSchemaChangedNotice(), { wrapper });

      act(() => {
        notifySchemaChanged(tabA.id, "ddl");
      });
      expect(result.current.message).toBe("Schema đã cập nhật từ Tab A");

      act(() => {
        useWorkspaceStore.getState().closeTab(tabA.id);
      });

      expect(result.current.message).toBeNull();
    });
  });
});
