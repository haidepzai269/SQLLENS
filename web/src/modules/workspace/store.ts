// Store quản lý trạng thái workspace cục bộ (projects, tabs, active id, saveState).
// Không lưu lên server, không gọi API, bảo toàn 100% Core Rule 7.

import { create } from "zustand";
import {
  scopeKey,
  type WorkspaceEngine,
  type WorkspaceProject,
  type WorkspaceScope,
  type WorkspaceTab,
} from "./types";

export type WorkspaceSaveState = "idle" | "saving" | "error";

export interface HydratePayload {
  projects: WorkspaceProject[];
  tabs: WorkspaceTab[];
  activeProjectId?: string | null;
  activeTabId?: string | null;
}

export interface CreateProjectInput {
  name: string;
  engine: WorkspaceEngine;
}

export interface WorkspaceStoreState {
  scope: WorkspaceScope;
  projects: WorkspaceProject[];
  tabs: WorkspaceTab[];
  activeProjectId: string | null;
  activeTabId: string | null;
  saveState: WorkspaceSaveState;
  saveError: string | null;

  setScope: (scope: WorkspaceScope) => void;
  hydrate: (payload: HydratePayload) => void;
  createProject: (input: CreateProjectInput) => WorkspaceProject;
  renameProject: (id: string, name: string) => void;
  duplicateProject: (id: string, copySuffix?: string) => WorkspaceProject | null;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  createTab: (projectId: string, name?: string) => WorkspaceTab;
  renameTab: (id: string, name: string) => void;
  closeTab: (id: string) => void;
  reorderTab: (id: string, toIndex: number) => void;
  updateTabSql: (id: string, sql: string) => void;
  setSaveState: (saveState: WorkspaceSaveState, saveError?: string | null) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  scope: { kind: "guest" as const },
  projects: [] as WorkspaceProject[],
  tabs: [] as WorkspaceTab[],
  activeProjectId: null as string | null,
  activeTabId: null as string | null,
  saveState: "idle" as WorkspaceSaveState,
  saveError: null as string | null,
};

export const useWorkspaceStore = create<WorkspaceStoreState>()((set, get) => ({
  ...INITIAL_STATE,

  setScope: (scope) => {
    set({ scope });
  },

  hydrate: (payload) => {
    const { projects, tabs } = payload;
    let activeProjectId = payload.activeProjectId ?? null;
    if (activeProjectId && !projects.some((p) => p.id === activeProjectId)) {
      activeProjectId = null;
    }
    if (!activeProjectId && projects.length > 0) {
      activeProjectId = projects[0].id;
    }

    let activeTabId = payload.activeTabId ?? null;
    const projectTabs = activeProjectId
      ? tabs.filter((t) => t.projectId === activeProjectId).sort((a, b) => a.position - b.position)
      : [];
    if (activeTabId && !projectTabs.some((t) => t.id === activeTabId)) {
      activeTabId = null;
    }
    if (!activeTabId && projectTabs.length > 0) {
      activeTabId = projectTabs[0].id;
    }

    set({
      projects,
      tabs,
      activeProjectId,
      activeTabId,
      saveState: "idle",
      saveError: null,
    });
  },

  createProject: ({ name, engine }) => {
    const now = Date.now();
    const id = crypto.randomUUID();
    const project: WorkspaceProject = {
      id,
      scopeKey: scopeKey(get().scope),
      name: name.trim() || "Untitled Project",
      engine,
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({
      projects: [...state.projects, project],
      activeProjectId: project.id,
    }));

    return project;
  },

  renameProject: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => {
      let found = false;
      const projects = state.projects.map((p) => {
        if (p.id === id) {
          found = true;
          return { ...p, name: trimmed, updatedAt: Date.now() };
        }
        return p;
      });
      if (!found) return state;
      return { projects };
    });
  },

  duplicateProject: (id, copySuffix) => {
    const state = get();
    const original = state.projects.find((p) => p.id === id);
    if (!original) return null;

    const now = Date.now();
    const newProjectId = crypto.randomUUID();
    const suffix = copySuffix ?? " (copy)";
    const newProject: WorkspaceProject = {
      id: newProjectId,
      scopeKey: original.scopeKey,
      name: `${original.name}${suffix}`,
      engine: original.engine,
      createdAt: now,
      updatedAt: now,
    };

    const originalTabs = state.tabs
      .filter((t) => t.projectId === id)
      .sort((a, b) => a.position - b.position);

    const newTabs: WorkspaceTab[] = originalTabs.map((t) => ({
      id: crypto.randomUUID(),
      projectId: newProjectId,
      name: t.name,
      sql: t.sql,
      position: t.position,
      updatedAt: now,
    }));

    const nextActiveTabId = newTabs.length > 0 ? newTabs[0].id : null;

    set((s) => ({
      projects: [...s.projects, newProject],
      tabs: [...s.tabs, ...newTabs],
      activeProjectId: newProjectId,
      activeTabId: nextActiveTabId,
    }));

    return newProject;
  },

  deleteProject: (id) => {
    const state = get();
    const remainingProjects = state.projects.filter((p) => p.id !== id);
    const remainingTabs = state.tabs.filter((t) => t.projectId !== id);

    let nextActiveProjectId = state.activeProjectId;
    let nextActiveTabId = state.activeTabId;

    if (state.activeProjectId === id) {
      if (remainingProjects.length > 0) {
        nextActiveProjectId = remainingProjects[0].id;
        const projectTabs = remainingTabs
          .filter((t) => t.projectId === nextActiveProjectId)
          .sort((a, b) => a.position - b.position);
        nextActiveTabId = projectTabs.length > 0 ? projectTabs[0].id : null;
      } else {
        nextActiveProjectId = null;
        nextActiveTabId = null;
      }
    }

    set({
      projects: remainingProjects,
      tabs: remainingTabs,
      activeProjectId: nextActiveProjectId,
      activeTabId: nextActiveTabId,
    });
  },

  setActiveProject: (id) => {
    if (id === null) {
      set({ activeProjectId: null, activeTabId: null });
      return;
    }
    const state = get();
    const projectExists = state.projects.some((p) => p.id === id);
    if (!projectExists) return;

    const projectTabs = state.tabs
      .filter((t) => t.projectId === id)
      .sort((a, b) => a.position - b.position);

    let nextActiveTabId = state.activeTabId;
    if (!projectTabs.some((t) => t.id === nextActiveTabId)) {
      nextActiveTabId = projectTabs.length > 0 ? projectTabs[0].id : null;
    }

    set({
      activeProjectId: id,
      activeTabId: nextActiveTabId,
    });
  },

  createTab: (projectId, name) => {
    const state = get();
    const projectTabs = state.tabs.filter((t) => t.projectId === projectId);
    const position = projectTabs.length;
    const now = Date.now();
    const id = crypto.randomUUID();
    const defaultName = `Query ${position + 1}.sql`;
    const tabName = name?.trim() || defaultName;

    const tab: WorkspaceTab = {
      id,
      projectId,
      name: tabName,
      sql: "",
      position,
      updatedAt: now,
    };

    set((s) => ({
      tabs: [...s.tabs, tab],
      activeProjectId: projectId,
      activeTabId: tab.id,
    }));

    return tab;
  },

  renameTab: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => {
      let found = false;
      const tabs = state.tabs.map((t) => {
        if (t.id === id) {
          found = true;
          return { ...t, name: trimmed, updatedAt: Date.now() };
        }
        return t;
      });
      if (!found) return state;
      return { tabs };
    });
  },

  // AC4: closeTab khi còn 1 tab không xóa tab cuối; closeTab tab đang mở chọn tab kế bên.
  closeTab: (id) => {
    const state = get();
    const tabToClose = state.tabs.find((t) => t.id === id);
    if (!tabToClose) return;

    const projectTabs = state.tabs
      .filter((t) => t.projectId === tabToClose.projectId)
      .sort((a, b) => a.position - b.position);

    // Không xóa khi chỉ còn 1 tab trong project
    if (projectTabs.length <= 1) {
      return;
    }

    const closeIndex = projectTabs.findIndex((t) => t.id === id);
    let nextActiveTabId = state.activeTabId;

    if (state.activeTabId === id) {
      const neighbor =
        closeIndex === projectTabs.length - 1
          ? projectTabs[closeIndex - 1]
          : projectTabs[closeIndex + 1];
      nextActiveTabId = neighbor ? neighbor.id : null;
    }

    const remainingProjectTabs = projectTabs.filter((t) => t.id !== id);
    // AC5: position luôn liên tục 0..n-1 không khoảng trống
    const normalizedProjectTabs = remainingProjectTabs.map((t, idx) => ({
      ...t,
      position: idx,
    }));

    const otherTabs = state.tabs.filter((t) => t.projectId !== tabToClose.projectId);

    set({
      tabs: [...otherTabs, ...normalizedProjectTabs],
      activeTabId: nextActiveTabId,
    });
  },

  // AC5: reorderTab cập nhật position liên tục 0..n-1, không để khoảng trống.
  reorderTab: (id, toIndex) => {
    const state = get();
    const tabToReorder = state.tabs.find((t) => t.id === id);
    if (!tabToReorder) return;

    const projectTabs = state.tabs
      .filter((t) => t.projectId === tabToReorder.projectId)
      .sort((a, b) => a.position - b.position);

    const fromIndex = projectTabs.findIndex((t) => t.id === id);
    if (fromIndex === -1) return;

    const boundedToIndex = Math.max(0, Math.min(toIndex, projectTabs.length - 1));
    if (fromIndex === boundedToIndex) return;

    const reordered = [...projectTabs];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(boundedToIndex, 0, moved);

    const now = Date.now();
    const normalizedProjectTabs = reordered.map((t, idx) => ({
      ...t,
      position: idx,
      updatedAt: t.id === id ? now : t.updatedAt,
    }));

    const otherTabs = state.tabs.filter((t) => t.projectId !== tabToReorder.projectId);

    set({
      tabs: [...otherTabs, ...normalizedProjectTabs],
    });
  },

  // Nội dung không đổi thì không tạo bản ghi mới: chuyển tab hay nạp lại cùng một
  // văn bản sẽ không đẩy thêm một lượt autosave/rerender không cần thiết.
  updateTabSql: (id, sql) => {
    set((state) => {
      let found = false;
      let changed = false;
      const tabs = state.tabs.map((t) => {
        if (t.id !== id) return t;
        found = true;
        if (t.sql === sql) return t;
        changed = true;
        return { ...t, sql, updatedAt: Date.now() };
      });
      if (!found || !changed) return state;
      return { tabs };
    });
  },

  setSaveState: (saveState, saveError = null) => {
    set({ saveState, saveError: saveError ?? null });
  },

  reset: () => {
    set({ ...INITIAL_STATE });
  },
}));
