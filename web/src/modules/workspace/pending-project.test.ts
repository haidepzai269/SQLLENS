import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openWorkspaceDb } from "./db";
import { bootWorkspace, disposeWorkspace } from "./hydrate";
import {
  clearPendingProject,
  consumePendingProject,
  markPendingProject,
  peekPendingProject,
} from "./pending-project";
import { getRepository } from "./repository";
import { useWorkspaceStore } from "./store";
import type { WorkspaceProject, WorkspaceTab } from "./types";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

function project(id: string, name: string, at: number, scope: "guest" | "user" = "guest"): WorkspaceProject {
  return {
    id,
    scopeKey: scope === "guest" ? "guest" : "user_u-1",
    name,
    engine: "postgres",
    createdAt: at,
    updatedAt: at,
  };
}

function tab(projectId: string, id: string, at: number): WorkspaceTab {
  return { id, projectId, name: `Tab ${id}`, sql: `SELECT '${id}';`, position: 0, updatedAt: at };
}

// Dự án cũ trong scope guest, dự án cũ hơn trong scope user, và dự án vừa fork trong scope user.
async function seed(factory: IDBFactory) {
  const db = await openWorkspaceDb(factory);
  try {
    const repo = getRepository(db);
    await repo.upsertProject(project("old", "Dự án cũ", 1));
    await repo.upsertTab(tab("old", "old-tab", 1));
    await repo.upsertProject(project("user-old", "Dự án user cũ", 0, "user"));
    await repo.upsertTab(tab("user-old", "user-old-tab", 0));
    await repo.upsertProject(project("forked", "Snapshot (bản sao)", 2, "user"));
    await repo.upsertTab(tab("forked", "forked-tab", 2));
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  await disposeWorkspace();
  useWorkspaceStore.getState().reset();
});

afterEach(async () => {
  await disposeWorkspace();
  useWorkspaceStore.getState().reset();
});

describe("dự án chờ mở sau Fork (Task147 AC2)", () => {
  it("mở đúng dự án vừa fork trong đúng scope, rồi xóa dấu chờ", async () => {
    const factory = new IDBFactory();
    const session = new MemoryStorage();
    await seed(factory);
    markPendingProject("forked", session);

    const booted = await bootWorkspace({ kind: "user", userId: "u-1" }, { factory, sessionStorage: session, delayMs: 10 });

    expect(booted.projectId).toBe("forked");
    expect(useWorkspaceStore.getState().activeProjectId).toBe("forked");
    expect(useWorkspaceStore.getState().activeTabId).toBe("forked-tab");
    expect(peekPendingProject(session)).toBeNull();
  });

  it("boot ở scope khác (guest trước khi /api/me xong) KHÔNG nuốt dấu chờ của scope user", async () => {
    const factory = new IDBFactory();
    const session = new MemoryStorage();
    await seed(factory);
    markPendingProject("forked", session);

    // Lần boot guest: dự án forked không thuộc scope này nên mở dự án đầu, giữ nguyên dấu chờ.
    const guestBoot = await bootWorkspace({ kind: "guest" }, { factory, sessionStorage: session, delayMs: 10 });
    expect(guestBoot.projectId).toBe("old");
    expect(peekPendingProject(session)).toBe("forked");

    // Lần boot user ngay sau đó mở đúng dự án vừa fork.
    const userBoot = await bootWorkspace({ kind: "user", userId: "u-1" }, { factory, sessionStorage: session, delayMs: 10 });
    expect(userBoot.projectId).toBe("forked");
    expect(peekPendingProject(session)).toBeNull();
  });

  it("id không còn tồn tại thì mở dự án đầu, dấu chờ tự hết hạn chứ không mở nhầm", async () => {
    const factory = new IDBFactory();
    const session = new MemoryStorage();
    await seed(factory);
    markPendingProject("khong-ton-tai", session);

    const booted = await bootWorkspace({ kind: "guest" }, { factory, sessionStorage: session, delayMs: 10 });

    expect(booted.projectId).toBe("old");
    // Còn trong hạn thì giữ, để lần boot đúng scope vẫn dùng được; quá hạn thì bị dọn.
    expect(peekPendingProject(session)).toBe("khong-ton-tai");
    expect(peekPendingProject(session, Date.now() + 11 * 60 * 1000)).toBeNull();
  });

  it("không có dấu chờ thì giữ hành vi cũ: mở dự án đầu tiên", async () => {
    const factory = new IDBFactory();
    await seed(factory);

    const booted = await bootWorkspace({ kind: "guest" }, { factory, delayMs: 10 });

    expect(booted.projectId).toBe("old");
  });
});

describe("markPendingProject / clearPendingProject", () => {
  it("consume chỉ trả về một lần", () => {
    const session = new MemoryStorage();
    markPendingProject("p-1", session);

    expect(consumePendingProject(session)).toBe("p-1");
    expect(consumePendingProject(session)).toBeNull();
  });

  it("clear chỉ xóa đúng id, không xóa dấu chờ của dự án khác", () => {
    const session = new MemoryStorage();
    markPendingProject("p-2", session);

    clearPendingProject("p-1", session);
    expect(peekPendingProject(session)).toBe("p-2");

    clearPendingProject("p-2", session);
    expect(peekPendingProject(session)).toBeNull();
  });

  it("storage bị chặn thì bỏ qua an toàn", () => {
    expect(() => markPendingProject("p3", null)).not.toThrow();
    expect(peekPendingProject(null)).toBeNull();
  });
});
